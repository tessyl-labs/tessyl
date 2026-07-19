import { fork } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TessylNativeError } from "../errors.js";
import { resourceProfile } from "../profiles.js";
import type {
  CompileTesseraInput,
  CompileTesseraResult,
  NativeDiagnostic,
  TesseraArtifactV2,
} from "../types.js";
import { canonicalJson, encodedJson, sha256 } from "./canonical.js";
import { validateArtifactStructure, validateMetadataContract, validateResourcesContract } from "./artifact.js";
import { compilerAdmission } from "./compiler-admission.js";
import { inspectToolchain } from "./toolchain.js";
import { NATIVE_SDK_VERSION, VOYD_COMPILER_ABI_VERSION, VX_RUNTIME_ABI_VERSION } from "../versions.js";

const ENTRY_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]+\.voyd$/;
const PACKAGE_IMPORT_RE = /\buse\s+pkg\s*::\s*([A-Za-z0-9_-]+)/g;
const STD_IMPORT_RE = /\buse\s+std\s*::\s*([A-Za-z0-9_]+)/g;
const ALLOWED_STD_MODULES = new Set(["array", "dict", "math", "number", "optional", "result", "string", "test"]);
const CAPABILITY_CALL_RE = /\b(Cmd|Sub)(?:<[^>\n]+>)?\s*::\s*([A-Za-z_][A-Za-z0-9_]*)/g;
const ALLOWED_CAPABILITY_METHODS = { Cmd: new Set(["none", "batch", "delay", "share_state"]), Sub: new Set(["none", "batch", "animation_frame", "fixed_timestep", "reduced_motion", "container_size", "input_number", "input_string", "input_boolean", "dataset_text", "shareable_state"]) } as const;
const FORBIDDEN_SOURCE = [
  /\buse\s+std\s*::\s*vx\b/,
  /\buse\s+std\s*::\s*(?:http|fs|io|process|task|time|random)\b/,
  /\buse\s+(?:std|pkg)\s*::\s*\{/,
  /@external\b/,
  /\beff\s+[A-Za-z_]/,
  /@effect\b/,
  /\bextern\s+/,
  /\bmsgpack\s*::/,
  /\btype\s+[A-Za-z_][A-Za-z0-9_]*(?:<[^>\n]+>)?\s*=\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*::\s*)*Sub\b/,
  /\bSub\s+as\s+[A-Za-z_][A-Za-z0-9_]*/,
  /\bSub(?:<[^>\n]+>)?\s*\{/,
  /<\/?[a-z][A-Za-z0-9-]*(?:\s|>|\/)/,
];

export const compileTessera = async (input: CompileTesseraInput): Promise<CompileTesseraResult> => {
  const admissionDiagnostics = preflightBuildInput(input);
  if (admissionDiagnostics.length) return { ok: false, diagnostics: admissionDiagnostics };
  const snapshot = snapshotBuildInput(input);
  if (!snapshot) return { ok: false, diagnostics: [diagnostic("invalid_source", "Compile input must contain cloneable data")] };
  const policyDiagnostics = validateBuildInput(snapshot);
  if (policyDiagnostics.length) return { ok: false, diagnostics: policyDiagnostics };
  const profile = resourceProfile(snapshot.profile);
  const releaseCompiler = await compilerAdmission.acquire(profile.maxConcurrentCompilers, profile.maxCompilerQueue, profile.compileTimeoutMs);
  try {
  const entrySource = snapshot.source.files[snapshot.source.entry]!;
  const files = Object.fromEntries(Object.entries(snapshot.source.files).filter(([name]) => name !== snapshot.source.entry));
  const result = await runRestrictedCompiler({ entry: snapshot.source.entry, entrySource, files, profile: snapshot.profile, fallback: snapshot.authorManifest.fallback, assets: snapshot.authorManifest.assets ?? [], workflow: "build" });
  if ("infrastructureError" in result && result.infrastructureError) throw new TessylNativeError({ code: "compile_failed", phase: "compile", message: "Voyd compiler infrastructure failed", cause: new Error(result.infrastructureError) });
  if (!result.success) return { ok: false, diagnostics: result.diagnostics.slice(0, 100).map(toNativeDiagnostic) };
  if (!(result.wasm instanceof Uint8Array) || result.wasm.byteLength > profile.maxWasmBytes || !result.fallback) throw new TessylNativeError({ code: "compile_failed", phase: "compile", message: "Compiler worker returned an invalid result" });
  const sourceBundle = encodedJson({ entry: snapshot.source.entry, files: snapshot.source.files });
  const sourceHash = await sha256(sourceBundle);
  const toolchain = await inspectToolchain();
  if (toolchain.compilerVersion !== VOYD_COMPILER_ABI_VERSION || toolchain.vxRuntimeVersion !== VX_RUNTIME_ABI_VERSION) {
    throw new TessylNativeError({ code: "compile_failed", phase: "compile", message: "Configured Voyd toolchain ABI is unsupported" });
  }
  const dependencyLock = toolchain.dependencyLock;
  const buildProvenance = {
    version: 1 as const,
    builder: "@tessyl/native" as const,
    profile: snapshot.profile,
    reproducible: true as const,
  };
  const metadata = {
    version: 1 as const,
    title: snapshot.authorManifest.title,
    accessibleName: snapshot.authorManifest.metadata?.accessibleName ?? snapshot.authorManifest.title,
    purpose: snapshot.authorManifest.metadata?.purpose ?? snapshot.authorManifest.title,
    revision: snapshot.authorManifest.metadata?.revision ?? sourceHash.slice(0, 12),
    ...snapshot.authorManifest.metadata,
  };
  const resources = {
    version: 1 as const,
    inputs: snapshot.authorManifest.inputs ?? [],
    datasets: snapshot.authorManifest.datasets ?? [],
    assets: snapshot.authorManifest.assets ?? [],
    shareableState: true as const,
  };
  const fallback = result.fallback;
  const [dependencyLockHash, wasmHash, fallbackHash, buildProvenanceHash, metadataHash, resourcesHash] = await Promise.all([
    sha256(canonicalJson(dependencyLock)),
    sha256(result.wasm),
    sha256(canonicalJson(fallback)),
    sha256(canonicalJson(buildProvenance)),
    sha256(canonicalJson(metadata)),
    sha256(canonicalJson(resources)),
  ]);
  const artifact: TesseraArtifactV2 = {
    manifest: {
      schemaVersion: 2,
      frameProtocolVersion: 1,
      rpcProtocolVersion: 1,
      sdkVersion: NATIVE_SDK_VERSION,
      vxRuntimeVersion: toolchain.vxRuntimeVersion,
      compilerVersion: toolchain.compilerVersion,
      sourceHash,
      dependencyLockHash,
      wasmHash,
      fallbackHash,
      buildProvenanceHash,
      metadataHash,
      resourcesHash,
      entrypoint: "app",
      capabilityProfile: "public-v2",
      resourceProfile: "standard-v1",
    },
    wasm: result.wasm,
    sourceBundle,
    dependencyLock,
    fallback,
    buildProvenance,
    metadata,
    resources,
  };
  return { ok: true, artifact: validateArtifactStructure(artifact), diagnostics: result.diagnostics };
  } finally {
    releaseCompiler();
  }
};

export const checkTessera = (input: CompileTesseraInput): Promise<readonly NativeDiagnostic[]> => runDiagnosticWorkflow(input, "check");
export const testTessera = (input: CompileTesseraInput): Promise<readonly NativeDiagnostic[]> => runDiagnosticWorkflow(input, "test");

const runDiagnosticWorkflow = async (input: CompileTesseraInput, workflow: "check" | "test"): Promise<readonly NativeDiagnostic[]> => {
  const admissionDiagnostics = preflightBuildInput(input);
  if (admissionDiagnostics.length) return admissionDiagnostics;
  const snapshot = snapshotBuildInput(input);
  if (!snapshot) return [diagnostic("invalid_source", "Compile input must contain cloneable data")];
  const policyDiagnostics = validateBuildInput(snapshot);
  if (policyDiagnostics.length) return policyDiagnostics;
  const profile = resourceProfile(snapshot.profile);
  const releaseCompiler = await compilerAdmission.acquire(profile.maxConcurrentCompilers, profile.maxCompilerQueue, profile.compileTimeoutMs);
  try {
    const entrySource = snapshot.source.files[snapshot.source.entry]!;
    const files = Object.fromEntries(Object.entries(snapshot.source.files).filter(([name]) => name !== snapshot.source.entry));
    const result = await runRestrictedCompiler({ entry: snapshot.source.entry, entrySource, files, profile: snapshot.profile, fallback: snapshot.authorManifest.fallback, workflow });
    if ("infrastructureError" in result && result.infrastructureError) throw new TessylNativeError({ code: "compile_failed", phase: "compile", message: "Voyd compiler infrastructure failed", cause: new Error(result.infrastructureError) });
    return result.success ? result.diagnostics.map(toNativeDiagnostic) : result.diagnostics.slice(0, 100).map(toNativeDiagnostic);
  } finally { releaseCompiler(); }
};

const snapshotBuildInput = (input: CompileTesseraInput): CompileTesseraInput | undefined => {
  try { return structuredClone(input); } catch { return undefined; }
};

const preflightBuildInput = (input: unknown): NativeDiagnostic[] => {
  const invalid = (message: string): NativeDiagnostic[] => [diagnostic("invalid_source", message)];
  if (!isPlainRecord(input)) return invalid("Compile input must be a plain data object");
  const rootKeys = Object.getOwnPropertyNames(input);
  if (rootKeys.length > 3 || rootKeys.some((key) => key !== "source" && key !== "authorManifest" && key !== "profile")) return invalid("Compile input contains unsupported fields");
  const source = ownData(input, "source");
  const manifest = ownData(input, "authorManifest");
  const profile = ownData(input, "profile");
  if (!source.ok || !manifest.ok || !profile.ok || !isPlainRecord(source.value) || !isPlainRecord(manifest.value)) return invalid("Compile input must contain accessor-free source and manifest data");
  const sourceKeys = Object.getOwnPropertyNames(source.value);
  if (sourceKeys.length !== 2 || sourceKeys.some((key) => key !== "entry" && key !== "files")) return invalid("Source bundle shape is invalid");
  const entry = ownData(source.value, "entry");
  const files = ownData(source.value, "files");
  if (!entry.ok || typeof entry.value !== "string" || !files.ok || !isPlainRecord(files.value)) return invalid("Source bundle must contain accessor-free entry and files data");
  const fileNames = Object.getOwnPropertyNames(files.value);
  if (fileNames.length > 64) return [diagnostic("resource_limit", "Source bundle contains too many files")];
  const maxSourceBytes = resourceProfile("standard-v1").maxSourceBytes;
  let sourceBytes = entry.value.length;
  for (const name of fileNames) {
    const file = ownData(files.value, name);
    if (!file.ok || typeof file.value !== "string") return invalid("Source files must be accessor-free text values");
    sourceBytes += name.length + file.value.length;
    if (sourceBytes > maxSourceBytes) return [diagnostic("resource_limit", "Source bundle is too large")];
  }
  const budget = { nodes: 0, stringUnits: 0 };
  if (!inspectCloneData(manifest.value, 0, budget)) return invalid("Author manifest exceeds clone admission limits or contains accessors");
  return [];
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const ownData = (value: Record<string, unknown>, key: string): { ok: true; value: unknown } | { ok: false } => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? { ok: true, value: descriptor.value } : { ok: false };
};

const inspectCloneData = (value: unknown, depth: number, budget: { nodes: number; stringUnits: number }): boolean => {
  budget.nodes += 1;
  if (depth > 16 || budget.nodes > 4_096) return false;
  if (typeof value === "string") {
    budget.stringUnits += value.length;
    return budget.stringUnits <= 512 * 1024;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) {
    if (value.length > 2_048) return false;
    const keys = Object.getOwnPropertyNames(value);
    if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key))) return false;
    for (let index = 0; index < value.length; index += 1) {
      const item = Object.getOwnPropertyDescriptor(value, String(index));
      if (!item || !("value" in item) || !inspectCloneData(item.value, depth + 1, budget)) return false;
    }
    return true;
  }
  if (!isPlainRecord(value)) return false;
  const keys = Object.getOwnPropertyNames(value);
  if (keys.length > 256) return false;
  for (const key of keys) {
    const item = ownData(value, key);
    if (!item.ok || !inspectCloneData(item.value, depth + 1, budget)) return false;
  }
  return true;
};

