import { fork } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TessylNativeError } from "../errors.js";
import { resourceProfile } from "../profiles.js";
import type {
  CompileTesseraInput,
  CompileTesseraResult,
  NativeDiagnostic,
  TesseraArtifactV1,
} from "../types.js";
import { canonicalJson, encodedJson, sha256 } from "./canonical.js";
import { compilerAdmission } from "./compiler-admission.js";
import { inspectToolchain } from "./toolchain.js";
import { NATIVE_SDK_VERSION, VOYD_COMPILER_ABI_VERSION, VX_RUNTIME_ABI_VERSION } from "../versions.js";

const ENTRY_RE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]+\.voyd$/;
const PACKAGE_IMPORT_RE = /\buse\s+pkg::([A-Za-z0-9_-]+)/g;
const STD_IMPORT_RE = /\buse\s+std::([A-Za-z0-9_]+)/g;
const ALLOWED_STD_MODULES = new Set(["array", "dict", "math", "number", "optional", "result", "string"]);
const CAPABILITY_CALL_RE = /\b(Cmd|Sub)(?:<[^>\n]+>)?::([A-Za-z_][A-Za-z0-9_]*)/g;
const ALLOWED_CAPABILITY_METHODS = { Cmd: new Set(["none", "batch", "delay"]), Sub: new Set(["none", "batch", "animation_frame", "container_size"]) } as const;
const FORBIDDEN_SOURCE = [
  /\buse\s+std::vx\b/,
  /\buse\s+std::(?:http|fs|io|process|task|time|random)\b/,
  /@external\b/,
  /\beff\s+[A-Za-z_]/,
  /@effect\b/,
  /\bextern\s+/,
  /\bmsgpack::/,
  /<\/?[a-z][A-Za-z0-9-]*(?:\s|>|\/)/,
];

export const compileTessera = async (input: CompileTesseraInput): Promise<CompileTesseraResult> => {
  const policyDiagnostics = validateBuildInput(input);
  if (policyDiagnostics.length) return { ok: false, diagnostics: policyDiagnostics };
  const profile = resourceProfile(input.profile);
  const releaseCompiler = await compilerAdmission.acquire(profile.maxConcurrentCompilers, profile.maxCompilerQueue, profile.compileTimeoutMs);
  try {
  const entrySource = input.source.files[input.source.entry]!;
  const files = Object.fromEntries(Object.entries(input.source.files).filter(([name]) => name !== input.source.entry));
  const result = await runRestrictedCompiler({ entry: input.source.entry, entrySource, files, profile: input.profile });
  if ("infrastructureError" in result && result.infrastructureError) throw new TessylNativeError({ code: "compile_failed", phase: "compile", message: "Voyd compiler infrastructure failed", cause: new Error(result.infrastructureError) });
  if (!result.success) return { ok: false, diagnostics: result.diagnostics.slice(0, 100).map(toNativeDiagnostic) };
  if (!(result.wasm instanceof Uint8Array) || result.wasm.byteLength > profile.maxWasmBytes || !result.fallback) throw new TessylNativeError({ code: "compile_failed", phase: "compile", message: "Compiler worker returned an invalid result" });
  const sourceBundle = encodedJson({ entry: input.source.entry, files: input.source.files });
  const toolchain = await inspectToolchain();
  if (toolchain.compilerVersion !== VOYD_COMPILER_ABI_VERSION || toolchain.vxRuntimeVersion !== VX_RUNTIME_ABI_VERSION) {
    throw new TessylNativeError({ code: "compile_failed", phase: "compile", message: "Configured Voyd toolchain ABI is unsupported" });
  }
  const dependencyLock = toolchain.dependencyLock;
  const buildProvenance = {
    version: 1 as const,
    builder: "@tessyl/native" as const,
    profile: input.profile,
    reproducible: true as const,
  };
  const fallback = result.fallback;
  const [sourceHash, dependencyLockHash, wasmHash, fallbackHash, buildProvenanceHash] = await Promise.all([
    sha256(sourceBundle),
    sha256(canonicalJson(dependencyLock)),
    sha256(result.wasm),
    sha256(canonicalJson(fallback)),
    sha256(canonicalJson(buildProvenance)),
  ]);
  const artifact: TesseraArtifactV1 = {
    manifest: {
      schemaVersion: 1,
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
      entrypoint: "app",
      capabilityProfile: "public-v1",
      resourceProfile: "standard-v1",
    },
    wasm: result.wasm,
    sourceBundle,
    dependencyLock,
    fallback,
    buildProvenance,
  };
  return { ok: true, artifact, diagnostics: [] };
  } finally {
    releaseCompiler();
  }
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
  if (input.authorManifest.sdkVersion !== 1) out.push(diagnostic("unsupported_sdk", "Unsupported author SDK version"));
  if (!input.authorManifest.title.trim() || new TextEncoder().encode(input.authorManifest.title).byteLength > 200) {
    out.push(diagnostic("invalid_manifest", "Tessera title is required and must be at most 200 bytes"));
  }
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

type RestrictedCompilerInput = { entry: string; entrySource: string; files: Record<string, string>; profile: "standard-v1" };
type RestrictedCompilerResult = { success: true; wasm: Uint8Array; fallback: TesseraArtifactV1["fallback"]; diagnostics: [] } | { success: false; diagnostics: unknown[]; infrastructureError?: string };

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
      const approximateBytes = result.success ? result.wasm?.byteLength ?? Number.POSITIVE_INFINITY : new TextEncoder().encode(JSON.stringify(result.diagnostics ?? [])).byteLength;
      if (approximateBytes > profile.maxCompilerOutputBytes) { finish({ success: false, diagnostics: [], infrastructureError: "compiler output limit" }); return; }
      finish(result);
    });
    child.once("error", (cause) => { if (!settled) { settled = true; clearTimeout(timeout); reject(new TessylNativeError({ code: "compile_failed", phase: "compile", message: "Voyd compiler process failed", cause })); } });
    child.once("exit", (code) => { if (!settled && code !== 0) finish({ success: false, diagnostics: [], infrastructureError: `compiler process exited: ${stderr.trim().slice(0, 300)}` }); });
    child.send(input);
  });
};
