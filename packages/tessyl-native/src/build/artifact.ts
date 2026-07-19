import { TessylNativeError } from "../errors.js";
import { resourceProfile } from "../profiles.js";
import { validateStaticFrame } from "../protocol/validate.js";
import type { TesseraArtifact, TesseraArtifactV2 } from "../types.js";
import { canonicalJson, sha256 } from "./canonical.js";
import { inspectWasm } from "./wasm.js";
import { NATIVE_SDK_VERSION, VOYD_COMPILER_ABI_VERSION, VX_RUNTIME_ABI_VERSION } from "../versions.js";

export const validateArtifact = async (artifact: TesseraArtifact): Promise<TesseraArtifactV2> => {
  const validated = validateArtifactStructure(artifact);
  const snapshot = structuredClone(validated);
  snapshot.wasm = new Uint8Array(validated.wasm);
  snapshot.sourceBundle = new Uint8Array(validated.sourceBundle);
  return validateArtifactIntegrity(snapshot);
};

export const validateArtifactIntegrity = async (validated: TesseraArtifactV2): Promise<TesseraArtifactV2> => {
  const manifest = validated.manifest;
  const hashes = await Promise.all([
    sha256(validated.wasm),
    sha256(validated.sourceBundle),
    sha256(canonicalJson(validated.dependencyLock)),
    sha256(canonicalJson(validated.fallback)),
    sha256(canonicalJson(validated.buildProvenance)),
    sha256(canonicalJson(validated.metadata)),
    sha256(canonicalJson(validated.resources)),
  ]);
  const expected = [manifest.wasmHash, manifest.sourceHash, manifest.dependencyLockHash, manifest.fallbackHash, manifest.buildProvenanceHash, manifest.metadataHash, manifest.resourcesHash];
  if (hashes.some((hash, index) => hash !== expected[index])) invalid("Artifact component hash mismatch");
  return validated;
};

export const validateArtifactStructure = (artifact: TesseraArtifact): TesseraArtifactV2 => {
  const record = plainRecord(artifact, "Artifact");
  exactKeys(record, ["manifest", "wasm", "sourceBundle", "dependencyLock", "fallback", "buildProvenance", "metadata", "resources"], "Artifact");
  const manifest = artifact.manifest;
  const manifestRecord = plainRecord(manifest, "Manifest");
  exactKeys(manifestRecord, ["schemaVersion", "frameProtocolVersion", "rpcProtocolVersion", "sdkVersion", "vxRuntimeVersion", "compilerVersion", "sourceHash", "dependencyLockHash", "wasmHash", "fallbackHash", "buildProvenanceHash", "metadataHash", "resourcesHash", "entrypoint", "capabilityProfile", "resourceProfile"], "Manifest");
  if (
    manifest.schemaVersion !== 2 ||
    manifest.frameProtocolVersion !== 1 ||
    manifest.rpcProtocolVersion !== 1 ||
    manifest.sdkVersion !== NATIVE_SDK_VERSION ||
    manifest.vxRuntimeVersion !== VX_RUNTIME_ABI_VERSION ||
    manifest.compilerVersion !== VOYD_COMPILER_ABI_VERSION ||
    manifest.entrypoint !== "app" ||
    manifest.capabilityProfile !== "public-v2" ||
    manifest.resourceProfile !== "standard-v1"
  ) invalid("Artifact version tuple is unsupported", "unsupported_version");
  for (const hash of [manifest.sourceHash, manifest.dependencyLockHash, manifest.wasmHash, manifest.fallbackHash, manifest.buildProvenanceHash, manifest.metadataHash, manifest.resourcesHash]) {
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) invalid("Manifest contains an invalid content hash");
  }
  const profile = resourceProfile(manifest.resourceProfile);
  if (!(artifact.wasm instanceof Uint8Array) || !(artifact.sourceBundle instanceof Uint8Array)) invalid("Artifact byte fields are invalid");
  if (isSharedView(artifact.wasm) || isSharedView(artifact.sourceBundle)) invalid("Artifact byte fields cannot use shared memory");
  if (artifact.sourceBundle.byteLength > profile.maxSourceBytes) invalid("Source bundle exceeds its resource limit", "resource_limit");
  validateSourceBundle(artifact.sourceBundle, profile.maxSourceBytes);
  validateDependencyLock(artifact.dependencyLock);
  const provenance = plainRecord(artifact.buildProvenance, "Build provenance");
  exactKeys(provenance, ["version", "builder", "profile", "reproducible"], "Build provenance");
  if (provenance.version !== 1 || provenance.builder !== "@tessyl/native" || provenance.profile !== "standard-v1" || provenance.reproducible !== true) invalid("Build provenance is invalid");
  validateMetadataContract(artifact.metadata);
  validateResourcesContract(artifact.resources, profile.maxDatasetBytes, profile.maxAssetBytes);
  try { validateStaticFrame(artifact.fallback, profile); }
  catch (error) {
    const code = error instanceof TessylNativeError && error.code === "resource_limit" ? "resource_limit" : "invalid_artifact";
    throw new TessylNativeError({ code, phase: "initialize", message: "Artifact fallback is invalid", cause: error });
  }
  validateFallbackAssets(artifact);
  try { inspectWasm(artifact.wasm, profile); }
  catch (error) {
    if (error instanceof TessylNativeError) throw new TessylNativeError({ code: error.code, phase: "initialize", message: error.message, recoverable: error.recoverable, cause: error });
    throw error;
  }
  return artifact;
};