const validateBuildInput = (input: CompileTesseraInput): NativeDiagnostic[] => {
  const out: NativeDiagnostic[] = [];
  const inputRecord = input as unknown;
  if (!inputRecord || typeof inputRecord !== "object" || Array.isArray(inputRecord)) return [diagnostic("invalid_source", "Compile input must be an object")];
  const sourceRecord = (inputRecord as Record<string, unknown>).source;
  const manifestRecord = (inputRecord as Record<string, unknown>).authorManifest;
  if (!sourceRecord || typeof sourceRecord !== "object" || Array.isArray(sourceRecord) || !manifestRecord || typeof manifestRecord !== "object" || Array.isArray(manifestRecord)) return [diagnostic("invalid_source", "Compile input shape is invalid")];
  const filesValue = (sourceRecord as Record<string, unknown>).files;
  const entryValue = (sourceRecord as Record<string, unknown>).entry;
  const titleValue = (manifestRecord as Record<string, unknown>).title;
  if (typeof entryValue !== "string" || typeof titleValue !== "string" || !filesValue || typeof filesValue !== "object" || Array.isArray(filesValue) || (Object.getPrototypeOf(filesValue) !== Object.prototype && Object.getPrototypeOf(filesValue) !== null)) return [diagnostic("invalid_source", "Source bundle shape is invalid")];
  const entries = Object.entries(filesValue as Record<string, unknown>);
  if (entries.length > 64) return [diagnostic("resource_limit", "Source bundle contains too many files")];
  const profile = resourceProfile("standard-v1");
  if (input.profile !== "standard-v1") out.push(diagnostic("unsupported_profile", "Unsupported build profile"));
  if (input.authorManifest.sdkVersion !== 2) out.push(diagnostic("unsupported_sdk", "Unsupported author SDK version"));
  if (!input.authorManifest.title.trim() || new TextEncoder().encode(input.authorManifest.title).byteLength > 200) {
    out.push(diagnostic("invalid_manifest", "Tessera title is required and must be at most 200 bytes"));
  }
  validateAuthorContract(input.authorManifest as unknown as Record<string, unknown>, out);
  if (new TextEncoder().encode(input.source.entry).byteLength > 240 || !ENTRY_RE.test(input.source.entry) || !(input.source.entry in input.source.files)) {
    out.push(diagnostic("invalid_source", "Source entry must be a safe relative .voyd file present in the bundle"));
  }
  let total = 0;
  for (const [name, rawSource] of entries) {
    const nameBytes = new TextEncoder().encode(name).byteLength;
    if (nameBytes > 240 || !ENTRY_RE.test(name)) out.push(diagnostic("invalid_source_path", `Invalid source path: ${name.slice(0, 80)}`, name));
    if (typeof rawSource !== "string") { out.push(diagnostic("invalid_source", "Source files must contain text", name)); continue; }
    const source = rawSource;
    total += nameBytes + new TextEncoder().encode(source).byteLength;
    if (total > profile.maxSourceBytes) return [...out, diagnostic("resource_limit", "Source bundle is too large")].slice(0, 100);
    const policySource = scrubVoydNonCode(source);
    for (const pattern of FORBIDDEN_SOURCE) if (pattern.test(policySource)) out.push(diagnostic("forbidden_api", "Source uses an API outside the Tessera sandbox", name));
    for (const match of policySource.matchAll(PACKAGE_IMPORT_RE)) if (match[1] !== "tessyl_native") out.push(diagnostic("forbidden_package", `Package ${match[1]?.slice(0, 64)} is not allowed`, name));
    for (const match of policySource.matchAll(STD_IMPORT_RE)) if (!ALLOWED_STD_MODULES.has(match[1] ?? "")) out.push(diagnostic("forbidden_api", `std::${match[1]?.slice(0, 64)} is outside the Native author surface`, name));
    for (const match of policySource.matchAll(CAPABILITY_CALL_RE)) {
      const owner = match[1] as "Cmd" | "Sub";
      if (!ALLOWED_CAPABILITY_METHODS[owner].has(match[2] ?? "")) out.push(diagnostic("forbidden_capability", `${owner}::${match[2]?.slice(0, 48)} is not part of the Native capability profile`, name));
    }
  }
  if (encodedJson({ entry: input.source.entry, files: input.source.files }).byteLength > profile.maxSourceBytes) {
    out.push(diagnostic("resource_limit", "Encoded source bundle is too large"));
  }
  return out.slice(0, 100);
};

