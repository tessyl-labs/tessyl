import assert from "node:assert/strict";
import test from "node:test";
import { TessylNativeError } from "../errors.js";
import { STANDARD_V1 } from "../profiles.js";
import { isCanonicalArticleSlug, validateBoundaryValue, validateFrame, validateRuntimeStep, validateStaticFrame } from "./validate.js";
import { validateRuntimeRequest, validateRuntimeResponse } from "./messages.js";
import { normalizeNativeFrame } from "./normalize-frame.js";

test("accepts the closed native frame surface", () => {
  const frame = validateFrame({
    version: 1,
    root: {
      kind: "element",
      tag: "section",
      attrs: { "aria-label": "Calculator", "data-native-component": "column" },
      children: [
        { kind: "element", tag: "h2", children: [{ kind: "text", value: "Calculator" }] },
        {
          kind: "element",
          tag: "input",
          attrs: { type: "number", "aria-label": "Value", min: 0, max: 10 },
          events: [{ kind: "event", event: "input", handlerId: 1 }],
          children: [],
        },
        {
          kind: "element",
          tag: "canvas",
          attrs: { width: 800, height: 450, "aria-label": "Particle field", "data-native-particles": true },
          events: [{ kind: "event", event: "pointermove", handlerId: 2 }],
          children: [],
        },
        { kind: "element", tag: "span", attrs: { "data-native-particle-buffer": "10,20,3;30,40,2,1,0.8,2.4", "aria-hidden": true }, children: [] },
        { kind: "element", tag: "svg", attrs: { viewbox: "0 0 10 10" }, children: [{ kind: "element", tag: "circle", attrs: { cx: 5, cy: 5, r: 2, "fill-opacity": 0.8, "stroke-opacity": 0.2, "stroke-width": 4 }, children: [] }] },
      ],
    },
  }, STANDARD_V1);
  assert.equal(frame.version, 1);
});

test("rejects unsafe render surface and cyclic frames", () => {
  assert.throws(
    () => validateFrame({ version: 1, root: { kind: "element", tag: "iframe", children: [] } }, STANDARD_V1),
    TessylNativeError,
  );
  const root: Record<string, unknown> = { kind: "fragment", children: [] };
  (root.children as unknown[]).push(root);
  assert.throws(() => validateFrame({ version: 1, root }, STANDARD_V1), /cyclic/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "element", tag: "a", attrs: { "data-article-slug": "Not/a/slug" }, children: [] } }, STANDARD_V1), /article slug/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "element", tag: "div", attrs: { "data-native-width": "fixed", "data-native-width-px": 9_999 }, children: [] } }, STANDARD_V1), /fixed width/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "element", tag: "input", props: { type: "file" }, children: [] } }, STANDARD_V1), /unsafe input type/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "element", tag: "input", attrs: { type: "text" }, props: { type: "password" }, children: [] } }, STANDARD_V1), /conflicting input type/);
  assert.throws(() => validateFrame({
    version: 1,
    root: { kind: "element", tag: "div", events: Array.from({ length: 3 }, (_, handlerId) => ({ kind: "event", event: "click", handlerId, message: "x".repeat(100_000) })), children: [] },
  }, STANDARD_V1), /frame byte budget/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "element", tag: "canvas", attrs: { width: 4_000, height: 4_000 }, children: [] } }, STANDARD_V1), /canvas pixel/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "element", tag: "span", attrs: { "data-native-particle-buffer": "javascript:bad" }, children: [] } }, STANDARD_V1), /particle data/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "element", tag: "span", attrs: { "data-native-particle-buffer": "10,20,3,6,0.8,2.4" }, children: [] } }, STANDARD_V1), /particle data/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "element", tag: "circle", attrs: { cx: 5, cy: 5, r: 2, "fill-opacity": 1.1 }, children: [] } }, STANDARD_V1), /fill-opacity/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "element", tag: "circle", attrs: { cx: 5, cy: 5, r: 2, "stroke-width": 145 }, children: [] } }, STANDARD_V1), /stroke-width/);
});

test("canonical article slugs have aligned separator and length boundaries", () => {
  const atLimit = `article_slug-${"a".repeat(67)}`;
  assert.equal(atLimit.length, 80);
  assert.equal(isCanonicalArticleSlug(atLimit), true);
  assert.equal(isCanonicalArticleSlug(`${atLimit}a`), false);
  for (const invalid of ["", "Uppercase", "leading/path", "-leading", "trailing_", "double--separator", "mixed_-separator"]) {
    assert.equal(isCanonicalArticleSlug(invalid), false, invalid);
  }
});

test("static frames cannot contain focusable nodes", () => {
  assert.throws(
    () => validateStaticFrame({ version: 1, root: { kind: "element", tag: "button", children: [] } }, STANDARD_V1),
    /interactive/,
  );
});

