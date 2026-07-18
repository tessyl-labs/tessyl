import assert from "node:assert/strict";
import test from "node:test";
import binaryen from "binaryen";
import { STANDARD_V1 } from "../profiles.js";
import { inspectWasm } from "./wasm.js";

test("required Wasm exports have their fixed ABI kinds", () => {
  const module = new binaryen.Module();
  module.setMemory(1, 2, "app");
  module.addFunction("entry", binaryen.none, binaryen.none, [], module.nop());
  module.addFunctionExport("entry", "memory");
  assert.equal(module.validate(), 1);
  assert.throws(() => inspectWasm(module.emitBinary(), STANDARD_V1), /app must be a function/);
  module.dispose();
});

test("aggregate Wasm table capacity is bounded", () => {
  const module = new binaryen.Module();
  module.setFeatures(binaryen.Features.ReferenceTypes);
  module.setMemory(1, 2, "memory");
  module.addFunction("entry", binaryen.none, binaryen.none, [], module.nop());
  module.addFunctionExport("entry", "app");
  module.addTable("callbacks-a", 6_000, 6_000);
  module.addTable("callbacks-b", 6_000, 6_000);
  assert.equal(module.validate(), 1);
  assert.throws(() => inspectWasm(module.emitBinary(), STANDARD_V1), /Aggregate Wasm table capacity/);
  module.dispose();
});

test("Wasm structure counts are capped before engine compilation", () => {
  const module = new binaryen.Module();
  module.setMemory(1, 2, "memory");
  module.addFunction("entry", binaryen.none, binaryen.none, [], module.nop());
  module.addFunctionExport("entry", "app");
  module.addFunction("extra", binaryen.none, binaryen.none, [], module.nop());
  assert.equal(module.validate(), 1);
  assert.throws(() => inspectWasm(module.emitBinary(), { ...STANDARD_V1, maxWasmFunctions: 1 }), /function count/);
  module.dispose();
  assert.throws(() => inspectWasm(Uint8Array.from([0, 1, 2]), STANDARD_V1), /header is malformed/);
});
