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

test("projects particle buffers into a meaningful static SVG snapshot", () => {
  const fallback = projectStaticFallback({
    version: 1,
    root: {
      kind: "element", tag: "figure", attrs: { "data-native-component": "particle-field", "aria-label": "Particle field" }, children: [
        { kind: "element", tag: "canvas", attrs: { width: 896, height: 504, "aria-label": "Moving particles", "data-native-particles": true }, children: [] },
        { kind: "element", tag: "canvas", attrs: { width: 100, height: 50, "aria-label": "Auxiliary visualization", "data-native-particles": true }, children: [] },
        { kind: "fragment", children: [{ kind: "element", tag: "span", attrs: { "aria-hidden": true, "data-native-particle-buffer": "10,20,3,1,0.8,2;30,40,4,5,0.9,0" }, children: [] }] },
      ],
    },
  }, STANDARD_V1);
  const html = renderStaticFallbackHtml(fallback);
  assert.match(html, /<svg[^>]+data-native-component="particle-snapshot"/);
  assert.match(html, /viewBox="0 0 896 504"/);
  assert.equal((html.match(/data-native-component="particle"/g) ?? []).length, 2);
  assert.match(html, /stroke-width="6"/);
  assert.match(html, /stroke-opacity="0.16000000000000003"/);
  assert.match(html, /data-native-tone="accent"/);
  assert.match(html, /data-native-tone="critical"/);
  assert.doesNotMatch(html, /<canvas|data-native-particle-buffer/);
  assert.equal((html.match(/data-native-component="particle-snapshot"/g) ?? []).length, 1);
  assert.equal((html.match(/data-native-component="static-scene"/g) ?? []).length, 1);
  assert.match(html, /Auxiliary visualization/);
});

test("projects the maximum glowing particle count without amplifying scene objects", () => {
  const particles = Array.from({ length: STANDARD_V1.maxSceneObjects }, (_, index) => `${index % 20},${index % 15},1,1,1,4`).join(";");
  const fallback = projectStaticFallback({
    version: 1,
    root: {
      kind: "element", tag: "figure", attrs: { "data-native-component": "particle-field" }, children: [
        { kind: "element", tag: "canvas", attrs: { width: 20, height: 15, "aria-label": "Maximum particles", "data-native-particles": true }, children: [] },
        { kind: "fragment", children: [{ kind: "element", tag: "span", attrs: { "aria-hidden": true, "data-native-particle-buffer": particles }, children: [] }] },
      ],
    },
  }, STANDARD_V1);
  const html = renderStaticFallbackHtml(fallback);
  assert.equal((html.match(/data-native-component="particle"/g) ?? []).length, STANDARD_V1.maxSceneObjects);
  assert.doesNotMatch(html, /particle-glow/);
});

test("budgets particle snapshots around existing scene objects", () => {
  const particles = Array.from({ length: STANDARD_V1.maxSceneObjects }, (_, index) => `${index % 20},${index % 15},1,1,1,4`).join(";");
  const fallback = projectStaticFallback({
    version: 1,
    root: { kind: "element", tag: "section", children: [
      { kind: "element", tag: "svg", attrs: { viewbox: "0 0 10 10" }, children: [{ kind: "element", tag: "circle", attrs: { cx: 5, cy: 5, r: 2 }, children: [] }] },
      { kind: "element", tag: "figure", attrs: { "data-native-component": "particle-field" }, children: [
        { kind: "element", tag: "canvas", attrs: { width: 20, height: 15, "aria-label": "Budgeted particles", "data-native-particles": true }, children: [] },
        { kind: "fragment", children: [{ kind: "element", tag: "span", attrs: { "aria-hidden": true, "data-native-particle-buffer": particles }, children: [] }] },
      ] },
    ] },
  }, STANDARD_V1);
  const html = renderStaticFallbackHtml(fallback);
  assert.equal((html.match(/data-native-component="particle"/g) ?? []).length, STANDARD_V1.maxSceneObjects - 1);
  assert.equal((html.match(/<circle/g) ?? []).length, STANDARD_V1.maxSceneObjects);
});

test("static equation serialization preserves accessible MathML", () => {
  const html = renderStaticFallbackHtml({ version: 1, root: { kind: "element", tag: "span", attrs: { "data-native-component": "equation", "data-native-math-source": "E = mc^2", "data-native-display": false }, children: [{ kind: "text", value: "E = mc^2" }] } });
  assert.match(html, /<math[^>]+aria-label="E = mc\^2"/);
  assert.match(html, /<mi>E<\/mi>.*<mo>=<\/mo>/);
});