test("runtime command and subscription capabilities fail closed", () => {
  assert.doesNotThrow(() => validateRuntimeStep({
    commands: { type: "cmd", kind: "delay", ms: 10, value: { tick: true } },
    subscriptions: { type: "sub", kind: "animation_frame", key: "animation" },
  }, STANDARD_V1));
  assert.doesNotThrow(() => validateRuntimeStep({ subscriptions: { type: "sub", kind: "fixed_timestep", key: "60" } }, STANDARD_V1));
  assert.doesNotThrow(() => validateRuntimeStep({ subscriptions: { type: "sub", kind: "native_input_number", key: "mass" } }, STANDARD_V1));
  assert.doesNotThrow(() => validateRuntimeStep({ subscriptions: { type: "sub", kind: "native_dataset_text", key: "growth_data" } }, STANDARD_V1));
  assert.doesNotThrow(() => validateRuntimeStep({ subscriptions: { type: "sub", kind: "native_shareable_state", key: "initial" } }, STANDARD_V1));
  assert.throws(() => validateRuntimeStep({ commands: { type: "cmd", kind: "fetch", value: "https://example.com" } }, STANDARD_V1), /unsupported capability/);
  assert.doesNotThrow(() => validateRuntimeStep({ commands: { type: "cmd", kind: "delay", ms: 10n, value: { tick: true } } }, STANDARD_V1));
  assert.doesNotThrow(() => validateRuntimeStep({ commands: { type: "cmd", kind: "native_share_state", value: "angle=1.25" } }, STANDARD_V1));
  assert.throws(() => validateRuntimeStep({ commands: { type: "cmd", kind: "native_share_state", value: "x".repeat(8_193) } }, STANDARD_V1), /shareable state/);
  assert.throws(() => validateRuntimeStep({ commands: { type: "cmd", kind: "delay", ms: 10, value: null, extra: true } }, STANDARD_V1), /unknown field/);
  assert.throws(() => validateRuntimeStep({ subscriptions: { type: "sub", kind: "animation_frame", key: "" } }, STANDARD_V1), /invalid key/);
  assert.throws(() => validateRuntimeStep({ commands: { type: "cmd", kind: "batch", children: [
    { type: "cmd", kind: "message", value: "a".repeat(140_000) },
    { type: "cmd", kind: "message", value: "b".repeat(140_000) },
  ] } }, STANDARD_V1), /payload limit/);
});

test("hostile values are bounded before traversal or cloning", () => {
  const tooDeep: Record<string, unknown> = { kind: "text", value: "end" };
  let root = tooDeep;
  for (let index = 0; index < STANDARD_V1.maxDepth + 2; index += 1) root = { kind: "fragment", children: [root] };
  assert.throws(() => validateFrame({ version: 1, root }, STANDARD_V1), /depth limit/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "text", value: "x".repeat(STANDARD_V1.maxStringBytes + 1) } }, STANDARD_V1), /string limit/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "text", value: "safe", key: { nested: true } } }, STANDARD_V1), /invalid key/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "fragment", key: "x".repeat(STANDARD_V1.maxStringBytes + 1), children: [] } }, STANDARD_V1), /string limit/);
  assert.throws(() => validateFrame({ version: 1, root: { kind: "fragment", key: "logical", children: [] } }, STANDARD_V1), /keyed fragments/);
  assert.throws(() => validateBoundaryValue({ value: Number.NaN }, 100), /non-finite/);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => validateBoundaryValue(cycle, 100), /cyclic/);
  const accessorBoundary: Record<string, unknown> = {};
  Object.defineProperty(accessorBoundary, "value", { enumerable: true, get: () => "changed" });
  assert.throws(() => validateBoundaryValue(accessorBoundary, 100, "accessor", STANDARD_V1), /accessor properties/);
  assert.throws(() => validateBoundaryValue(Array.from({ length: 20 }, () => 1), 100), /payload limit/);
  assert.throws(() => validateBoundaryValue(Array.from({ length: 101 }, () => []), 100), /payload limit/);
  const tooManyContainers = Array.from({ length: 129 }, () => Array.from({ length: 64 }, () => []));
  assert.throws(
    () => validateBoundaryValue(tooManyContainers, STANDARD_V1.maxBoundaryBytes, "containers", STANDARD_V1),
    /container limit/,
  );
  assert.throws(
    () => validateBoundaryValue(Array.from({ length: STANDARD_V1.maxBoundaryEntriesPerContainer + 1 }), STANDARD_V1.maxBoundaryBytes, "entries", STANDARD_V1),
    /container entry limit/,
  );
  let boundaryDepth: unknown = null;
  for (let index = 0; index < STANDARD_V1.maxBoundaryDepth + 2; index += 1) boundaryDepth = { child: boundaryDepth };
  assert.throws(
    () => validateBoundaryValue(boundaryDepth, STANDARD_V1.maxBoundaryBytes, "depth", STANDARD_V1),
    /depth limit/,
  );
  assert.throws(() => normalizeNativeFrame({ version: 1, root }, STANDARD_V1), /depth (?:limit exceeded|exceeds)/);
});

test("runtime envelopes are a closed versioned union", () => {
  assert.doesNotThrow(() => validateRuntimeRequest({ version: 1, tesseraId: "one", generation: 1, requestId: 1, kind: "init" }));
  assert.doesNotThrow(() => validateRuntimeResponse({ version: 1, tesseraId: "one", generation: 1, requestId: 0, kind: "ready" }));
  assert.throws(() => validateRuntimeResponse({ version: 1, tesseraId: "one", generation: 1, requestId: 1, kind: "init" }), /invalid runtime envelope/);
  assert.throws(() => validateRuntimeRequest({ version: 1, tesseraId: "one", generation: 1, requestId: 1, kind: "result" }), /invalid runtime envelope/);
  assert.throws(() => validateRuntimeRequest({ version: 1, tesseraId: "one", generation: 1, requestId: 1, kind: "fetch" }), /invalid runtime envelope/);
  assert.throws(() => validateRuntimeRequest({ version: 1, tesseraId: "one", generation: 1, requestId: 1, kind: "init", port: {} }), /invalid runtime envelope/);
  assert.throws(() => validateRuntimeResponse({ version: 1, tesseraId: "one", generation: 1, requestId: 2, kind: "ready" }), /invalid runtime envelope/);
  assert.throws(() => validateRuntimeRequest({ version: 1, tesseraId: "one", generation: 1, requestId: 1, kind: "dispatch" }), /invalid runtime envelope/);
});
