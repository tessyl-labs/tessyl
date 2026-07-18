export type NativeBuildProfile = "standard-v1";
export type CapabilityProfileName = "public-v1";
export type ResourceProfileName = "standard-v1";

export type TesseraSourceBundle = {
  entry: string;
  files: Readonly<Record<string, string>>;
};

export type TesseraAuthorManifest = {
  title: string;
  sdkVersion: 1;
};

export type NativeDiagnostic = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  column?: number;
};

export type TesseraDependencyLockV1 = {
  version: 1;
  packages: readonly {
    name: string;
    version: string;
    contentHash: string;
  }[];
};

export type NativeBuildProvenanceV1 = {
  version: 1;
  builder: "@tessyl/native";
  profile: NativeBuildProfile;
  reproducible: true;
};

export type NativeTextNode = { kind: "text"; value: string; key?: string };
export type NativeFragmentNode = {
  kind: "fragment";
  children: NativeNode[];
  key?: string;
};
export type NativeElementNode = {
  kind: "element";
  tag: string;
  key?: string;
  attrs?: Record<string, string | number | boolean>;
  props?: Record<string, string | number | boolean>;
  events?: NativeEventDescriptor[];
  children?: NativeNode[];
};
export type NativeNode = NativeTextNode | NativeFragmentNode | NativeElementNode;
export type NativeEventDescriptor = {
  kind: "event";
  event: "click" | "input" | "change" | "keydown";
  handlerId?: number;
  mapHandlerIds?: number[];
  message?: unknown;
  options?: {
    preventDefault?: boolean;
    stopPropagation?: boolean;
  };
};
export type NativeFrameV1 = { version: 1; root: NativeNode };
export type NativeStaticFrameV1 = { version: 1; root: NativeNode };

export type TesseraManifestV1 = {
  schemaVersion: 1;
  frameProtocolVersion: 1;
  rpcProtocolVersion: 1;
  sdkVersion: "1";
  vxRuntimeVersion: string;
  compilerVersion: string;
  sourceHash: string;
  dependencyLockHash: string;
  wasmHash: string;
  fallbackHash: string;
  buildProvenanceHash: string;
  entrypoint: "app";
  capabilityProfile: CapabilityProfileName;
  resourceProfile: ResourceProfileName;
};

export type TesseraArtifactV1 = {
  manifest: TesseraManifestV1;
  wasm: Uint8Array;
  sourceBundle: Uint8Array;
  dependencyLock: TesseraDependencyLockV1;
  fallback: NativeStaticFrameV1;
  buildProvenance: NativeBuildProvenanceV1;
};
export type TesseraArtifact = TesseraArtifactV1;

export type CompileTesseraInput = {
  source: TesseraSourceBundle;
  authorManifest: TesseraAuthorManifest;
  profile: NativeBuildProfile;
};
export type CompileTesseraResult =
  | { ok: true; artifact: TesseraArtifactV1; diagnostics: readonly NativeDiagnostic[] }
  | { ok: false; diagnostics: readonly NativeDiagnostic[] };

export type TesseraPresentation = {
  expandedView?: boolean;
  height?: "compact" | "standard" | "tall";
};
export type TesseraStatus =
  | "initialized"
  | "starting"
  | "running"
  | "paused"
  | "failed"
  | "disposed";

export type InitializeTesseraInput = {
  artifact: TesseraArtifact;
  container: HTMLElement;
  presentation?: TesseraPresentation;
  signal?: AbortSignal;
  onStatusChange?: (status: TesseraStatus) => void;
};
export type RunTesseraInput = InitializeTesseraInput;

export interface TesseraInstance {
  readonly status: TesseraStatus;
  run(): Promise<void>;
  reset(): Promise<void>;
  setActive(active: boolean): void;
  dispose(): void;
}

export type NativeTelemetryEvent = {
  phase: "compile" | "initialize" | "run";
  outcome: "success" | "rejected" | "failed";
  code?: string;
  durationMs: number;
};
export type NativeTelemetry = { record(event: NativeTelemetryEvent): void };

export type TessylNativeConfig = {
  runtime?: { onArticleLink: (slug: string) => void };
  telemetry?: NativeTelemetry;
};

export interface TessylNative {
  compile(input: CompileTesseraInput): Promise<CompileTesseraResult>;
  initialize(input: InitializeTesseraInput): Promise<TesseraInstance>;
  run(input: RunTesseraInput): Promise<TesseraInstance>;
}
