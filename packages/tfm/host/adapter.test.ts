import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { createSdk } from "@voyd-lang/sdk";
import adapter, { parse, renderHtml, renderHtmlWithVoydResources } from "./adapter.js";

describe("Voyd package adapter", () => {
  it("provides the generated contract", () => {
    assert.equal(adapter.contract.packageName, "@tessyl/tfm");
    assert.deepEqual(adapter.contract.interfaces.map(({ interfaceId }) => interfaceId), [
      "tessyl:tfm/parser@1",
      "tessyl:tfm/renderer@1",
    ]);
    assert.equal(parse("# Adapter").success, true);
    assert.equal(renderHtml("# Adapter").success, true);
  });

  it("exposes the current schema through the parser boundary", async () => {
    const compiled = await createSdk().compile({
      roots: {
        src: path.resolve(import.meta.dirname, "../.voyd"),
        pkgDirs: [path.resolve(import.meta.dirname, "../..")],
      },
      source: `use pkg::tfm::parse

pub fn main() -> i32
  let current = parse("| A | B |\\n| :-- | --: |\\n| 1 | 2 |")
  if current.schemaVersion == "tfm-1" && current.success:
    1
  else:
    0
`,
    });
    assert.equal(compiled.success, true, compiled.success ? undefined : JSON.stringify(compiled.diagnostics));
    if (!compiled.success) return;
    const value = await compiled.run<number>({ entryName: "main", adapters: [adapter] });
    assert.equal(value, 1);
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

  it("renders safe HTML across the Voyd host boundary", async () => {
    const compiled = await createSdk().compile({
      roots: {
        src: path.resolve(import.meta.dirname, "../.voyd"),
        pkgDirs: [path.resolve(import.meta.dirname, "../..")],
      },
      source: `use pkg::tfm::render_html

pub fn main() -> i32
  let valid = render_html("# Rendered")
  let invalid = render_html("<script>bad</script>")
  if valid.success && valid.html != "" && !invalid.success && invalid.html == "":
    1
  else:
    0
`,
    });
    assert.equal(compiled.success, true, compiled.success ? undefined : JSON.stringify(compiled.diagnostics));
    if (!compiled.success) return;
    const value = await compiled.run<number>({ entryName: "main", adapters: [adapter] });
    assert.equal(value, 1);
  });

  it("renders pre-authorized resources across the Voyd boundary", async () => {
    const compiled = await createSdk().compile({
      roots: {
        src: path.resolve(import.meta.dirname, "../.voyd"),
        pkgDirs: [path.resolve(import.meta.dirname, "../..")],
      },
      source: `use std::array::Array
use pkg::tfm::{ RenderResource, render_html_with_resources }

pub fn main() -> i32
  let ~resources = Array<RenderResource>::init()
  resources.push({
    kind: "dataset",
    id: "dsr_01NABC",
    url: "",
    label: "Planets",
    columns: ["Planet"],
    cells: ["Mercury"]
  })
  let rendered = render_html_with_resources("::tessyl-data-table[Data]{dataset=\\\"dsr_01NABC\\\"}", resources)
  if rendered.success && rendered.html.contains("Mercury"):
    1
  else:
    0
`,
    });
    assert.equal(compiled.success, true, compiled.success ? undefined : JSON.stringify(compiled.diagnostics));
    if (!compiled.success) return;
    const value = await compiled.run<number>({ entryName: "main", adapters: [adapter] });
    assert.equal(value, 1);
  });

  it("renders an empty pre-authorized Voyd dataset as an empty table", async () => {
    const compiled = await createSdk().compile({
      roots: {
        src: path.resolve(import.meta.dirname, "../.voyd"),
        pkgDirs: [path.resolve(import.meta.dirname, "../..")],
      },
      source: `use std::array::Array
use pkg::tfm::{ RenderResource, render_html_with_resources }

pub fn main() -> i32
  let ~resources = Array<RenderResource>::init()
  let cells = Array<String>::init()
  resources.push({
    kind: "dataset",
    id: "dsr_01NABC",
    url: "",
    label: "Empty",
    columns: ["Name"],
    cells: cells
  })
  let rendered = render_html_with_resources("::tessyl-data-table[Data]{dataset=\\\"dsr_01NABC\\\"}", resources)
  if rendered.success && rendered.html.contains("<table"):
    1
  else:
    0
`,
    });
    assert.equal(compiled.success, true, compiled.success ? undefined : JSON.stringify(compiled.diagnostics));
    if (!compiled.success) return;
    const value = await compiled.run<number>({ entryName: "main", adapters: [adapter] });
    assert.equal(value, 1);
  });

  it("does not spend the Voyd dataset budget on unreferenced resources", () => {
    const unusedCells = Array<string>(10_000).fill("unused");
    const result = renderHtmlWithVoydResources(
      '::tessyl-data-table[Data]{dataset="dsr_used"}',
      [
        { kind: "dataset", id: "dsr_unused", url: "", label: "Unused", columns: ["Value"], cells: unusedCells },
        { kind: "dataset", id: "dsr_used", url: "", label: "Used", columns: ["Value"], cells: ["Mercury"] },
      ],
    );
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.ok(result.html.includes("Mercury"));
  });
});
