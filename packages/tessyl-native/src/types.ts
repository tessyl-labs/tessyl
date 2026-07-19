export type NativeBuildProfile = "standard-v1";
export type CapabilityProfileName = "public-v2";
export type ResourceProfileName = "standard-v1";

export type TesseraSourceBundle = {
  entry: string;
  files: Readonly<Record<string, string>>;
};

export type TesseraAuthorManifest = {
  title: string;
  sdkVersion: 2;
  metadata?: Omit<TesseraMetadataV1, "version" | "title">;
  fallback?: TesseraFallbackPlanV1;
  inputs?: readonly TesseraInputDefinitionV1[];
  datasets?: readonly TesseraDatasetReferenceV1[];
  assets?: readonly TesseraAssetReferenceV1[];
};

export type TesseraCitationV1 = {
  title: string;
  url?: string;
  license?: string;
  dataset?: string;
};

export type TesseraMetadataV1 = {
  version: 1;
  title: string;
  accessibleName: string;
  purpose: string;
  caption?: string;
  instructions?: readonly string[];
  assumptions?: readonly string[];
  limitations?: readonly string[];
  authors?: readonly string[];
  reviewers?: readonly string[];
  citations?: readonly TesseraCitationV1[];
  revision: string;
  unitsPolicy?: string;
};

export type TesseraFallbackInteractionV1 = {
  targetLabel: string;
  event: "click" | "input" | "change";
  value?: string | number | boolean;
};

export type TesseraFallbackPlanV1 = {
  version: 1;
  interactions?: readonly TesseraFallbackInteractionV1[];
  essentialContent?: readonly string[];
};

export type TesseraInputDefinitionV1 = {
  name: string;
  type: "number" | "string" | "boolean";
  required?: boolean;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  maxLength?: number;
};

export type TesseraDatasetReferenceV1 = {
  id: string;
  revision: string;
  contentHash: string;
  mediaType: "application/json" | "text/csv";
  byteLength: number;
  citation: string;
};

export type TesseraAssetReferenceV1 = {
  id: string;
  revision: string;
  contentHash: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/svg+xml";
  byteLength: number;
  accessibleName: string;
  license: string;
};

export type TesseraResourceContractV1 = {
  version: 1;
  inputs: readonly TesseraInputDefinitionV1[];
  datasets: readonly TesseraDatasetReferenceV1[];
  assets: readonly TesseraAssetReferenceV1[];
  shareableState: true;
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
  event: "click" | "input" | "change" | "keydown" | "keyup" | "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "mouseenter" | "mouseleave" | "wheel" | "focus" | "blur";
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

export type TesseraManifestV2 = {
  schemaVersion: 2;
  frameProtocolVersion: 1;
  rpcProtocolVersion: 1;
  sdkVersion: "2";
  vxRuntimeVersion: string;
  compilerVersion: string;
  sourceHash: string;
  dependencyLockHash: string;
  wasmHash: string;
  fallbackHash: string;
  buildProvenanceHash: string;
  metadataHash: string;
  resourcesHash: string;
  entrypoint: "app";
  capabilityProfile: CapabilityProfileName;
  resourceProfile: ResourceProfileName;
};

export type TesseraArtifactV2 = {
  manifest: TesseraManifestV2;
  wasm: Uint8Array;
  sourceBundle: Uint8Array;
  dependencyLock: TesseraDependencyLockV1;
  fallback: NativeStaticFrameV1;
  buildProvenance: NativeBuildProvenanceV1;
  metadata: TesseraMetadataV1;
  resources: TesseraResourceContractV1;
};
export type TesseraArtifact = TesseraArtifactV2;

export type CompileTesseraInput = {
  source: TesseraSourceBundle;
  authorManifest: TesseraAuthorManifest;
  profile: NativeBuildProfile;
};
export type CompileTesseraResult =
  | { ok: true; artifact: TesseraArtifactV2; diagnostics: readonly NativeDiagnostic[] }
  | { ok: false; diagnostics: readonly NativeDiagnostic[] };

export type TesseraPresentation = {
  expandedView?: boolean;
  height?: "compact" | "standard" | "tall";
};
export type TesseraStatus =
  | "loading"
  | "initialized"
  | "starting"
  | "running"
  | "paused"
  | "failed"
  | "unsupported"
  | "disposed";

export type TesseraInputValues = Readonly<Record<string, string | number | boolean>>;

export type InitializeTesseraInput = {
  artifact: TesseraArtifact;
  container: HTMLElement;
  presentation?: TesseraPresentation;
  inputs?: TesseraInputValues;
  datasets?: Readonly<Record<string, Uint8Array>>;
  assets?: Readonly<Record<string, Uint8Array>>;
  shareableState?: string;
  signal?: AbortSignal;
  onStatusChange?: (status: TesseraStatus) => void;
};
export type RunTesseraInput = InitializeTesseraInput;

export interface TesseraInstance {
  readonly status: TesseraStatus;
  run(): Promise<void>;
  reset(): Promise<void>;
  restart(): Promise<void>;
  setActive(active: boolean): void;
  setExpandedView(expanded: boolean): void;
  getShareableState(): string;
  exportResult(): Promise<Blob>;
  dispose(): void;
}

export type NativeTelemetryEvent = {
  phase: "compile" | "initialize" | "run";
  outcome: "success" | "rejected" | "failed";
  code?: string;
  durationMs: number;
  revision?: string;
  resourceBucket?: string;
  capabilitySource?: "author" | "runtime" | "host";
  restartCategory?: "manual" | "failure" | "visibility";
};
export type NativeTelemetry = { record(event: NativeTelemetryEvent): void };

export type TessylNativeConfig = {
  runtime?: {
    onArticleLink: (slug: string) => void;
    onInspectSource?: (source: Readonly<Record<string, string>>, metadata: TesseraMetadataV1) => void;
    onInspectProvenance?: (artifact: TesseraArtifactV2) => void;
    onExpandedViewChange?: (expanded: boolean) => void;
    onShareableStateChange?: (state: string) => void;
  };
  telemetry?: NativeTelemetry;
};

export interface TessylNative {
  compile(input: CompileTesseraInput): Promise<CompileTesseraResult>;
  check(input: CompileTesseraInput): Promise<readonly NativeDiagnostic[]>;
  test(input: CompileTesseraInput): Promise<readonly NativeDiagnostic[]>;
  build(input: CompileTesseraInput): Promise<CompileTesseraResult>;
  preview(input: CompileTesseraInput): Promise<CompileTesseraResult & { fallbackHtml?: string }>;
  initialize(input: InitializeTesseraInput): Promise<TesseraInstance>;
  run(input: RunTesseraInput): Promise<TesseraInstance>;
}