const scrubVoydNonCode = (source: string): string => {
  let result = "";
  let index = 0;
  let state: "code" | "string" | "line" | "block" = "code";
  while (index < source.length) {
    const character = source[index]!;
    const next = source[index + 1];
    if (state === "code") {
      if (character === '"') { state = "string"; result += " "; index += 1; continue; }
      if (character === "/" && next === "/") { state = "line"; result += "  "; index += 2; continue; }
      if (character === "/" && next === "*") { state = "block"; result += "  "; index += 2; continue; }
      result += character; index += 1; continue;
    }
    if (state === "string") {
      if (character === "\\") { result += "  "; index += Math.min(2, source.length - index); continue; }
      if (character === '"') state = "code";
      result += character === "\n" ? "\n" : " "; index += 1; continue;
    }
    if (state === "line") {
      if (character === "\n") { state = "code"; result += "\n"; } else result += " ";
      index += 1; continue;
    }
    if (character === "*" && next === "/") { state = "code"; result += "  "; index += 2; continue; }
    result += character === "\n" ? "\n" : " "; index += 1;
  }
  return result;
};

const validateAuthorContract = (manifest: Record<string, unknown>, out: NativeDiagnostic[]): void => {
  const exact = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
    if (Object.keys(value).some((key) => !keys.includes(key))) out.push(diagnostic("invalid_manifest", `${label} contains an unknown field`));
  };
  const boundedText = (value: unknown, label: string, required = false): void => {
    if (value === undefined && !required) return;
    if (typeof value !== "string" || (required && !value.trim()) || new TextEncoder().encode(value).byteLength > 1_000) out.push(diagnostic("invalid_manifest", `${label} must be bounded non-empty text`));
  };
  exact(manifest, ["title", "sdkVersion", "metadata", "fallback", "inputs", "datasets", "assets"], "Author manifest");
  const metadata = manifest.metadata;
  if (metadata !== undefined) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) out.push(diagnostic("invalid_manifest", "Metadata must be an object"));
    else {
      const record = metadata as Record<string, unknown>;
      exact(record, ["accessibleName", "purpose", "caption", "instructions", "assumptions", "limitations", "authors", "reviewers", "citations", "revision", "unitsPolicy"], "Metadata");
      boundedText(record.accessibleName, "Accessible name", true);
      boundedText(record.purpose, "Purpose", true);
      boundedText(record.revision, "Revision", true);
      for (const key of ["caption", "unitsPolicy"] as const) boundedText(record[key], key);
      for (const key of ["instructions", "assumptions", "limitations", "authors", "reviewers"] as const) {
        const values = record[key];
        if (values !== undefined && (!Array.isArray(values) || values.length > 32 || values.some((value) => typeof value !== "string" || !value.trim() || value.length > 1_000))) out.push(diagnostic("invalid_manifest", `${key} must contain bounded non-empty text`));
      }
      if (record.citations !== undefined) {
        if (!Array.isArray(record.citations) || record.citations.length > 64) out.push(diagnostic("invalid_manifest", "Citations exceed 64 entries"));
        else for (const raw of record.citations) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) { out.push(diagnostic("invalid_manifest", "Citation must be an object")); continue; }
          const citation = raw as Record<string, unknown>;
          exact(citation, ["title", "url", "license", "dataset"], "Citation");
          boundedText(citation.title, "Citation title", true);
          for (const key of ["url", "license", "dataset"] as const) boundedText(citation[key], `Citation ${key}`);
          if (typeof citation.url === "string" && !/^https:\/\/[A-Za-z0-9]/.test(citation.url)) out.push(diagnostic("invalid_manifest", "Citation URLs must use HTTPS"));
        }
      }
    }
  }
  const fallback = manifest.fallback as Record<string, unknown> | undefined;
  if (fallback !== undefined) {
    if (!fallback || typeof fallback !== "object" || Array.isArray(fallback) || fallback.version !== 1) out.push(diagnostic("invalid_fallback_plan", "Fallback plan version is unsupported"));
    else {
      exact(fallback, ["version", "interactions", "essentialContent"], "Fallback plan");
      const interactions = fallback.interactions;
      if (interactions !== undefined && (!Array.isArray(interactions) || interactions.length > 32 || interactions.some((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return true;
        const value = item as Record<string, unknown>;
        exact(value, ["targetLabel", "event", "value"], "Fallback interaction");
        const interactionValue = value.value;
        return typeof value.targetLabel !== "string"
          || !value.targetLabel.trim()
          || new TextEncoder().encode(value.targetLabel).byteLength > 1_000
          || !["click", "input", "change"].includes(String(value.event))
          || (interactionValue !== undefined
            && typeof interactionValue !== "string"
            && typeof interactionValue !== "boolean"
            && (typeof interactionValue !== "number" || !Number.isFinite(interactionValue)))
          || (typeof interactionValue === "string" && new TextEncoder().encode(interactionValue).byteLength > 8_192);
      }))) out.push(diagnostic("invalid_fallback_plan", "Fallback interactions are invalid or exceed 32 steps"));
      const essential = fallback.essentialContent;
      if (essential !== undefined && (!Array.isArray(essential) || essential.length > 32 || essential.some((item) => typeof item !== "string" || !item.trim() || new TextEncoder().encode(item).byteLength > 1_000))) out.push(diagnostic("invalid_fallback_plan", "Fallback essential content must contain at most 32 bounded labels"));
    }
  }
  const profile = resourceProfile("standard-v1");
  const inputs = manifest.inputs;
  if (inputs !== undefined && (!Array.isArray(inputs) || inputs.length > 64)) out.push(diagnostic("invalid_manifest", "Input schema exceeds 64 entries"));
  if (Array.isArray(inputs)) {
    const names = new Set<string>();
    for (const item of inputs) {
      const value = item as Record<string, unknown>;
      if (!item || typeof item !== "object" || Array.isArray(item) || typeof value.name !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(value.name) || names.has(value.name) || !["number", "string", "boolean"].includes(String(value.type))) out.push(diagnostic("invalid_manifest", "Input definitions require unique canonical names and supported types"));
      else {
        names.add(value.name);
        exact(value, ["name", "type", "required", "default", "min", "max", "maxLength"], "Input definition");
        if (value.required !== undefined && typeof value.required !== "boolean") out.push(diagnostic("invalid_manifest", "Input required must be boolean"));
        if (value.default !== undefined && typeof value.default !== value.type) out.push(diagnostic("invalid_manifest", "Input default type must match its definition"));
        if (value.type === "number") {
          if ((value.min !== undefined && (typeof value.min !== "number" || !Number.isFinite(value.min))) || (value.max !== undefined && (typeof value.max !== "number" || !Number.isFinite(value.max))) || (typeof value.min === "number" && typeof value.max === "number" && value.min > value.max)) out.push(diagnostic("invalid_manifest", "Number input bounds are invalid"));
          if (typeof value.default === "number" && ((typeof value.min === "number" && value.default < value.min) || (typeof value.max === "number" && value.default > value.max))) out.push(diagnostic("invalid_manifest", "Number input default is outside its bounds"));
          if (value.maxLength !== undefined) out.push(diagnostic("invalid_manifest", "Number inputs cannot declare maxLength"));
        } else if (value.min !== undefined || value.max !== undefined || (value.type !== "string" && value.maxLength !== undefined)) out.push(diagnostic("invalid_manifest", "Input bounds do not match the input type"));
        if (value.type === "string" && value.maxLength !== undefined && (!Number.isInteger(value.maxLength) || (value.maxLength as number) < 1 || (value.maxLength as number) > 8_192)) out.push(diagnostic("invalid_manifest", "String maxLength is invalid"));
        if (value.type === "string" && typeof value.default === "string" && new TextEncoder().encode(value.default).byteLength > Number(value.maxLength ?? 8_192)) out.push(diagnostic("resource_limit", "String input default exceeds maxLength"));
      }
    }
  }
  const resourceIds = new Set<string>();
  for (const [key, maxBytes] of [["datasets", profile.maxDatasetBytes], ["assets", profile.maxAssetBytes]] as const) {
    const values = manifest[key];
    if (values === undefined) continue;
    if (!Array.isArray(values) || values.length > 64) { out.push(diagnostic("invalid_manifest", `${key} exceeds 64 entries`)); continue; }
    let totalBytes = 0;
    for (const item of values) {
      const value = item as Record<string, unknown>;
      const expectedMedia = key === "datasets" ? ["application/json", "text/csv"] : ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
      const expectedKeys = key === "datasets" ? ["id", "revision", "contentHash", "mediaType", "byteLength", "citation"] : ["id", "revision", "contentHash", "mediaType", "byteLength", "accessibleName", "license"];
      if (!item || typeof item !== "object" || Array.isArray(item) || typeof value.id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(value.id) || resourceIds.has(value.id) || typeof value.revision !== "string" || !value.revision.trim() || new TextEncoder().encode(value.revision).byteLength > 1_000 || typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.contentHash) || !expectedMedia.includes(String(value.mediaType)) || !Number.isInteger(value.byteLength) || (value.byteLength as number) < 0 || (value.byteLength as number) > maxBytes) out.push(diagnostic("invalid_manifest", `${key} references must be unique, versioned, content locked, typed, and within their byte limit`));
      else {
        resourceIds.add(value.id); totalBytes += value.byteLength as number; exact(value, expectedKeys, `${key} reference`);
        if (key === "datasets" && (typeof value.citation !== "string" || !value.citation.trim() || new TextEncoder().encode(value.citation).byteLength > 1_000)) out.push(diagnostic("invalid_manifest", "Dataset references require a bounded citation"));
        if (key === "assets" && ((typeof value.accessibleName !== "string" || !value.accessibleName.trim() || new TextEncoder().encode(value.accessibleName).byteLength > 1_000) || (typeof value.license !== "string" || !value.license.trim() || new TextEncoder().encode(value.license).byteLength > 1_000))) out.push(diagnostic("invalid_manifest", "Asset references require accessibility and license metadata"));
      }
    }
    if (totalBytes > maxBytes) out.push(diagnostic("resource_limit", `${key} aggregate bytes exceed the profile`));
  }
  if (typeof manifest.title === "string") {
    try {
      validateMetadataContract({ version: 1, title: manifest.title, accessibleName: (metadata as Record<string, unknown> | undefined)?.accessibleName ?? manifest.title, purpose: (metadata as Record<string, unknown> | undefined)?.purpose ?? manifest.title, revision: (metadata as Record<string, unknown> | undefined)?.revision ?? "pending", ...((metadata && typeof metadata === "object" && !Array.isArray(metadata)) ? metadata : {}) });
      validateResourcesContract({ version: 1, inputs: manifest.inputs ?? [], datasets: manifest.datasets ?? [], assets: manifest.assets ?? [], shareableState: true }, profile.maxDatasetBytes, profile.maxAssetBytes);
    } catch (error) {
      out.push(diagnostic(error instanceof TessylNativeError && error.code === "resource_limit" ? "resource_limit" : "invalid_manifest", "Author metadata or resource contract is invalid"));
    }
  }
};

