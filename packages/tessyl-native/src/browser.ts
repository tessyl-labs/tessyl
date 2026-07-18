import { createFacade } from "./facade.js";
import type { TessylNative, TessylNativeConfig } from "./types.js";

export { TessylNativeError } from "./errors.js";
export type { NativeErrorCode } from "./errors.js";
export type * from "./types.js";

export const createTessylNative = (config: TessylNativeConfig = {}): TessylNative => createFacade(config);
