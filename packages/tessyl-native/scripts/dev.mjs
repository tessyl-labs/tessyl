import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
let child;

const run = (args) =>
  new Promise((resolveRun, reject) => {
    child = spawn(npm, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      child = undefined;
      if (signal) return reject(new Error(`npm exited with ${signal}`));
      if (code !== 0) return reject(new Error(`npm exited with code ${code ?? 1}`));
      resolveRun();
    });
  });

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child?.kill(signal));
}

try {
  await run(["run", "build", "--workspace=@tessyl/design-tokens"]);
  await run(["run", "build", "--workspace=@tessyl/native"]);
  child = spawn(npm, ["run", "playground", "--workspace=@tessyl/native"], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: "inherit",
  });
  child.once("error", fail);
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
} catch (error) {
  fail(error);
}

function fail(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
