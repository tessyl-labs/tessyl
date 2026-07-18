import { validateArtifactIntegrity, validateArtifactStructure } from "./build/artifact.js";
import { BrowserTesseraInstance } from "./controller/browser-instance.js";
import { TessylNativeError } from "./errors.js";
import type { CompileTesseraInput, CompileTesseraResult, TesseraArtifactV1, TessylNative, TessylNativeConfig } from "./types.js";

type Compiler = (input: CompileTesseraInput) => Promise<CompileTesseraResult>;
const recordTelemetry = (config: TessylNativeConfig, event: Parameters<NonNullable<TessylNativeConfig["telemetry"]>["record"]>[0]): void => {
  try { config.telemetry?.record(event); } catch { /* Observability must not control lifecycle correctness. */ }
};
const deepFreeze = (value: unknown): void => {
  if (!value || typeof value !== "object" || ArrayBuffer.isView(value) || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
};
const snapshotArtifact = (artifact: TesseraArtifactV1): TesseraArtifactV1 => {
  const cloned = structuredClone(artifact);
  const snapshot: TesseraArtifactV1 = {
    ...cloned,
    wasm: new Uint8Array(artifact.wasm),
    sourceBundle: new Uint8Array(artifact.sourceBundle),
  };
  deepFreeze(snapshot);
  return snapshot;
};

export const createFacade = (config: TessylNativeConfig, compiler?: Compiler): TessylNative => {
  const initialize: TessylNative["initialize"] = async (input) => {
    const started = performance.now();
    let instance: BrowserTesseraInstance | undefined;
    try {
      if (typeof document === "undefined" || typeof Worker === "undefined") throw new TessylNativeError({ code: "configuration", phase: "configuration", message: "Tessera runtime requires a browser Worker environment" });
      if (input.signal?.aborted) throw new TessylNativeError({ code: "disposed", phase: "initialize", message: "Initialization was aborted" });
      const validated = validateArtifactStructure(input.artifact);
      const artifact = snapshotArtifact(validated);
      await validateArtifactIntegrity(artifact);
      if (input.signal?.aborted) throw new TessylNativeError({ code: "disposed", phase: "initialize", message: "Initialization was aborted" });
      instance = new BrowserTesseraInstance({ ...input, artifact }, config);
      await instance.initializeRenderer();
      recordTelemetry(config, { phase: "initialize", outcome: "success", durationMs: performance.now() - started });
      return instance;
    } catch (error) {
      instance?.dispose();
      recordTelemetry(config, { phase: "initialize", outcome: "failed", code: error instanceof TessylNativeError ? error.code : "invalid_artifact", durationMs: performance.now() - started });
      throw error;
    }
  };
  return {
    async compile(input) {
    const started = performance.now();
    try {
      if (!compiler) throw new TessylNativeError({ code: "configuration", phase: "configuration", message: "Compilation is unavailable in the browser runtime" });
      const result = await compiler(input);
      recordTelemetry(config, { phase: "compile", outcome: result.ok ? "success" : "rejected", durationMs: performance.now() - started });
      return result;
    } catch (error) {
      recordTelemetry(config, { phase: "compile", outcome: "failed", code: error instanceof TessylNativeError ? error.code : "compile_failed", durationMs: performance.now() - started });
      throw error;
    }
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
