import { rename, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage } from "./diagnostics.mjs";
import { checkServer, serve } from "./serve.mjs";
import { watchSource } from "./watch-source.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDir = resolve(rootDir, "src");
const stagedPublicDir = resolve(rootDir, ".voyd-dev/public");
const liveAssetsDir = resolve(rootDir, "public/assets");
const previousAssetsDir = resolve(rootDir, ".voyd-dev/previous-assets");
let app;
let rebuilding = false;
let rebuildRequested = false;

const stopWatching = watchSource(sourceDir, (file) => {
  if (file && !/\.(voyd|ts|css)$/.test(file)) return;
  void queueRebuild();
});
try {
  await queueRebuild({ failFast: true });
} catch (error) {
  stopWatching();
  console.error(errorMessage(error));
  process.exitCode = 1;
}

async function queueRebuild({ failFast = false } = {}) {
  rebuildRequested = true;
  if (rebuilding) return;
  rebuilding = true;
  try {
    while (rebuildRequested) {
      rebuildRequested = false;
      try {
        await rebuild();
      } catch (error) {
        if (failFast) throw error;
        console.error(errorMessage(error));
      }
    }
  } finally {
    rebuilding = false;
  }
}

async function rebuild() {
  await checkServer({ optimize: false });
  await rm(stagedPublicDir, { recursive: true, force: true });
  await run("vite", [
    "build",
    "--mode", "development",
    "--outDir", stagedPublicDir,
    "--emptyOutDir",
  ]);
  await checkServer({ optimize: false });
  if (app) await app.close("restart").catch(() => undefined);
  const nextApp = await serve({ optimize: false });
  try {
    await promoteAssets();
  } catch (error) {
    await nextApp.close("asset-promotion-failed").catch(() => undefined);
    throw error;
  }
  app = nextApp;
  console.log("Voyd app ready at " + app.url);
}

async function promoteAssets() {
  const stagedAssetsDir = resolve(stagedPublicDir, "assets");
  await rm(previousAssetsDir, { recursive: true, force: true });
  await rename(liveAssetsDir, previousAssetsDir).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  try {
    await rename(stagedAssetsDir, liveAssetsDir);
  } catch (error) {
    await rename(previousAssetsDir, liveAssetsDir).catch(() => undefined);
    throw error;
  }
  await rm(previousAssetsDir, { recursive: true, force: true });
  await rm(stagedPublicDir, { recursive: true, force: true });
}

function run(name, args) {
  const command = process.platform === "win32" ? name + ".cmd" : name;
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: rootDir, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolveRun()
      : reject(new Error(name + " exited with code " + code)));
  });
}

async function shutdown() {
  stopWatching();
  if (app) await app.close("shutdown").catch(() => undefined);
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
