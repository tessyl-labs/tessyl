import { createSdk } from "@voyd-lang/sdk";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compilationError, errorMessage } from "./diagnostics.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entryPath = resolve(rootDir, "src/main.voyd");
process.chdir(rootDir);

export async function serve({
  host = process.env.HOST ?? process.env.VOYD_WEB_HOST ?? "127.0.0.1",
  port = readPort(),
  optimize = process.env.VOYD_WEB_OPTIMIZE !== "false",
} = {}) {
  const result = await createSdk().serveWebApp({
    entryPath,
    host,
    port,
    optimize,
    runtimeDiagnostics: true,
    run: {
      bufferSize: 1024 * 1024,
      defaultAdapters: { runtime: "node" },
    },
  });
  if (!result.success) {
    throw compilationError(result.diagnostics);
  }
  return result;
}

export async function checkServer({ optimize = false } = {}) {
  const result = await createSdk().compile({
    entryPath,
    optimize,
    runtimeDiagnostics: true,
  });
  if (!result.success) {
    throw compilationError(result.diagnostics);
  }
}

function readPort() {
  const parsed = Number.parseInt(process.env.PORT ?? process.env.VOYD_WEB_PORT ?? "3000", 10);
  return Number.isFinite(parsed) ? parsed : 3000;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runServer().catch((error) => {
    console.error(errorMessage(error));
    process.exitCode = 1;
  });
}

async function runServer() {
  const app = await serve();
  console.log("Voyd app ready at " + app.url);
  let closing = false;
  const keepAlive = setInterval(() => undefined, 1_000_000_000);
  const shutdown = new Promise((resolveShutdown) => {
    const close = (signal) => {
      if (closing) return;
      closing = true;
      clearInterval(keepAlive);
      void app.close(signal).finally(resolveShutdown);
    };
    process.once("SIGINT", () => close("SIGINT"));
    process.once("SIGTERM", () => close("SIGTERM"));
  });
  const unexpectedClose = app.closed.then(
    () => {
      if (!closing) throw new Error("Voyd server stopped unexpectedly");
    },
    (error) => {
      if (!closing) throw error;
    },
  );
  try {
    await Promise.race([shutdown, unexpectedClose]);
  } finally {
    clearInterval(keepAlive);
  }
}