const validateFallbackAssets = (artifact: TesseraArtifactV2): void => {
  const declared = new Map(artifact.resources.assets.map((asset) => [asset.id, asset.accessibleName]));
  const stack = [artifact.fallback.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === "fragment") { stack.push(...node.children); continue; }
    if (node.kind !== "element") continue;
    const id = node.attrs?.["data-native-asset-id"];
    if (id !== undefined && (typeof id !== "string" || node.tag !== "img" || !declared.has(id) || node.attrs?.["aria-label"] !== declared.get(id))) invalid("Fallback reviewed asset metadata does not match its resource declaration");
    stack.push(...(node.children ?? []));
  }
};

export const validateMetadataContract = (value: unknown): void => {
  const metadata = plainRecord(value, "Metadata");
  exactKeys(metadata, ["version", "title", "accessibleName", "purpose", "caption", "instructions", "assumptions", "limitations", "authors", "reviewers", "citations", "revision", "unitsPolicy"], "Metadata");
  if (metadata.version !== 1) invalid("Metadata version is unsupported");
  for (const key of ["title", "accessibleName", "purpose", "revision"] as const) if (typeof metadata[key] !== "string" || !(metadata[key] as string).trim() || (metadata[key] as string).length > 1_000) invalid(`Metadata ${key} is invalid`);
  for (const key of ["instructions", "assumptions", "limitations", "authors", "reviewers"] as const) {
    const entries = metadata[key];
    if (entries !== undefined) {
      if (!Array.isArray(entries) || entries.length > 32) invalid(`Metadata ${key} is invalid`);
      const strings = entries as unknown[];
      rejectAccessors(strings, `Metadata ${key}`);
      if (strings.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 1_000)) invalid(`Metadata ${key} is invalid`);
    }
  }
  for (const key of ["caption", "unitsPolicy"] as const) if (metadata[key] !== undefined && !boundedText(metadata[key])) invalid(`Metadata ${key} is invalid`);
  if (metadata.citations !== undefined) {
    if (!Array.isArray(metadata.citations) || metadata.citations.length > 64) invalid("Metadata citations are invalid");
    const citations = metadata.citations as unknown[];
    rejectAccessors(citations, "Metadata citations");
    for (const item of citations) {
      const citation = plainRecord(item, "Metadata citation");
      exactKeys(citation, ["title", "url", "license", "dataset"], "Metadata citation");
      if (!boundedText(citation.title)) invalid("Metadata citation title is invalid");
      for (const key of ["url", "license", "dataset"] as const) if (citation[key] !== undefined && !boundedText(citation[key])) invalid(`Metadata citation ${key} is invalid`);
      if (typeof citation.url === "string" && !/^https:\/\/[A-Za-z0-9]/.test(citation.url)) invalid("Metadata citation URL must use HTTPS");
    }
  }
};

