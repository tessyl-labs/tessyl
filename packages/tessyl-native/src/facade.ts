import { validateArtifactIntegrity, validateArtifactStructure } from "./build/artifact.js";
import { BrowserTesseraInstance } from "./controller/browser-instance.js";
import { TessylNativeError } from "./errors.js";
import { renderUnsupportedShell } from "./controller/shell.js";
import { renderStaticFallbackHtml } from "./fallback-renderer.js";
import { sha256 } from "./build/canonical.js";
import { resourceProfile } from "./profiles.js";
import type { CompileTesseraInput, CompileTesseraResult, TesseraArtifactV2, TessylNative, TessylNativeConfig } from "./types.js";

type CompilerPipeline = {
  build(input: CompileTesseraInput): Promise<CompileTesseraResult>;
  check(input: CompileTesseraInput): Promise<readonly import("./types.js").NativeDiagnostic[]>;
  test(input: CompileTesseraInput): Promise<readonly import("./types.js").NativeDiagnostic[]>;
};
const recordTelemetry = (config: TessylNativeConfig, event: Parameters<NonNullable<TessylNativeConfig["telemetry"]>["record"]>[0]): void => {
  try { config.telemetry?.record(event); } catch { /* Observability must not control lifecycle correctness. */ }
};
const deepFreeze = (value: unknown): void => {
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value) || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
};
const snapshotArtifact = (artifact: TesseraArtifactV2): TesseraArtifactV2 => {
  const cloned = structuredClone(artifact);
  const snapshot: TesseraArtifactV2 = {
    ...cloned,
    wasm: new Uint8Array(artifact.wasm),
    sourceBundle: new Uint8Array(artifact.sourceBundle),
  };
  deepFreeze(snapshot);
  return snapshot;
};

export const createFacade = (config: TessylNativeConfig, compiler?: CompilerPipeline): TessylNative => {
  const compile: TessylNative["compile"] = async (input) => {
    const started = performance.now();
    try {
      if (!compiler) throw new TessylNativeError({ code: "configuration", phase: "configuration", message: "Compilation is unavailable in the browser runtime" });
      const result = await compiler.build(input);
      recordTelemetry(config, { phase: "compile", outcome: result.ok ? "success" : "rejected", durationMs: performance.now() - started });
      return result;
    } catch (error) {
      recordTelemetry(config, { phase: "compile", outcome: "failed", code: error instanceof TessylNativeError ? error.code : "compile_failed", durationMs: performance.now() - started });
      throw error;
    }
  };
  const initialize: TessylNative["initialize"] = async (input) => {
    const started = performance.now();
    let instance: BrowserTesseraInstance | undefined;
    try {
      if (typeof document === "undefined" || typeof Worker === "undefined") throw new TessylNativeError({ code: "configuration", phase: "configuration", message: "Tessera runtime requires a browser Worker environment" });
      if (input.signal?.aborted) throw new TessylNativeError({ code: "disposed", phase: "initialize", message: "Initialization was aborted" });
      const validated = validateArtifactStructure(input.artifact);
      const artifact = snapshotArtifact(validated);
      const inputs = Object.freeze({ ...(input.inputs ?? {}) });
      const datasets = snapshotSuppliedBytes(input.datasets ?? {});
      const assets = snapshotSuppliedBytes(input.assets ?? {});
      await validateArtifactIntegrity(artifact);
      validateInputs(artifact, inputs);
      await validateDatasets(artifact, datasets);
      await validateAssets(artifact, assets);
      if (input.signal?.aborted) throw new TessylNativeError({ code: "disposed", phase: "initialize", message: "Initialization was aborted" });
      instance = new BrowserTesseraInstance({ ...input, artifact, inputs, datasets, assets }, config);
      await instance.initializeRenderer();
      recordTelemetry(config, { phase: "initialize", outcome: "success", durationMs: performance.now() - started });
      return instance;
    } catch (error) {
      instance?.dispose();
      if (error instanceof TessylNativeError && error.code === "unsupported_version") {
        renderUnsupportedShell(input.container, "Unsupported interactive");
        try { input.onStatusChange?.("unsupported"); } catch { /* Integration callbacks are observational. */ }
      }
      recordTelemetry(config, { phase: "initialize", outcome: "failed", code: error instanceof TessylNativeError ? error.code : "invalid_artifact", durationMs: performance.now() - started });
      throw error;
    }
  };
  return {
    compile,
    async check(input) { if (!compiler) throw new TessylNativeError({ code: "configuration", phase: "configuration", message: "Checking is unavailable in the browser runtime" }); return compiler.check(input); },
    async test(input) { if (!compiler) throw new TessylNativeError({ code: "configuration", phase: "configuration", message: "Testing is unavailable in the browser runtime" }); return compiler.test(input); },
    build: compile,
    async preview(input) {
      const result = await compile(input);
      return result.ok ? { ...result, fallbackHtml: renderStaticFallbackHtml(result.artifact.fallback) } : result;
    },
    initialize,
    async run(input) {
      const started = performance.now();
      const instance = await initialize(input);
      try {
        await instance.run();
        recordTelemetry(config, { phase: "run", outcome: "success", durationMs: performance.now() - started });
        return instance;
      } catch (error) {
        instance.dispose();
        throw error;
      }
    },
  };
};

