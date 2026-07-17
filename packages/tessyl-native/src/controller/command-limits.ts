import { TessylNativeError } from "../errors.js";
import type { ResourceProfile } from "../profiles.js";

export const assertOutstandingDelayCapacity = (
  current: number,
  additional: number,
  profile: ResourceProfile,
): void => {
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(additional) || current < 0 || additional < 0 || current + additional > profile.maxOutstandingDelays) {
    throw new TessylNativeError({ code: "resource_limit", phase: "run", message: "Outstanding delayed command limit exceeded", recoverable: true });
  }
};
