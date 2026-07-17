import assert from "node:assert/strict";
import test from "node:test";
import { STANDARD_V1 } from "../profiles.js";
import { RuntimeScheduler } from "./runtime-scheduler.js";

test("runtime scheduler bounds excess instance waiters", async () => {
  const scheduler = new RuntimeScheduler();
  const releases = await Promise.all(Array.from({ length: STANDARD_V1.maxConcurrentWorkers }, () => scheduler.acquire({})));
  const waiters = Array.from({ length: STANDARD_V1.maxRuntimeQueue }, () => scheduler.acquire({}));
  await assert.rejects(scheduler.acquire({}), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "resource_limit");
    assert.match((error as Error).message, /queue limit/);
    return true;
  });
  releases.forEach((release) => release());
  const firstQueued = await Promise.all(waiters.slice(0, STANDARD_V1.maxConcurrentWorkers));
  firstQueued.forEach((release) => release());
  const remainingQueued = await Promise.all(waiters.slice(STANDARD_V1.maxConcurrentWorkers));
  remainingQueued.forEach((release) => release());
});