const diagnostic = (code: string, message: string, file?: string): NativeDiagnostic => ({ code, severity: "error", message, ...(file ? { file } : {}) });

const toNativeDiagnostic = (value: unknown): NativeDiagnostic => {
  const item = value as Record<string, unknown>;
  const span = item.span as Record<string, unknown> | undefined;
  return {
    code: typeof item.code === "string" ? item.code.slice(0, 80) : "voyd_compile",
    severity: item.severity === "warning" || item.severity === "info" ? item.severity : "error",
    message: typeof item.message === "string" ? item.message.slice(0, 500) : "Voyd compilation failed",
    ...(typeof span?.file === "string" ? { file: span.file.slice(0, 200) } : {}),
    ...(typeof span?.startLine === "number" ? { line: span.startLine } : {}),
    ...(typeof span?.startColumn === "number" ? { column: span.startColumn } : {}),
  };
};

type RestrictedCompilerInput = { entry: string; entrySource: string; files: Record<string, string>; profile: "standard-v1"; fallback?: CompileTesseraInput["authorManifest"]["fallback"]; assets?: CompileTesseraInput["authorManifest"]["assets"]; workflow: "check" | "test" | "build" };
type RestrictedCompilerResult = { success: true; wasm?: Uint8Array; fallback?: TesseraArtifactV2["fallback"]; diagnostics: NativeDiagnostic[] } | { success: false; diagnostics: unknown[]; infrastructureError?: string };

