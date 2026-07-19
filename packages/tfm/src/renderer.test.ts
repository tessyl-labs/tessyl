import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { renderHtml, TFM_RENDERER_CSS, type TfmResourceRequest } from "./index.js";

describe("TFM HTML renderer", () => {
  it("renders CommonMark and GFM through a styled standalone document", () => {
    const result = renderHtml(`# Heading

Paragraph with *emphasis*, **strong**, ~~deleted~~, [safe link](https://example.test), and ![local](/image.svg).

> quote

- [x] complete
- [ ] pending

| A | B |
|---|---|
| 1 | 2 |

\`inline\`

\`\`\`ts
const answer = 42 < 100
\`\`\`

---`, { imagePolicy: "same-origin" });

    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.ok(result.contentSecurityPolicy.includes("default-src 'none'"));
    assert.ok(result.contentSecurityPolicy.includes("frame-ancestors 'self'"));
    for (const fragment of [
      "<!doctype html>", "Content-Security-Policy", "--ts-color-canvas", "class=\"tfm\"",
      "<h1>", "<em>", "<strong>", "<del>", "<blockquote>", "<ul>", "type=\"checkbox\"",
      "<table>", "<thead>", "<code>inline</code>", "data-tfm-language=\"ts\"", "<hr>",
    ]) assert.ok(result.html.includes(fragment), `missing ${fragment}`);
    assert.ok(result.html.includes("const answer = 42 &lt; 100"));
    assert.ok(result.html.includes('rel="nofollow noopener noreferrer ugc"'));
    assert.ok(result.html.includes('src="/image.svg"'));
  });

  it("renders a fragment that inherits host design tokens", () => {
    const result = renderHtml("Hello", { format: "fragment" });
    assert.equal(result.success, true);
    assert.match(result.html, /^<article class="tfm"/);
    assert.equal(result.html.includes("<style>"), false);
    assert.ok(TFM_RENDERER_CSS.includes("var(--ts-color-text-body)"));
  });

  it("fails closed when parsing reports author errors", () => {
    const result = renderHtml('<script type="module">alert(1)</script>');
    assert.equal(result.success, false);
    assert.equal(result.html, "");
    assert.ok(result.diagnostics.some(({ code }) => code === "TFM_RAW_HTML"));
  });

  it("blocks dangerous URLs and remote images by default", () => {
    const result = renderHtml(`[script](javascript:alert(1))

[data](data:text/html,hello)

![tracker](https://attacker.example/tracker.png)`);
    assert.equal(result.success, true);
    assert.equal(result.html.includes("javascript:"), false);
    assert.equal(result.html.includes("data:text/html"), false);
    assert.equal(result.html.includes("attacker.example"), false);
    assert.equal(result.diagnostics.filter(({ code }) => code === "TFM_UNSAFE_URL").length, 2);
    assert.ok(result.diagnostics.some(({ code }) => code === "TFM_UNSAFE_IMAGE_URL"));
  });

  it("blocks authenticated same-origin Markdown image requests by default", () => {
    const result = renderHtml("![unsafe](/logout-or-export)");
    assert.equal(result.success, true);
    assert.equal(result.html.includes("/logout-or-export"), false);
    assert.ok(result.contentSecurityPolicy.includes("img-src 'none'"));
    assert.ok(result.diagnostics.some(({ code }) => code === "TFM_UNSAFE_IMAGE_URL"));
  });

  it("permits explicitly opted-in HTTPS Markdown images without referrers", () => {
    const result = renderHtml("![diagram](https://images.example/diagram.png)", {
      format: "fragment",
      imagePolicy: "https",
    });
    assert.equal(result.success, true);
    assert.ok(result.html.includes('src="https://images.example/diagram.png"'));
    assert.ok(result.html.includes('referrerpolicy="no-referrer"'));
  });

  it("escapes link metadata, text, directive strings, and resolved dataset values", () => {
    const source = `[<&](https://example.test ">&<")

:::tessyl-aside{title="<img src=x onerror=alert(1)>"}
Body & text.
:::

::tessyl-data-table[Unsafe & caption]{dataset="dsr_01NABC"}`;
    const result = renderHtml(source, {
      format: "fragment",
      resolveResource: ({ kind }) => kind === "dataset"
        ? { columns: ["<column>"], rows: [["<script>alert(1)</script>"]] }
        : undefined,
    });
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.equal(result.html.includes("<img src=x"), false);
    assert.equal(result.html.includes("<script>alert"), false);
    assert.ok(result.html.includes("&lt;img src=x onerror=alert(1)&gt;"));
    assert.ok(result.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(result.html.includes("Unsafe &amp; caption"));
  });

  it("renders all leaf directives with authorized resources and fixed safety attributes", () => {
    const requests: TfmResourceRequest[] = [];
    const result = renderHtml(`::tessyl-video[Video **caption**]{asset="asr_video_01JABC" controls=true}

::tessyl-audio[Audio caption]{asset="asr_audio_01KABC" transcript="asr_text_01LABC" controls=false}

::tessyl-app[App caption]{revision="tsr_01MABC" height="compact"}

::tessyl-data-table[Dataset caption]{dataset="dsr_01NABC" sortable=true}`, {
      format: "fragment",
      resolveResource: (request) => {
        requests.push(request);
        switch (request.kind) {
          case "video": return { url: "/media/video.mp4", label: "Video" };
          case "audio": return { url: "https://media.example/audio.mp3", label: "Audio" };
          case "transcript": return { url: "/transcripts/01", label: "Transcript" };
          case "app": return { url: "/apps/01", label: "Safe app" };
          case "dataset": return { columns: ["Planet", "Mass"], rows: [["Mercury", "0.055"]] };
        }
      },
    });

    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(requests.map(({ kind }) => kind), ["video", "audio", "transcript", "app", "dataset"]);
    assert.ok(result.html.includes("<video"));
    assert.ok(result.html.includes("<audio"));
    assert.equal(/<audio[^>]* controls/.test(result.html), false);
    assert.ok(result.html.includes('sandbox="allow-scripts"'));
    assert.equal(result.html.includes("allow-same-origin"), false);
    assert.ok(result.html.includes('data-tfm-height="compact"'));
    assert.ok(result.html.includes('data-tfm-sortable="true"'));
    assert.ok(result.html.includes("<strong>caption</strong>"));
  });

  it("renders all container directives and their normalized layout", () => {
    const result = renderHtml(`:::tessyl-aside{tone="tip" title="Remember"}
Tip body.
:::

:::tessyl-infobox{tone="positive" title="Fact"}
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
::::`, { format: "fragment" });

    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    for (const fragment of [
      "tfm-aside", "data-tfm-tone=\"tip\"", "tfm-infobox", "data-tfm-tone=\"positive\"",
      "tfm-columns", "tfm-column", "tfm-card-grid", "data-tfm-columns=\"2\"", "tfm-card",
      "Remember", "Fact", "Mercury", "Venus",
    ]) assert.ok(result.html.includes(fragment), `missing ${fragment}`);
  });

  it("renders working sortable controls, table alignment, and linked footnotes", () => {
    const result = renderHtml(`| Left | Number |
| :--- | ---: |
| b | 10 |
| a | 2 |

Footnote[^note].

[^note]: Footnote body.

::tessyl-data-table[Sortable]{dataset="dsr_01NABC" sortable=true}`, {
      resolveResource: () => ({ columns: ["Name", "Value"], rows: [["b", "10"], ["a", "2"]] }),
    });
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.ok(result.html.includes('class="tfm-align-right"'));
    assert.ok(result.html.includes('href="#tfm-footnote-006e006f00740065"'));
    assert.ok(result.html.includes('id="tfm-footnote-006e006f00740065"'));
    assert.ok(result.html.includes('class="tfm-sort-button"'));
    const script = /<script>([\s\S]*)<\/script><\/body>/.exec(result.html)?.[1];
    assert.ok(script);
    const hash = `sha256-${createHash("sha256").update(script).digest("base64")}`;
    assert.ok(result.contentSecurityPolicy.includes(`'${hash}'`));
  });

  it("renders total, fragment-safe footnote identifiers for all UTF-16 input", () => {
    for (const identifier of ["café", `broken\uD800`]) {
      const result = renderHtml(`Reference[^${identifier}].\n\n[^${identifier}]: Body.`, { format: "fragment" });
      assert.equal(result.success, true, JSON.stringify(result.diagnostics));
      const href = /href="#(tfm-footnote-[^"]+)"/.exec(result.html)?.[1];
      const id = /id="(tfm-footnote-[^"]+)"/.exec(result.html)?.[1];
      assert.ok(href);
      assert.equal(href, id);
      assert.equal(href.includes("%"), false);
    }
  });

  it("blocks unsafe resolver URLs and degrades resolution failures to placeholders", () => {
    const result = renderHtml(`::tessyl-video[Video]{asset="asr_video_01JABC"}

::tessyl-app[App]{revision="tsr_01MABC"}`, {
      format: "fragment",
      resolveResource: ({ kind }) => {
        if (kind === "video") return { url: "javascript:alert(1)" };
        throw new Error("lookup failed");
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.html.includes("javascript:"), false);
    assert.equal(result.html.includes("<iframe"), false);
    assert.ok(result.html.includes("tfm-resource-placeholder"));
    assert.ok(result.diagnostics.some(({ code }) => code === "TFM_UNSAFE_RESOURCE_URL"));
    assert.ok(result.diagnostics.some(({ code }) => code === "TFM_RESOURCE_RESOLUTION"));
  });

  it("bounds renderer diagnostics and resolved dataset output", () => {
    const unsafeLinks = Array.from({ length: 20 }, (_, index) => `[${index}](javascript:alert(${index}))`).join(" ");
    const limited = renderHtml(unsafeLinks, { limits: { maxDiagnostics: 3 } });
    assert.equal(limited.success, false);
    assert.equal(limited.html, "");
    assert.equal(limited.diagnostics.length, 3);
    assert.equal(limited.diagnostics.at(-1)?.code, "TFM_DIAGNOSTIC_LIMIT");

    const dataset = renderHtml('::tessyl-data-table[Large]{dataset="dsr_01NABC"}', {
      format: "fragment",
      resolveResource: () => ({
        columns: Array.from({ length: 60 }, (_, index) => `Column ${index}`),
        rows: Array.from({ length: 250 }, () => Array.from({ length: 60 }, () => "x".repeat(5_000))),
      }),
    });
    assert.equal(dataset.success, true);
    assert.ok(dataset.diagnostics.some(({ code }) => code === "TFM_DATASET_LIMIT"));
    assert.ok(dataset.html.length < 1_200_000);
  });

  it("deduplicates resources, enforces a render-wide dataset budget, and supports async resolution", async () => {
    let calls = 0;
    const directive = '::tessyl-data-table[Repeated]{dataset="dsr_01NABC"}';
    const source = Array.from({ length: 20 }, () => directive).join("\n\n");
    const result = renderHtml(source, {
      format: "fragment",
      resolveResource: () => {
        calls += 1;
        return { columns: Array.from({ length: 50 }, (_, index) => `C${index}`), rows: Array.from({ length: 200 }, () => Array(50).fill("value")) };
      },
    });
    assert.equal(calls, 1);
    assert.ok(result.html.length < 1_500_000);
    assert.ok(result.diagnostics.some(({ code }) => code === "TFM_DATASET_LIMIT"));

    let asyncCalls = 0;
    const { renderHtmlAsync } = await import("./index.js");
    const asyncResult = await renderHtmlAsync(`${directive}\n\n${directive}`, {
      format: "fragment",
      async resolveResource() {
        asyncCalls += 1;
        return { columns: ["A"], rows: [["resolved"]] };
      },
    });
    assert.equal(asyncCalls, 1);
    assert.equal(asyncResult.success, true);
    assert.ok(asyncResult.html.includes("resolved"));
  });

  it("bounds async resolver concurrency and skips pre-authorized resources", async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `tsr_item_${index}`);
    const source = ids.map((id) => `::tessyl-app[App]{revision="${id}"}`).join("\n\n");
    let active = 0;
    let peak = 0;
    let calls = 0;
    const { renderHtmlAsync } = await import("./index.js");
    const result = await renderHtmlAsync(source, {
      format: "fragment",
      resources: [{ kind: "app", id: ids[0]!, label: "Already authorized" }],
      async resolveResource() {
        calls += 1;
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => setImmediate(resolve));
        active -= 1;
        return { label: "Resolved" };
      },
    });
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.equal(calls, ids.length - 1);
    assert.ok(peak > 1);
    assert.ok(peak <= 8);
  });

  it("falls back to async resolution for invalid and truncated bundle entries", async () => {
    const { renderHtmlAsync } = await import("./index.js");
    let invalidCalls = 0;
    const invalid = await renderHtmlAsync('::tessyl-app[App]{revision="tsr_target"}', {
      format: "fragment",
      resources: [{ kind: "app", id: "tsr_target", url: 42 as unknown as string }],
      resolveResource() {
        invalidCalls += 1;
        return { label: "Resolved invalid fallback" };
      },
    });
    assert.equal(invalid.success, true, JSON.stringify(invalid.diagnostics));
    assert.equal(invalidCalls, 1);
    assert.ok(invalid.html.includes("Resolved invalid fallback"));

    let truncatedCalls = 0;
    const truncated = await renderHtmlAsync('::tessyl-app[App]{revision="tsr_target"}', {
      format: "fragment",
      resources: [
        ...Array.from({ length: 1_000 }, (_, index) => ({ kind: "app" as const, id: `tsr_other_${index}`, label: "Other" })),
        { kind: "app", id: "tsr_target", label: "Truncated" },
      ],
      resolveResource() {
        truncatedCalls += 1;
        return { label: "Resolved truncated fallback" };
      },
    });
    assert.equal(truncated.success, true, JSON.stringify(truncated.diagnostics));
    assert.equal(truncatedCalls, 1);
    assert.ok(truncated.html.includes("Resolved truncated fallback"));

    const authorized = Array.from({ length: 999 }, (_, index) => ({
      kind: "app" as const,
      id: `tsr_authorized_${index}`,
      label: index === 998 ? "Tail authorized resource" : `Authorized ${index}`,
    }));
    const crowded = await renderHtmlAsync([
      '::tessyl-app[Invalid]{revision="tsr_invalid"}',
      ...authorized.map(({ id }) => `::tessyl-app[Authorized]{revision="${id}"}`),
    ].join("\n\n"), {
      format: "fragment",
      resources: [
        { kind: "app", id: "tsr_invalid", url: 42 as unknown as string },
        ...authorized,
      ],
      resolveResource: () => ({ label: "Resolved invalid entry" }),
    });
    assert.equal(crowded.success, true, JSON.stringify(crowded.diagnostics));
    assert.ok(crowded.html.includes("Resolved invalid entry"));
    assert.ok(crowded.html.includes("Tail authorized resource"));
  });

  it("validates only the bounded portion of oversized datasets", () => {
    const columns = new Proxy(Array<string>(1_000_000), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\\d+$/.test(property) && Number(property) >= 50) {
          throw new Error("column budget exceeded");
        }
        if (typeof property === "string" && /^\\d+$/.test(property)) return `Column ${property}`;
        return Reflect.get(target, property, receiver);
      },
    });
    const row = new Proxy(Array<string>(1_000_000), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\\d+$/.test(property) && Number(property) >= 50) {
          throw new Error("cell budget exceeded");
        }
        if (typeof property === "string" && /^\\d+$/.test(property)) return `Cell ${property}`;
        return Reflect.get(target, property, receiver);
      },
    });
    const rows = new Proxy(Array<readonly string[]>(1_000_000), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\\d+$/.test(property) && Number(property) >= 200) {
          throw new Error("row budget exceeded");
        }
        if (typeof property === "string" && /^\\d+$/.test(property)) return row;
        return Reflect.get(target, property, receiver);
      },
    });
    const result = renderHtml('::tessyl-data-table[Large]{dataset="dsr_01NABC"}', {
      format: "fragment",
      resolveResource: () => ({ columns, rows }),
    });
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.ok(result.diagnostics.some(({ code }) => code === "TFM_DATASET_LIMIT"));
  });
});
