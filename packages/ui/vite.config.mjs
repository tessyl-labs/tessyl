import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { compileVoyd } from "./scripts/compile-voyd.mjs"

const voyd = () => ({
  name: "tessyl-ui-voyd",
  async buildStart() { await compileVoyd() },
  configureServer(server) { server.watcher.add(["src", "demo"]) },
  async handleHotUpdate({ file, server }) {
    if (!file.endsWith(".voyd")) return
    await compileVoyd()
    server.ws.send({ type: "full-reload" })
    return []
  },
})

export default defineConfig({
  plugins: [voyd(), tailwindcss()],
  resolve: { conditions: ["browser", "development"], preserveSymlinks: true },
  build: { outDir: "dist", emptyOutDir: true },
})