const runRestrictedCompiler = (input: RestrictedCompilerInput): Promise<RestrictedCompilerResult> => {
  const profile = resourceProfile(input.profile);
  const sourceMode = import.meta.url.endsWith(".ts");
  const processUrl = new URL(sourceMode ? "./compiler-process.ts" : "./compiler-process.js", import.meta.url);
  const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
  const workspaceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
  const workspaceNodeModules = fileURLToPath(new URL("../../../../node_modules/", import.meta.url));
  const voydCheckoutRoot = fileURLToPath(new URL("../../../../.voyd-source/", import.meta.url));
  const voydRoot = realpathSync(voydCheckoutRoot);
  const swapCase = (value: string): string => value.replace(/[A-Za-z]/g, (character) => character === character.toUpperCase() ? character.toLowerCase() : character.toUpperCase());
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(processUrl), [], {
      serialization: "advanced",
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      // Do not expose host credentials to the compiler process. The compiler
      // needs no ambient configuration; source mode only needs the loader's
      // cache switch while running this package's tests.
      env: sourceMode ? { TSX_DISABLE_CACHE: "1" } : {},
      execArgv: [
        `--max-old-space-size=${profile.compilerMemoryMb}`,
        "--stack-size=8192",
        "--permission",
        `--allow-fs-read=${packageRoot}`,
        `--allow-fs-read=${workspaceNodeModules}`,
        `--allow-fs-read=${voydCheckoutRoot}`,
        `--allow-fs-read=${voydRoot}`,
        ...(sourceMode ? [`--allow-fs-read=${workspaceRoot}`] : []),
        ...(sourceMode ? [`--allow-fs-read=${swapCase(packageRoot)}`, `--allow-fs-read=${swapCase(workspaceRoot)}`] : []),
        ...(sourceMode ? ["--allow-worker"] : []),
        ...(sourceMode ? ["--import", "tsx"] : []),
      ],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { if (stderr.length < 500) stderr += chunk.toString("utf8", 0, 500 - stderr.length); });
    let settled = false;
    const finish = (result: RestrictedCompilerResult): void => {
      if (settled) return;
      settled = true; clearTimeout(timeout); child.kill("SIGKILL"); resolve(result);
    };
    const timeout = setTimeout(() => finish({ success: false, diagnostics: [], infrastructureError: "compiler timeout" }), profile.compileTimeoutMs);
    child.once("message", (message: unknown) => {
      if (!message || typeof message !== "object") { finish({ success: false, diagnostics: [], infrastructureError: "invalid compiler response" }); return; }
      const result = message as RestrictedCompilerResult;
      const approximateBytes = result.success && result.wasm ? result.wasm.byteLength : new TextEncoder().encode(JSON.stringify(result.diagnostics ?? [])).byteLength;
      if (approximateBytes > profile.maxCompilerOutputBytes) { finish({ success: false, diagnostics: [], infrastructureError: "compiler output limit" }); return; }
      finish(result);
    });
    child.once("error", (cause) => { if (!settled) { settled = true; clearTimeout(timeout); reject(new TessylNativeError({ code: "compile_failed", phase: "compile", message: "Voyd compiler process failed", cause })); } });
    child.once("exit", (code) => { if (!settled && code !== 0) finish({ success: false, diagnostics: [], infrastructureError: `compiler process exited: ${stderr.trim().slice(0, 300)}` }); });
    child.send(input);
  });
};
