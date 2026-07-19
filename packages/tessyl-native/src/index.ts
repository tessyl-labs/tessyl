import { checkTessera, compileTessera, testTessera } from "./build/compiler.js";
import { createFacade } from "./facade.js";
import type { TessylNative, TessylNativeConfig } from "./types.js";

export { TessylNativeError } from "./errors.js";
export { renderStaticArtifact, renderStaticArtifactHtml, renderStaticFallback, renderStaticFallbackHtml, staticFallbackStyles } from "./fallback-renderer.js";
export type { NativeErrorCode } from "./errors.js";
export type * from "./types.js";

export const createTessylNative = (config: TessylNativeConfig = {}): TessylNative => createFacade(config, { build: compileTessera, check: checkTessera, test: testTessera });
