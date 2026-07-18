import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createSdk, type CompileResult } from "@voyd-lang/sdk";
import adapter from "../host/adapter.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.dirname(packageRoot);

const source = `use pkg::id::{ id, word_id }
use std::test::assertions::all

pub fn main() -> i32
  0

test "id package adapter":
  assert(id().byte_len(), eq: 36)
  assert(word_id().split(on: 45).len(), eq: 4)
  assert(word_id(word_count: 2).byte_len() > 2, eq: true)
`;

test("Voyd imports and runs the @tessyl/id adapter", async () => {
  const result = expectCompileSuccess(await createSdk().compile({
    includeTests: true,
    source,
    roots: { src: packageRoot, pkgDirs: [packagesRoot] },
  }));

  assert.ok(result.tests);
  const summary = await result.tests.run({ adapters: [adapter] });
  assert.equal(summary.failed, 0);
  assert.equal(summary.passed, 1);
});

const expectCompileSuccess = (
  result: CompileResult,
): Extract<CompileResult, { success: true }> => {
  if (!result.success) {
    assert.fail(result.diagnostics.map(({ message }) => message).join("\n"));
  }
  return result;
};
