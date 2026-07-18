import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const voydRoot = resolve(workspaceRoot, ".voyd-source");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const run = (command, args, cwd) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) return reject(new Error(`${command} exited with ${signal}`));
      if (code !== 0) return reject(new Error(`${command} exited with code ${code ?? 1}`));
      resolveRun();
    });
  });

console.info("Preparing the pinned Voyd source dependency...");
await run("git", ["submodule", "update", "--init", "--recursive"], workspaceRoot);
await run(npm, ["ci"], voydRoot);
await run(npm, ["exec", "--", "turbo", "run", "build"], voydRoot);
