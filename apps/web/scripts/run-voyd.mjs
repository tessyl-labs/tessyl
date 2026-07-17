import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const useVoydSources = true;
const voydSourceNodeOptions = "--preserve-symlinks --preserve-symlinks-main";

export function runVoyd(args, { cwd }) {
  const command = useVoydSources
    ? process.execPath
    : process.platform === "win32" ? "voyd.cmd" : "voyd";
  const commandArgs = useVoydSources
    ? [resolveVoydCliEntry(cwd), ...args]
    : args;
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env: voydEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => reject(missingCliError(error)));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout));
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8").trim() ||
        "voyd exited with status " + code));
    });
  });
}

export function resolveVoydCliEntry(cwd) {
  let directory = resolve(cwd);
  while (true) {
    const candidate = resolve(
      directory,
      "node_modules/@voyd-lang/cli/bin/voyd.js",
    );
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) throw missingCliError({ code: "ENOENT" });
    directory = parent;
  }
}

function voydEnvironment() {
  if (!useVoydSources) return process.env;
  const nodeOptions = [process.env.NODE_OPTIONS, voydSourceNodeOptions]
    .filter(Boolean)
    .join(" ");
  return { ...process.env, NODE_OPTIONS: nodeOptions, VOYD_DEV: "1" };
}

function missingCliError(error) {
  return error?.code === "ENOENT"
    ? new Error("Unable to find the voyd CLI. Run npm install before starting the app.")
    : error;
}
