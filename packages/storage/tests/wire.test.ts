import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StorageError } from "../src/errors.js";
import {
  decodeStoredDocumentBody,
  decodeVoydValue,
  encodeVoydValue,
  parseStoredVoydValue,
  serializeVoydValue,
} from "../src/wire.js";

describe("Voyd document value transport", () => {
  it("round-trips nested records, arrays, and named variants", () => {
    const source = {
      title: "Typed",
      count: 3,
      active: true,
      tags: ["voyd", "storage"],
      state: { $variant: "Published", at: "2026-07-22T00:00:00.000Z" },
    };
    const encoded = encodeVoydValue(source);
    assert.deepEqual(JSON.parse(JSON.stringify(decodeVoydValue(encoded))), source);
    assert.deepEqual(JSON.parse(JSON.stringify(decodeStoredDocumentBody(serializeVoydValue(encoded)))), source);
    assert.deepEqual(parseStoredVoydValue(serializeVoydValue(encoded)), encoded);
  });

  it("rejects cycles, invalid references, and unsafe i64 values", () => {
    assert.throws(
      () => decodeVoydValue({ root: 0, nodes: [{ value: { tag: "ListNode", items: [0] } }] }),
      (error: unknown) => error instanceof StorageError && error.code === "invalid_request",
    );
    assert.throws(
      () => decodeVoydValue({ root: 1, nodes: [{ value: { tag: "Empty" } }] }),
      (error: unknown) => error instanceof StorageError && error.code === "invalid_request",
    );
    assert.throws(
      () => decodeVoydValue({ root: 0, nodes: [{ value: { tag: "I64Node", value: 9_223_372_036_854_775_808n } }] }),
      (error: unknown) => error instanceof StorageError && error.code === "invalid_request",
    );
    assert.throws(
      () => decodeVoydValue({
        root: 0,
        nodes: [
          { value: { tag: "ListNode", items: [1, 1] } },
          { value: { tag: "TextNode", value: "shared" } },
        ],
      }),
      (error: unknown) => error instanceof StorageError && error.code === "invalid_request",
    );
    assert.throws(
      () => parseStoredVoydValue('{"legacy":"json"}'),
      (error: unknown) => error instanceof StorageError && error.code === "invalid_data",
    );
  });

  it("preserves the full signed i64 range", () => {
    const encoded = encodeVoydValue({
      minimum: -9_223_372_036_854_775_808n,
      maximum: 9_223_372_036_854_775_807n,
    });
    const serialized = serializeVoydValue(encoded);
    assert.match(serialized, /"-9223372036854775808"/);
    assert.match(serialized, /"9223372036854775807"/);
    assert.deepEqual({ ...decodeVoydValue(parseStoredVoydValue(serialized)) as object }, {
      minimum: -9_223_372_036_854_775_808n,
      maximum: 9_223_372_036_854_775_807n,
    });
  });
});