const validateInputs = (artifact: TesseraArtifactV2, supplied: Readonly<Record<string, string | number | boolean>>): void => {
  const definitions = new Map(artifact.resources.inputs.map((definition) => [definition.name, definition]));
  for (const name of Object.keys(supplied)) if (!definitions.has(name)) throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: `Unknown Tessera input: ${name.slice(0, 64)}` });
  for (const definition of definitions.values()) {
    const value = supplied[definition.name] ?? definition.default;
    if (value === undefined) {
      if (definition.required) throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: `Required Tessera input is missing: ${definition.name}` });
      continue;
    }
    if (typeof value !== definition.type) throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: `Tessera input has the wrong type: ${definition.name}` });
    if (typeof value === "number" && (!Number.isFinite(value) || (definition.min !== undefined && value < definition.min) || (definition.max !== undefined && value > definition.max))) throw new TessylNativeError({ code: "resource_limit", phase: "initialize", message: `Tessera input is outside its declared bounds: ${definition.name}`, recoverable: true });
    if (typeof value === "string" && new TextEncoder().encode(value).byteLength > (definition.maxLength ?? 8_192)) throw new TessylNativeError({ code: "resource_limit", phase: "initialize", message: `Tessera input is too large: ${definition.name}`, recoverable: true });
  }
};

const validateAssets = async (artifact: TesseraArtifactV2, supplied: Readonly<Record<string, Uint8Array>>): Promise<void> => {
  const definitions = new Map(artifact.resources.assets.map((definition) => [definition.id, definition]));
  for (const id of Object.keys(supplied)) if (!definitions.has(id)) throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: `Unknown reviewed asset: ${id.slice(0, 64)}` });
  for (const [id, definition] of definitions) {
    const bytes = supplied[id];
    if (!(bytes instanceof Uint8Array) || isSharedBytes(bytes) || bytes.byteLength !== definition.byteLength || bytes.byteLength > 8 * 1024 * 1024) throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: `Required reviewed asset is missing or invalid: ${id.slice(0, 64)}` });
    if (await sha256(bytes) !== definition.contentHash) throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: `Reviewed asset hash mismatch: ${id.slice(0, 64)}` });
  }
};

const validateDatasets = async (artifact: TesseraArtifactV2, supplied: Readonly<Record<string, Uint8Array>>): Promise<void> => {
  const definitions = new Map(artifact.resources.datasets.map((definition) => [definition.id, definition]));
  for (const id of Object.keys(supplied)) if (!definitions.has(id)) throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: `Unknown pinned dataset: ${id.slice(0, 64)}` });
  for (const [id, definition] of definitions) {
    const bytes = supplied[id];
    if (!(bytes instanceof Uint8Array) || isSharedBytes(bytes) || bytes.byteLength !== definition.byteLength || bytes.byteLength > resourceProfile(artifact.manifest.resourceProfile).maxDatasetBytes) throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: `Required pinned dataset is missing or invalid: ${id.slice(0, 64)}` });
    if (await sha256(bytes) !== definition.contentHash) throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: `Pinned dataset hash mismatch: ${id.slice(0, 64)}` });
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: `Pinned dataset is not valid UTF-8: ${id.slice(0, 64)}` }); }
    if (definition.mediaType === "application/json") try { JSON.parse(text); } catch { throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: `Pinned JSON dataset is malformed: ${id.slice(0, 64)}` }); }
  }
};

const isSharedBytes = (bytes: Uint8Array): boolean => typeof SharedArrayBuffer !== "undefined" && bytes.buffer instanceof SharedArrayBuffer;
const snapshotSuppliedBytes = (entries: Readonly<Record<string, Uint8Array>>): Readonly<Record<string, Uint8Array>> => Object.freeze(Object.fromEntries(Object.entries(entries).map(([id, bytes]) => {
  if (!(bytes instanceof Uint8Array) || isSharedBytes(bytes)) throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: `Supplied binary resource is invalid: ${id.slice(0, 64)}` });
  return [id, bytes.slice()];
})));
