import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WORD_ID_CAPACITY, id, wordId } from "./index.js";

test("id generates RFC 9562 UUIDv7 values", () => {
  const before = Date.now();
  const value = id();
  const after = Date.now();

  assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const encodedTime = Number.parseInt(value.replaceAll("-", "").slice(0, 12), 16);
  assert.ok(encodedTime >= before && encodedTime <= after);
});

test("id generates distinct values", () => {
  const values = new Set(Array.from({ length: 1_000 }, id));
  assert.equal(values.size, 1_000);
});

test("wordId generates four safe lowercase words by default", () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(wordId(), /^[a-z]+(?:-[a-z]+){3}$/);
  }
});

test("default word IDs have at least 40 bits of namespace capacity", () => {
  assert.ok(DEFAULT_WORD_ID_CAPACITY >= 2n ** 40n);
});

test("wordId supports one through four words", () => {
  for (let wordCount = 1; wordCount <= 4; wordCount += 1) {
    assert.equal(wordId({ wordCount }).split("-").length, wordCount);
  }
});

test("wordId rejects invalid word counts", () => {
  for (const wordCount of [0, 1.5, 5, Number.NaN]) {
    assert.throws(() => wordId({ wordCount }), /wordCount must be an integer from 1 through 4/);
  }
});