export const validateResourcesContract = (value: unknown, maxDatasetBytes: number, maxAssetBytes: number): void => {
  const resources = plainRecord(value, "Resources");
  exactKeys(resources, ["version", "inputs", "datasets", "assets", "shareableState"], "Resources");
  if (resources.version !== 1 || resources.shareableState !== true || !Array.isArray(resources.inputs) || !Array.isArray(resources.datasets) || !Array.isArray(resources.assets)) invalid("Resource contract is invalid");
  const inputs = resources.inputs as unknown[];
  const datasets = resources.datasets as unknown[];
  const assets = resources.assets as unknown[];
  if (inputs.length > 64 || datasets.length > 64 || assets.length > 64) invalid("Resource contract exceeds its entry limit", "resource_limit");
  for (const list of [inputs, datasets, assets]) rejectAccessors(list, "Resource entries");
  const inputNames = new Set<string>();
  for (const item of inputs) {
    const entry = plainRecord(item, "Input definition");
    exactKeys(entry, ["name", "type", "required", "default", "min", "max", "maxLength"], "Input definition");
    if (typeof entry.name !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(entry.name) || inputNames.has(entry.name) || !["number", "string", "boolean"].includes(String(entry.type))) invalid("Input definition is invalid");
    inputNames.add(entry.name as string);
    if (entry.required !== undefined && typeof entry.required !== "boolean") invalid("Input required flag is invalid");
    if (entry.default !== undefined && typeof entry.default !== entry.type) invalid("Input default has the wrong type");
    if (entry.type === "number") {
      if (entry.min !== undefined && !finiteNumber(entry.min)) invalid("Input minimum is invalid");
      if (entry.max !== undefined && !finiteNumber(entry.max)) invalid("Input maximum is invalid");
      if (finiteNumber(entry.min) && finiteNumber(entry.max) && entry.min > entry.max) invalid("Input bounds are invalid");
      if (finiteNumber(entry.default) && ((finiteNumber(entry.min) && entry.default < entry.min) || (finiteNumber(entry.max) && entry.default > entry.max))) invalid("Input default is outside its bounds");
      if (entry.maxLength !== undefined) invalid("Number inputs cannot declare maxLength");
    } else {
      if (entry.min !== undefined || entry.max !== undefined) invalid("Non-number inputs cannot declare numeric bounds");
      if (entry.type === "string") {
        if (entry.maxLength !== undefined && (!Number.isInteger(entry.maxLength) || (entry.maxLength as number) < 1 || (entry.maxLength as number) > 8_192)) invalid("String input maxLength is invalid");
        if (typeof entry.default === "string" && new TextEncoder().encode(entry.default).byteLength > Number(entry.maxLength ?? 8_192)) invalid("String input default is too large", "resource_limit");
      } else if (entry.maxLength !== undefined) invalid("Boolean inputs cannot declare maxLength");
    }
  }
  const ids = new Set<string>();
  let datasetBytes = 0;
  let assetBytes = 0;
  for (const [kind, entries, maxBytes, mediaTypes] of [
    ["Dataset", datasets, maxDatasetBytes, new Set(["application/json", "text/csv"])],
    ["Asset", assets, maxAssetBytes, new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"])],
  ] as const) for (const item of entries) {
    const entry = plainRecord(item, `${kind} reference`);
    exactKeys(entry, kind === "Dataset" ? ["id", "revision", "contentHash", "mediaType", "byteLength", "citation"] : ["id", "revision", "contentHash", "mediaType", "byteLength", "accessibleName", "license"], `${kind} reference`);
    if (typeof entry.id !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(entry.id) || ids.has(entry.id) || !boundedText(entry.revision) || typeof entry.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(entry.contentHash) || !mediaTypes.has(entry.mediaType as never) || !Number.isInteger(entry.byteLength) || (entry.byteLength as number) < 0 || (entry.byteLength as number) > maxBytes) invalid(`${kind} reference is invalid`);
    if (kind === "Dataset" && !boundedText(entry.citation)) invalid("Dataset citation is invalid");
    if (kind === "Asset" && (!boundedText(entry.accessibleName) || !boundedText(entry.license))) invalid("Asset accessibility or license metadata is invalid");
    ids.add(entry.id as string);
    if (kind === "Dataset") datasetBytes += entry.byteLength as number; else assetBytes += entry.byteLength as number;
  }
  if (datasetBytes > maxDatasetBytes || assetBytes > maxAssetBytes) invalid("Aggregate resource bytes exceed the profile", "resource_limit");
};

const boundedText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 1_000;
const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const SOURCE_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]+\.voyd$/;
const validateSourceBundle = (bytes: Uint8Array, maxBytes: number): void => {
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { invalid("Source bundle is not canonical UTF-8 JSON"); }
  const bundle = plainRecord(decoded, "Source bundle");
  exactKeys(bundle, ["entry", "files"], "Source bundle");
  const files = plainRecord(bundle.files, "Source files");
  const entries = Object.entries(files);
  if (typeof bundle.entry !== "string" || new TextEncoder().encode(bundle.entry).byteLength > 240 || !SOURCE_PATH_RE.test(bundle.entry) || !(bundle.entry in files)) invalid("Source bundle entry is invalid");
  if (entries.length > 64) invalid("Source bundle contains too many files", "resource_limit");
  let total = 0;
  for (const [name, source] of entries) {
    const nameBytes = new TextEncoder().encode(name).byteLength;
    if (nameBytes > 240 || !SOURCE_PATH_RE.test(name)) invalid("Source bundle file path is invalid");
    if (typeof source !== "string") invalid("Source bundle file contents are invalid");
    total += nameBytes + new TextEncoder().encode(source as string).byteLength;
    if (total > maxBytes) invalid("Source bundle exceeds its decoded resource limit", "resource_limit");
  }
};

