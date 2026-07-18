import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse } from "./index.js";

const codes = (source: string): string[] => parse(source).diagnostics.map(({ code }) => code);
const node = (source: string, kind: string) => parse(source).nodes.find((item) => item.kind === kind);

describe("TFM Markdown baseline", () => {
  it("parses representative CommonMark and GFM constructs", () => {
    const result = parse(`# Heading

Paragraph with *emphasis*, **strong**, ~~deleted~~, [link](https://example.test), and ![alt](image.png).

> quote

- [x] complete
- [ ] pending

| A | B |
|---|---|
| 1 | 2 |

\`\`\`ts
const answer = 42
\`\`\`

<https://example.test/path>`);

    assert.equal(result.success, true);
    for (const kind of [
      "heading", "emphasis", "strong", "strikethrough", "link", "image",
      "block-quote", "list", "list-item", "table", "table-row", "table-cell", "code-block",
    ]) {
      assert.ok(result.nodes.some((item) => item.kind === kind), `missing ${kind}`);
    }
    assert.equal(result.nodes.find((item) => item.kind === "image")?.text, "alt");
    assert.equal(result.nodes.find((item) => item.kind === "code-block")?.language, "ts");
    assert.equal(result.nodes.filter((item) => item.task).length, 2);
  });

  it("preserves source spans", () => {
    const result = parse("# Hello\n\nWorld");
    const heading = result.nodes.find((item) => item.kind === "heading");
    assert.deepEqual(heading?.span, {
      start: 0,
      end: 7,
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 8,
    });
    assert.ok(result.nodes.every(({ span }) => span.start <= span.end));
  });

  it("resolves CommonMark reference links and images into stable link/image nodes", () => {
    const result = parse(`[Voyd][docs] ![Logo][logo]

[docs]: https://voyd.dev "Voyd docs"
[logo]: https://voyd.dev/logo.png "Logo"`);
    const link = result.nodes.find((item) => item.kind === "link");
    const image = result.nodes.find((item) => item.kind === "image");
    const docsDefinition = result.nodes.find((item) => item.kind === "definition" && item.identifier === "docs");
    const logoDefinition = result.nodes.find((item) => item.kind === "definition" && item.identifier === "logo");
    assert.equal(link?.identifier, "docs");
    assert.equal(link?.url, "");
    assert.equal(docsDefinition?.url, "https://voyd.dev");
    assert.equal(docsDefinition?.title, "Voyd docs");
    assert.equal(image?.identifier, "logo");
    assert.equal(image?.url, "");
    assert.equal(logoDefinition?.url, "https://voyd.dev/logo.png");
    assert.equal(image?.text, "Logo");
    assert.equal(result.nodes.some((item) => item.kind === "unsupported"), false);
  });

  it("rejects raw HTML while preserving it as inert text", () => {
    const result = parse('<script type="module">alert(1)</script>');
    assert.equal(result.success, false);
    assert.deepEqual(codes('<script type="module">alert(1)</script>'), ["TFM_RAW_HTML"]);
    assert.equal(result.nodes.some((item) => String(item.kind) === "script"), false);
    assert.equal(result.nodes.some((item) => item.text.includes("<script")), true);
  });
});

