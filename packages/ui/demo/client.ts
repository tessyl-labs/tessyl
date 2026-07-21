import { createVoydHost } from "@voyd-lang/sdk/js-host"
import { createVoydVxAppRuntime, mountVxApp } from "@voyd-lang/vx-dom/browser"
import wasmUrl from "./generated/main.wasm?url"
import { adapters } from "./generated/voyd-adapters"
import { installUiAdapters } from "../ui-adapters"
import "./style.css"

const container = document.getElementById("app")
if (!container) throw new Error("Missing #app element")

const wasm = new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer())
const host = await createVoydHost({ wasm, bufferSize: 1024 * 1024, adapters })
const app = createVoydVxAppRuntime({ host })
const disposeUiAdapters = installUiAdapters(container)
const mounted = await mountVxApp({
  container,
  app,
  onError: (error, context) => console.error(`Tessyl UI ${context.phase} failed`, error),
})

import.meta.hot?.dispose(() => {
  disposeUiAdapters()
  mounted.dispose()
})