const validateDependencyLock = (value: unknown): void => {
  const lock = plainRecord(value, "Dependency lock");
  exactKeys(lock, ["version", "packages"], "Dependency lock");
  const packages = lock.packages;
  if (lock.version !== 1 || !Array.isArray(packages) || packages.length < 1 || packages.length > 64) invalid("Dependency lock is invalid");
  rejectAccessors(packages as object, "Dependency packages");
  const names = new Set<string>();
  for (const item of packages as unknown[]) {
    const entry = plainRecord(item, "Dependency entry");
    exactKeys(entry, ["name", "version", "contentHash"], "Dependency entry");
    if (typeof entry.name !== "string" || entry.name.length > 100 || names.has(entry.name) || typeof entry.version !== "string" || entry.version.length > 80 || typeof entry.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(entry.contentHash)) invalid("Dependency lock entry is invalid");
    names.add(entry.name as string);
  }
};

const plainRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} is not an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(`${label} has an invalid prototype`);
  rejectAccessors(value as object, label);
  return value as Record<string, unknown>;
};

const rejectAccessors = (value: object, label: string): void => {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") invalid(`${label} contains a symbol key`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.get || descriptor?.set) invalid(`${label} contains an accessor property`);
  }
};

const isSharedView = (value: Uint8Array): boolean => typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer;

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[], label: string): void => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid(`${label} contains an unknown field`);
};

const invalid = (message: string, code: "invalid_artifact" | "unsupported_version" | "resource_limit" = "invalid_artifact"): never => {
  throw new TessylNativeError({ code, phase: "initialize", message, recoverable: code !== "invalid_artifact" });
};
