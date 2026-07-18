import assert from "node:assert/strict";
import test from "node:test";
import adapter from "./adapter.js";

test("adapter implements the complete Tessyl ID contract", () => {
  assert.equal(adapter.contract.packageName, "@tessyl/id");
  assert.deepEqual(
    adapter.contract.functions.map(({ functionName }) => functionName).sort(),
    ["id", "word_id"],
  );
});
