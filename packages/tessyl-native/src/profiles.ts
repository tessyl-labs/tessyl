export type ResourceProfile = {
  readonly maxWasmBytes: number;
  readonly maxWasmSections: number;
  readonly maxWasmTypes: number;
  readonly maxWasmFunctions: number;
  readonly maxWasmGlobals: number;
  readonly maxWasmElementSegments: number;
  readonly maxWasmDataSegments: number;
  readonly maxSourceBytes: number;
  readonly maxBoundaryBytes: number;
  readonly maxBoundaryDepth: number;
  readonly maxBoundaryContainers: number;
  readonly maxBoundaryEntries: number;
  readonly maxBoundaryEntriesPerContainer: number;
  readonly maxFrameBytes: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxChildren: number;
  readonly maxAttributes: number;
  readonly maxStringBytes: number;
  readonly maxHandlers: number;
  readonly maxSubscriptions: number;
  readonly maxCommandNodes: number;
  readonly maxOutstandingDelays: number;
  readonly maxQueue: number;
  readonly maxMemoryPages: number;
  readonly maxTables: number;
  readonly maxTableElements: number;
  readonly maxPlottedPoints: number;
  readonly maxTableCells: number;
  readonly maxSceneObjects: number;
  readonly maxAnimationUpdatesPerSecond: number;
  readonly maxAssetBytes: number;
  readonly maxDatasetBytes: number;
  readonly maxSimulationStepsPerFrame: number;
  readonly maxCanvasPixels: number;
  readonly startupTimeoutMs: number;
  readonly rpcTimeoutMs: number;
  readonly maxTransitionsPerSecond: number;
  readonly maxDelayMs: number;
  readonly maxConcurrentWorkers: number;
  readonly maxRuntimeQueue: number;
  readonly runtimeQueueTimeoutMs: number;
  readonly maxConcurrentCompilers: number;
  readonly maxCompilerQueue: number;
  readonly compileTimeoutMs: number;
  readonly compilerMemoryMb: number;
  readonly maxCompilerOutputBytes: number;
};

export const STANDARD_V1: ResourceProfile = Object.freeze({
  maxWasmBytes: 2 * 1024 * 1024,
  maxWasmSections: 256,
  maxWasmTypes: 2_048,
  maxWasmFunctions: 4_096,
  maxWasmGlobals: 2_048,
  maxWasmElementSegments: 2_048,
  maxWasmDataSegments: 2_048,
  maxSourceBytes: 512 * 1024,
  maxBoundaryBytes: 256 * 1024,
  maxBoundaryDepth: 32,
  maxBoundaryContainers: 8_192,
  maxBoundaryEntries: 16_384,
  maxBoundaryEntriesPerContainer: 2_048,
  maxFrameBytes: 192 * 1024,
  maxNodes: 5_000,
  maxDepth: 32,
  maxChildren: 200,
  maxAttributes: 24,
  maxStringBytes: 8 * 1024,
  maxHandlers: 256,
  maxSubscriptions: 8,
  maxCommandNodes: 64,
  maxOutstandingDelays: 128,
  maxQueue: 32,
  maxMemoryPages: 256,
  maxTables: 4,
  maxTableElements: 10_000,
  maxPlottedPoints: 4_096,
  maxTableCells: 1_500,
  maxSceneObjects: 512,
  maxAnimationUpdatesPerSecond: 120,
  maxAssetBytes: 8 * 1024 * 1024,
  // Dataset text is delivered in one closed runtime message. Leave room for
  // the subscription envelope inside maxBoundaryBytes.
  maxDatasetBytes: 240 * 1024,
  maxSimulationStepsPerFrame: 8,
  maxCanvasPixels: 2_000_000,
  startupTimeoutMs: 5_000,
  rpcTimeoutMs: 1_000,
  // Every admitted subscription may produce a bounded display-rate message.
  maxTransitionsPerSecond: 9 * 120,
  maxDelayMs: 60_000,
  maxConcurrentWorkers: 4,
  maxRuntimeQueue: 8,
  runtimeQueueTimeoutMs: 5_000,
  maxConcurrentCompilers: 1,
  maxCompilerQueue: 4,
  // Cold Voyd compilation can exceed 30 seconds on shared CI runners while
  // other affected workspaces are testing. Keep the subprocess bounded while
  // allowing a complete standard-profile compile under constrained CPU.
  compileTimeoutMs: 90_000,
  compilerMemoryMb: 1_024,
  maxCompilerOutputBytes: 4 * 1024 * 1024,
});

export const resourceProfile = (name: "standard-v1"): ResourceProfile => {
  if (name !== "standard-v1") throw new Error("unsupported resource profile");
  return STANDARD_V1;
};
