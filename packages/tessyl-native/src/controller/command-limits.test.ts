import assert from "node:assert/strict";
import test from "node:test";
import { STANDARD_V1 } from "../profiles.js";
import { assertOutstandingDelayCapacity } from "./command-limits.js";

test("outstanding delayed commands are bounded across runtime steps", () => {
  assert.doesNotThrow(() => assertOutstandingDelayCapacity(STANDARD_V1.maxOutstandingDelays - 1, 1, STANDARD_V1));
  assert.throws(
    () => assertOutstandingDelayCapacity(STANDARD_V1.maxOutstandingDelays - 1, 2, STANDARD_V1),
    /Outstanding delayed command limit/,
  );
});
