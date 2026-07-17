import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { compileClient } from "./scripts/compile-client.mjs";

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
  plugins: [voydClient(), tailwindcss()],
  resolve: { conditions: ["development"], preserveSymlinks: true },
  publicDir: false,
  build: {
    outDir: "public",
    emptyOutDir: false,
    rollupOptions: {
      input: "src/client.ts",
      output: {
        entryFileNames: "assets/client.js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
