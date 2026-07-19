import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number.parseInt(process.env.TFM_PLAYGROUND_PORT ?? "3002", 10);
const rendererCss = resolve(root, "../renderer.css");
const designTokensSource = resolve(root, "../../design-tokens/src/index.ts");
const styleGenerator = resolve(root, "../scripts/generate-renderer-styles.mjs");
const videoFixture = resolve(root, "fixtures/demo-video.webm.base64");
const run = promisify(execFile);

const fixtureWav = () => {
  const sampleRate = 8_000;
  const samples = sampleRate / 2;
  const output = Buffer.alloc(44 + samples);
  output.write("RIFF", 0); output.writeUInt32LE(36 + samples, 4); output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate, 28);
  output.writeUInt16LE(1, 32); output.writeUInt16LE(8, 34); output.write("data", 36); output.writeUInt32LE(samples, 40);
  for (let index = 0; index < samples; index += 1) output[44 + index] = 128 + Math.round(20 * Math.sin(index * Math.PI / 20));
  return output;
};

const fixtureVideo = () => Buffer.from(readFileSync(videoFixture, "utf8").trim(), "base64");

const tfmPlaygroundPlugin = () => {
  let command;
  return {
    name: "tfm-playground-fixtures",
    configResolved(config) { command = config.command; },
    buildStart() {
      if (command !== "build") return;
      this.emitFile({ type: "asset", fileName: "fixtures/demo.wav", source: fixtureWav() });
      this.emitFile({ type: "asset", fileName: "fixtures/demo-video.webm", source: fixtureVideo() });
    },
    async handleHotUpdate(context) {
      if (context.file !== rendererCss) return;
      await run(process.execPath, [styleGenerator]);
      context.server.ws.send({ type: "full-reload" });
      return [];
    },
    configureServer(server) {
      server.watcher.add(rendererCss);
      const wav = fixtureWav();
      const video = fixtureVideo();
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? "/", "http://tfm.local").pathname;
        if (path !== "/fixtures/demo.wav" && path !== "/fixtures/demo-video.webm") return next();
        response.statusCode = 200;
        response.setHeader("Content-Type", path.endsWith(".webm") ? "video/webm" : "audio/wav");
        response.setHeader("Cache-Control", "no-store");
        response.end(path.endsWith(".webm") ? video : wav);
      });
    },
  };
};

export default defineConfig({
  root,
  plugins: [tfmPlaygroundPlugin()],
  resolve: {
    alias: [{ find: /^@tessyl\/design-tokens$/, replacement: designTokensSource }],
    conditions: ["development"],
    preserveSymlinks: true,
  },
  server: { host: process.env.TFM_PLAYGROUND_HOST ?? "127.0.0.1", port, strictPort: true },
  preview: { host: process.env.TFM_PLAYGROUND_HOST ?? "127.0.0.1", port, strictPort: true },
  build: { outDir: resolve(root, "dist"), emptyOutDir: true },
});
