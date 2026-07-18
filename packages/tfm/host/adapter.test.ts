import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { createSdk } from "@voyd-lang/sdk";
import adapter, { parse } from "./adapter.js";

describe("Voyd package adapter", () => {
  it("provides the generated versioned contract", () => {
    assert.equal(adapter.contract.packageName, "@tessyl/tfm");
    assert.deepEqual(adapter.contract.interfaces.map(({ interfaceId }) => interfaceId), [
      "tessyl:tfm/parser@1",
    ]);
    assert.equal(parse("# Adapter").success, true);
  });

  it("imports pkg::tfm and crosses the Voyd host boundary for success and failure", async () => {
    const compiled = await createSdk().compile({
      roots: {
        src: path.resolve(import.meta.dirname, "../.voyd"),
        pkgDirs: [path.resolve(import.meta.dirname, "../..")],
      },
      source: `use pkg::tfm::parse

pub fn main() -> i32
  let valid = parse("# Valid")
  if valid.success:
    let invalid = parse("<script>bad</script>")
    if invalid.success:
      0
    else:
      if valid.nodes.len() > 1 && invalid.diagnostics.len() > 0:
        1
      else:
        0
  else:
    0
`,
    });
    assert.equal(compiled.success, true, compiled.success ? undefined : JSON.stringify(compiled.diagnostics));
    if (!compiled.success) return;
    const value = await compiled.run<number>({ entryName: "main", adapters: [adapter] });
    assert.equal(value, 1);
  });
});
