import assert from "node:assert/strict";
import test from "node:test";
import { CompilerAdmission } from "./compiler-admission.js";

test("compiler admission bounds active processes and the wait queue", async () => {
  const admission = new CompilerAdmission();
  const releaseActive = await admission.acquire(1, 1, 100);
  const queued = admission.acquire(1, 1, 100);

  await assert.rejects(admission.acquire(1, 1, 100), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "resource_limit");
    assert.match((error as Error).message, /queue limit/);
    return true;
  });

  releaseActive();
  const releaseQueued = await queued;
  releaseQueued();
});

test("compiler admission expires queued work", async () => {
  const admission = new CompilerAdmission();
  const releaseActive = await admission.acquire(1, 1, 100);
  await assert.rejects(admission.acquire(1, 1, 5), /wait timed out/);
  releaseActive();
});
