import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTessylNative } from "@tessyl/native";
import { compileClient } from "./scripts/compile-client.mjs";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)), "packages/tessyl-native");

const tesseraShowcase = () => ({
  name: "tessera-showcase",
  async buildStart() {
    const native = createTessylNative();
    for (const name of ["calculator", "chart", "simulation"]) {
      const root = resolve(packageRoot, "examples", name);
      const [source, authorManifest] = await Promise.all([
        readFile(resolve(root, "main.voyd"), "utf8"),
        readFile(resolve(root, "tessera.json"), "utf8").then(JSON.parse),
      ]);
      const result = await native.compile({
        source: { entry: "main.voyd", files: { "main.voyd": source } },
        authorManifest,
        profile: "standard-v1",
      });
      if (!result.ok) throw new Error(`${name} Tessera failed to compile: ${result.diagnostics.map((item) => item.message).join("; ")}`);
      const artifact = {
        ...result.artifact,
        wasm: Buffer.from(result.artifact.wasm).toString("base64"),
        sourceBundle: Buffer.from(result.artifact.sourceBundle).toString("base64"),
      };
      this.emitFile({ type: "asset", fileName: `assets/showcase/${name}.json`, source: JSON.stringify(artifact) });
    }
  },
});

const voydClient = () => ({
  name: "voyd-client",
  async buildStart() {
    await compileClient();
  },
  configureServer(server) {
    server.watcher.add("src");
  },
  async handleHotUpdate({ file, server }) {
    if (!file.endsWith(".voyd")) return;
    await compileClient();
    server.ws.send({ type: "full-reload" });
    return [];
  },
});

export default defineConfig({
  plugins: [voydClient(), tesseraShowcase(), tailwindcss()],
  resolve: { conditions: ["browser", "development"], preserveSymlinks: true },
  publicDir: false,
  build: {
    outDir: "public",
    emptyOutDir: false,
    rollupOptions: {
      input: {
        client: "src/client.ts",
        showcase: "src/showcase.ts",
      },
      output: {
        entryFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