describe("TFM directives", () => {
  it("parses every leaf directive and normalizes defaults", () => {
    const result = parse(`::tessyl-video[**Video caption**]{asset="asr_video_01JABC" controls=false}

::tessyl-audio[Audio]{asset="asr_audio_01KABC" transcript="asr_text_01LABC"}

::tessyl-app[App]{revision="tsr_01MABC"}

::tessyl-data-table[Data]{dataset="dsr_01NABC"}`);
    assert.equal(result.success, true);
    for (const kind of ["tessyl-video", "tessyl-audio", "tessyl-app", "tessyl-data-table"]) {
      assert.ok(result.nodes.some((item) => item.kind === kind));
    }
    assert.ok(result.nodes.some((item) => item.kind === "strong"));
    assert.deepEqual(node("::tessyl-app[App]{revision=\"tsr_01MABC\"}", "tessyl-app")?.attributes, [
      { name: "revision", type: "opaque-id", value: "tsr_01MABC", booleanValue: false, integerValue: 0 },
      { name: "height", type: "enum", value: "standard", booleanValue: false, integerValue: 0 },
    ]);
  });

  it("parses every container directive and nested layout fences", () => {
    const result = parse(`:::tessyl-aside{tone="tip" title="Remember"}
Tip body.
:::

:::tessyl-infobox{title="Fact"}
Info body.
:::

::::tessyl-columns
:::tessyl-column
Left.
:::
:::tessyl-column
Right.
:::
::::

::::tessyl-card-grid{columns=2}
:::tessyl-card{title="Mercury"}
First.
:::
:::tessyl-card{title="Venus"}
Second.
:::
::::`);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    for (const kind of [
      "tessyl-aside", "tessyl-infobox", "tessyl-columns", "tessyl-column",
      "tessyl-card-grid", "tessyl-card",
    ]) {
      assert.ok(result.nodes.some((item) => item.kind === kind), `missing ${kind}`);
    }
    assert.equal(result.nodes.find((item) => item.kind === "tessyl-card-grid")
      ?.attributes.find(({ name }) => name === "columns")?.integerValue, 2);
  });

  it("rejects missing, unknown, and invalid attributes", () => {
    const result = parse(
      '::tessyl-video[Bad]{controls="sometimes" extra="x" asset="wrong_123"}',
    );
    assert.equal(result.success, false);
    assert.deepEqual(new Set(result.diagnostics.map(({ code }) => code)), new Set([
      "TFM_UNKNOWN_ATTRIBUTE",
      "TFM_INVALID_ATTRIBUTE",
    ]));
    assert.ok(codes("::tessyl-video[Missing]").includes("TFM_MISSING_ATTRIBUTE"));
    assert.ok(codes('::::tessyl-card-grid{columns=99}\n::::').includes("TFM_INVALID_ATTRIBUTE"));
  });

  it("rejects wrong forms, unknown names, and inline directives", () => {
    assert.ok(codes(':::tessyl-video{asset="asr_video_01JABC"}\nbody\n:::')
      .includes("TFM_WRONG_DIRECTIVE_FORM"));
    assert.ok(codes('::tessyl-card[bad]{title="Card"}')
      .includes("TFM_WRONG_DIRECTIVE_FORM"));
    assert.ok(codes("::tessyl-unknown[x]").includes("TFM_UNKNOWN_DIRECTIVE"));
    assert.ok(codes("Text :tessyl-video[x]{asset=\"asr_video_01JABC\"}")
      .includes("TFM_UNSUPPORTED_INLINE_DIRECTIVE"));
  });

  it("rejects malformed directive-looking lines instead of treating them as prose", () => {
    for (const source of [
      "::tessyl-video[x]{asset=}",
      '::tessyl-video[x]{asset="unterminated}',
      '::tessyl-video[x]{asset="asr_video_01JABC"} trailing',
      "::[caption]",
      "::",
      "::::{title=\"missing-name\"}",
    ]) {
      assert.ok(codes(source).includes("TFM_MALFORMED_DIRECTIVE"), source);
    }
  });

  it("uses own-property allowlists for directive and attribute names", () => {
    assert.ok(codes('::tessyl-video[x]{asset="asr_video_01JABC" constructor="evil"}')
      .includes("TFM_UNKNOWN_ATTRIBUTE"));
    assert.ok(codes("::constructor[x]").includes("TFM_UNKNOWN_DIRECTIVE"));
  });

  it("rejects invalid layout nesting", () => {
    assert.ok(codes(':::tessyl-column\nOrphan\n:::').includes("TFM_INVALID_NESTING"));
    assert.ok(codes(':::tessyl-columns\nPlain content\n:::').includes("TFM_INVALID_NESTING"));
    assert.ok(codes('::::tessyl-card-grid\n:::tessyl-aside\nBad\n:::\n::::')
      .includes("TFM_INVALID_NESTING"));
  });

  it("diagnoses unclosed and mismatched container fences", () => {
    assert.ok(codes(":::tessyl-aside\nbody").includes("TFM_UNCLOSED_CONTAINER"));
    const mismatched = codes("::::tessyl-aside\nbody\n:::");
    assert.ok(mismatched.includes("TFM_MISMATCHED_CONTAINER_FENCE"));
  });

  it("validates fences inside CommonMark block quotes and lists", () => {
    assert.ok(codes("> :::tessyl-aside\n> body").includes("TFM_UNCLOSED_CONTAINER"));
    assert.ok(codes("> ::::tessyl-aside\n> body\n> :::")
      .includes("TFM_MISMATCHED_CONTAINER_FENCE"));
    assert.ok(codes("- :::tessyl-aside\n  body")
      .includes("TFM_UNCLOSED_CONTAINER"));
    assert.equal(parse("- :::tessyl-aside\n  body\n  :::").success, true);
    assert.ok(codes(":::tessyl-aside\n- body\n- :::")
      .includes("TFM_UNCLOSED_CONTAINER"));
    assert.ok(codes(":::tessyl-aside\n> body\n> :::")
      .includes("TFM_UNCLOSED_CONTAINER"));
  });

  it("ignores directive-looking content inside fenced code", () => {
    const result = parse("```md\n:::tessyl-aside\n```\n");
    assert.equal(result.success, true);
    assert.equal(result.nodes.some((item) => item.kind === "tessyl-aside"), false);
  });

  it("does not leak fenced-code state past a Markdown container boundary", () => {
    const result = parse("> ```md\n> code\n\n::tessyl-video[x]{asset=}");
    assert.ok(result.diagnostics.some(({ code }) => code === "TFM_MALFORMED_DIRECTIVE"));
  });
});

