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
  maxBoundaryContainers: 4_096,
  maxBoundaryEntries: 8_192,
  maxBoundaryEntriesPerContainer: 2_048,
  maxFrameBytes: 192 * 1024,
  maxNodes: 2_000,
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
  rpcTimeoutMs: 1_000,
  maxTransitionsPerSecond: 120,
  maxDelayMs: 60_000,
  maxConcurrentWorkers: 4,
  maxRuntimeQueue: 8,
  runtimeQueueTimeoutMs: 5_000,
  maxConcurrentCompilers: 1,
  maxCompilerQueue: 4,
  compileTimeoutMs: 10_000,
  compilerMemoryMb: 1_024,
  maxCompilerOutputBytes: 4 * 1024 * 1024,
});

export const resourceProfile = (name: "standard-v1"): ResourceProfile => {
  if (name !== "standard-v1") throw new Error("unsupported resource profile");
  return STANDARD_V1;
};
