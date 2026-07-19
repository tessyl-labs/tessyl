import { defineConfig } from "vite";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createTessylNative, renderStaticArtifactHtml } from "@tessyl/native";

const appRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const examplesRoot = resolve(appRoot, "../examples");
const exampleNames = ["calculator", "chart", "simulation", "orbital-simulation", "mathematical-diagram"];

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
      const entries = [];
      for (const name of exampleNames) {
        const root = resolve(examplesRoot, name);
        const [source, projectManifest] = await Promise.all([
          readFile(resolve(root, "main.voyd"), "utf8"),
          readFile(resolve(root, "tessera.json"), "utf8").then(JSON.parse),
        ]);
        const { entry, ...authorManifest } = projectManifest;
        if (entry !== "main.voyd") throw new Error(`${name} Tessera declares an unsupported entry path`);
        const result = await native.compile({ source: { entry, files: { [entry]: source } }, authorManifest, profile: "standard-v1" });
        if (!result.ok) throw new Error(`${name} Tessera failed to compile: ${result.diagnostics.map((item) => item.message).join("; ")}`);
        entries.push([name, result.artifact]);
      }
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
      for (const [name, artifact] of await compileExamples()) this.emitFile({ type: "asset", fileName: `assets/showcase/${name}.json`, source: serialize(artifact) });
    },
    async transformIndexHtml(html) {
      let transformed = html;
      for (const [name, artifact] of await compileExamples()) {
        const fallback = `<section class="fallback" role="region" aria-label="${escapeAttribute(artifact.metadata.accessibleName)}">${await renderStaticArtifactHtml(artifact)}</section>`;
        const stage = new RegExp(`(<div class="tessera-stage"[^>]*data-tessera-id="${name}"[^>]*>)[\\s\\S]*?(</div>\\s*<p class="status-line")`);
        transformed = transformed.replace(stage, `$1${fallback}$2`);
      }
      return transformed;
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
        response.end(serialize(source));
      });
      server.watcher.on("change", (file) => {
        if (!owns(file)) return;
        artifactsPromise = undefined;
        void compileExamples().then(() => server.ws.send({ type: "full-reload" })).catch((error) => server.config.logger.error(String(error)));
      });
    },
  };
};

const escapeAttribute = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

const port = Number.parseInt(process.env.TESSYL_PLAYGROUND_PORT ?? "3001", 10);

export default defineConfig({
  root: appRoot,
  plugins: [examplesPlugin()],
  resolve: { conditions: ["browser", "development"], preserveSymlinks: true },
  server: { host: process.env.TESSYL_PLAYGROUND_HOST ?? "127.0.0.1", port, strictPort: true },
  preview: { host: process.env.TESSYL_PLAYGROUND_HOST ?? "127.0.0.1", port, strictPort: true },
  build: { outDir: resolve(appRoot, "dist"), emptyOutDir: true },
});
