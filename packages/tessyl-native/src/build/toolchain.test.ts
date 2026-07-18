import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hashDirectory } from "./toolchain.js";

test("dependency provenance rejects nested symbolic links", async () => {
  const root = await mkdtemp(join(tmpdir(), "tessyl-toolchain-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "target.js"), "export const value = 1;\n");
    await symlink("../target.js", join(root, "src", "linked.js"));
    await assert.rejects(hashDirectory(root), /content symlink is unsupported/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
