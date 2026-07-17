import { compileTessera } from "./build/compiler.js";
import { createFacade } from "./facade.js";
import type { TessylNative, TessylNativeConfig } from "./types.js";

export { TessylNativeError } from "./errors.js";
export type { NativeErrorCode } from "./errors.js";
export type {
  CapabilityProfileName,
  CompileTesseraInput,
  CompileTesseraResult,
  InitializeTesseraInput,
  NativeBuildProfile,
  NativeDiagnostic,
  NativeTelemetry,
  NativeTelemetryEvent,
  ResourceProfileName,
  RunTesseraInput,
  TesseraArtifact,
  TesseraArtifactV1,
  TesseraAuthorManifest,
  TesseraDependencyLockV1,
  TesseraInstance,
  TesseraManifestV1,
  TesseraPresentation,
  TesseraSourceBundle,
  TesseraStatus,
  TessylNative,
  TessylNativeConfig,
} from "./types.js";

export const createTessylNative = (config: TessylNativeConfig = {}): TessylNative => createFacade(config, compileTessera);
