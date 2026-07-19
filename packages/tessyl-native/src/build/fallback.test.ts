import assert from "node:assert/strict";
import test from "node:test";
import { STANDARD_V1 } from "../profiles.js";
import { projectStaticFallback } from "./fallback.js";
import { renderStaticFallbackHtml } from "../fallback-renderer.js";

test("projects controls into labelled static values and preserves chart data", () => {
  const fallback = projectStaticFallback({
    version: 1,
    root: {
      kind: "element", tag: "section", children: [
        { kind: "element", tag: "input", attrs: { type: "number", "aria-label": "Mass" }, props: { value: "12" }, events: [{ kind: "event", event: "input", handlerId: 1 }], children: [] },
        { kind: "element", tag: "select", attrs: { "aria-label": "Plan" }, props: { value: "enterprise_v2" }, events: [{ kind: "event", event: "change", handlerId: 2 }], children: [
          { kind: "element", tag: "option", attrs: { value: "starter" }, props: { selected: false }, children: [{ kind: "text", value: "Starter" }] },
          { kind: "element", tag: "option", attrs: { value: "enterprise_v2" }, props: { selected: true }, children: [{ kind: "text", value: "Enterprise" }] },
        ] },
        { kind: "element", tag: "button", events: [{ kind: "event", event: "click", message: "go" }], children: [{ kind: "text", value: "Run" }] },
        { kind: "element", tag: "a", attrs: { "data-article-slug": "voyd", role: "link", tabindex: 0 }, children: [{ kind: "text", value: "Voyd article" }] },
        { kind: "element", tag: "table", children: [{ kind: "element", tag: "caption", children: [{ kind: "text", value: "View chart data" }] }] },
      ],
    },
  }, STANDARD_V1);
  const serialized = JSON.stringify(fallback);
  assert.match(serialized, /Mass: |12|View chart data|Plan: |Enterprise/);
  assert.doesNotMatch(serialized, /enterprise_v2/);
  assert.doesNotMatch(serialized, /Run|button|events/);
  assert.match(serialized, /Voyd article/);
  assert.doesNotMatch(serialized, /data-article-slug|tabindex|"tag":"a"/);
});

test("trusted fallback serialization validates its closed static frame", () => {
  assert.throws(() => renderStaticFallbackHtml({ version: 1, root: { kind: "element", tag: "script", attrs: { onclick: "alert(1)" }, children: [{ kind: "text", value: "bad" }] } } as never), /unsupported (?:element|tag|attr)/);
});

test("static equation serialization preserves accessible MathML", () => {
  const html = renderStaticFallbackHtml({ version: 1, root: { kind: "element", tag: "span", attrs: { "data-native-component": "equation", "data-native-math-source": "E = mc^2", "data-native-display": false }, children: [{ kind: "text", value: "E = mc^2" }] } });
  assert.match(html, /<math[^>]+aria-label="E = mc\^2"/);
  assert.match(html, /<mi>E<\/mi>.*<mo>=<\/mo>/);
});
