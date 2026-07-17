import { defineConfig } from "vite";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createTessylNative } from "@tessyl/native";

const appRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const examplesRoot = resolve(appRoot, "../../packages/tessyl-native/examples");
const exampleNames = ["calculator", "chart", "simulation"];

const serialize = (artifact) => JSON.stringify({
  ...artifact,
  wasm: Buffer.from(artifact.wasm).toString("base64"),
  sourceBundle: Buffer.from(artifact.sourceBundle).toString("base64"),
});

const examplesPlugin = () => {
  let artifactsPromise;
  let command;

  const compileExamples = async () => {
    if (artifactsPromise) return artifactsPromise;
    artifactsPromise = (async () => {
      const native = createTessylNative();
      const entries = await Promise.all(exampleNames.map(async (name) => {
        const root = resolve(examplesRoot, name);
        const [source, authorManifest] = await Promise.all([
          readFile(resolve(root, "main.voyd"), "utf8"),
          readFile(resolve(root, "tessera.json"), "utf8").then(JSON.parse),
        ]);
        const result = await native.compile({ source: { entry: "main.voyd", files: { "main.voyd": source } }, authorManifest, profile: "standard-v1" });
        if (!result.ok) throw new Error(`${name} Tessera failed to compile: ${result.diagnostics.map((item) => item.message).join("; ")}`);
        return [name, serialize(result.artifact)];
      }));
      return new Map(entries);
    })();
    return artifactsPromise;
  };

  const owns = (file) => file.startsWith(examplesRoot + sep) && /\.(voyd|json)$/.test(file);

  return {
    name: "tessyl-native-playground-examples",
    configResolved(config) { command = config.command; },
    async buildStart() {
      if (command !== "build") return;
      for (const [name, source] of await compileExamples()) this.emitFile({ type: "asset", fileName: `assets/showcase/${name}.json`, source });
    },
    async configureServer(server) {
      server.watcher.add(examplesRoot);
      await compileExamples();
      server.middlewares.use(async (request, response, next) => {
        const path = new URL(request.url ?? "/", "http://playground.local").pathname;
        const match = /^\/assets\/showcase\/([a-z-]+)\.json$/.exec(path);
        if (!match || !exampleNames.includes(match[1])) return next();
        const source = (await compileExamples()).get(match[1]);
        if (!source) return next();
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(source);
      });
      server.watcher.on("change", (file) => {
        if (!owns(file)) return;
        artifactsPromise = undefined;
        void compileExamples().then(() => server.ws.send({ type: "full-reload" })).catch((error) => server.config.logger.error(String(error)));
      });
    },
  };
};

const port = Number.parseInt(process.env.TESSYL_PLAYGROUND_PORT ?? "3001", 10);

export default defineConfig({
  plugins: [examplesPlugin()],
  resolve: { conditions: ["browser", "development"], preserveSymlinks: true },
  server: { host: process.env.TESSYL_PLAYGROUND_HOST ?? "127.0.0.1", port, strictPort: true },
  preview: { host: process.env.TESSYL_PLAYGROUND_HOST ?? "127.0.0.1", port, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