describe("TFM resource bounds", () => {
  it("enforces configurable source, node, nesting, attribute, and diagnostic limits", () => {
    assert.ok(parse("12345", { limits: { maxSourceBytes: 4 } }).diagnostics
      .some(({ code }) => code === "TFM_SOURCE_LIMIT"));
    assert.ok(parse("one two three", { limits: { maxNodeCount: 2 } }).diagnostics
      .some(({ code }) => code === "TFM_NODE_LIMIT"));
    assert.ok(parse("> > > nested", { limits: { maxNestingDepth: 3 } }).diagnostics
      .some(({ code }) => code === "TFM_NESTING_LIMIT"));
    assert.ok(parse('::tessyl-video[x]{asset="asr_video_01JABC" controls=true}', {
      limits: { maxAttributeCount: 1 },
    }).diagnostics.some(({ code }) => code === "TFM_ATTRIBUTE_COUNT_LIMIT"));
    assert.ok(parse(`::tessyl-video[x]{asset="asr_video_01JABC" ${"x".repeat(20)}="value"}`, {
      limits: { maxAttributeLength: 8 },
    }).diagnostics.some(({ code }) => code === "TFM_ATTRIBUTE_LENGTH_LIMIT"));
    const limited = parse("::unknown-a[]\n\n::unknown-b[]\n\n::unknown-c[]", {
      limits: { maxDiagnostics: 2 },
    });
    assert.equal(limited.diagnostics.length, 2);
    assert.equal(limited.diagnostics.at(-1)?.code, "TFM_DIAGNOSTIC_LIMIT");
  });

  it("checks duplicate raw attribute occurrences before parser normalization", () => {
    const repeated = Array.from({ length: 40 }, () => 'asset="asr_video_01JABC"').join(" ");
    assert.ok(parse(`::tessyl-video[x]{${repeated}}`).diagnostics
      .some(({ code }) => code === "TFM_ATTRIBUTE_COUNT_LIMIT"));
    const overwritten = `::tessyl-video[x]{asset="${"x".repeat(20)}" asset="asr_video_01JABC"}`;
    assert.ok(parse(overwritten, { limits: { maxAttributeLength: 16 } }).diagnostics
      .some(({ code }) => code === "TFM_ATTRIBUTE_LENGTH_LIMIT"));
  });

  it("counts UTF-8 bytes without relying on Node Buffer", () => {
    assert.ok(parse("é", { limits: { maxSourceBytes: 1 } }).diagnostics
      .some(({ code }) => code === "TFM_SOURCE_LIMIT"));
    const globals = globalThis as unknown as { Buffer: typeof Buffer | undefined };
    const original = globals.Buffer;
    try {
      globals.Buffer = undefined;
      assert.equal(parse("# Browser").success, true);
    } finally {
      globals.Buffer = original;
    }
  });

  it("does not amplify nested invalid container source into the result DTO", () => {
    const depth = 20;
    const source = [
      ...Array.from({ length: depth }, (_, index) => `${":".repeat(depth + 3 - index)}unknown-${index}`),
      "body".repeat(2_000),
      ...Array.from({ length: depth }, (_, index) => ":".repeat(index + 4)),
    ].join("\n");
    const result = parse(source);
    assert.equal(result.success, false);
    assert.ok(JSON.stringify(result).length < source.length * 3);
    assert.ok(result.nodes.filter(({ kind }) => kind === "invalid-directive")
      .every(({ text }) => text.length <= 256));
  });

  it("stores long reference definitions once instead of copying them into each reference", () => {
    const url = `https://example.test/${"a".repeat(20_000)}`;
    const source = `${Array.from({ length: 500 }, () => "[x][shared]").join(" ")}\n\n[shared]: ${url}`;
    const result = parse(source);
    assert.equal(result.success, true);
    assert.equal(result.nodes.filter((item) => item.url === url).length, 1);
    assert.ok(JSON.stringify(result).length < 1_000_000);
  });

  it("is deterministic", () => {
    const source = ':::tessyl-aside{title="Stable"}\n**Same** input.\n:::';
    assert.deepEqual(parse(source), parse(source));
  });
});
