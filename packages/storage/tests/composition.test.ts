import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { composeStorage } from "../src/composition.js";
import { StorageError } from "../src/errors.js";
import { createSearchStorageAdapter } from "../host/adapter.js";
import { mergeLimits, withOperationTimeout } from "../src/validation.js";
import type { SearchService } from "../src/contracts.js";

describe("storage composition", () => {
  it("fails clearly for missing and duplicate authorities", () => {
    assert.throws(() => composeStorage(), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
    const placeholder = {} as never;
    assert.throws(() => composeStorage({ document: placeholder }, { document: placeholder }), (error: unknown) => error instanceof StorageError && error.code === "conflict");
    assert.throws(() => mergeLimits({ maxResultCount: 101 }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  });

  it("builds an adapter containing only the selected authority", () => {
    const search = {} as SearchService;
    const adapter = createSearchStorageAdapter(search);
    assert.deepEqual(adapter.contract.interfaces.map(({ interfaceId }) => interfaceId), ["tessyl:storage/search@1"]);
    assert.deepEqual(Object.keys(adapter.implementation), ["tessyl:storage/search@1"]);
  });

  it("bounds an operation even when backend work ignores cancellation", async () => {
    const started = Date.now();
    await assert.rejects(withOperationTimeout("test.blocked", { timeoutMs: 20 }, () => new Promise(() => undefined)), (error: unknown) => error instanceof StorageError && error.code === "timeout");
    assert.ok(Date.now() - started < 1_000);
  });

  it("preserves the settled outcome of an admitted mutation", async () => {
    const conflict = new StorageError("conflict", "late conflict", { operation: "test.mutation" });
    await assert.rejects(withOperationTimeout("test.mutation", { timeoutMs: 5 }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      throw conflict;
    }, true), (error: unknown) => error === conflict);
  });
});
