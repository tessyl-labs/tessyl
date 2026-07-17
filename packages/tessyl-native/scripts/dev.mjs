import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const build = spawn(npm, ["run", "build", "--workspace=@tessyl/native"], {
  cwd: workspaceRoot,
  env: process.env,
  stdio: "inherit",
});

build.once("error", fail);
build.once("exit", (code, signal) => {
  if (signal) return process.kill(process.pid, signal);
  if (code !== 0) return process.exitCode = code ?? 1;
  startPlayground();
});

let child;

function startPlayground() {
  child = spawn(npm, ["run", "playground", "--workspace=@tessyl/native-playground"], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: "inherit",
  });
  child.once("error", fail);
  child.once("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

function fail(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    build.kill(signal);
    child?.kill(signal);
  });
}
