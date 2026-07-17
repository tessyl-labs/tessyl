import { createVoydHost } from "@voyd-lang/sdk/js-host";
import {
  createVoydVxAppRuntime,
  hydrateVxApp,
  readVoydHydrationRoot,
} from "@voyd-lang/vx-dom/browser";
import wasmUrl from "./generated/client.wasm?url";
import "./style.css";

const hydration = readVoydHydrationRoot("article-editor");

async function start() {
  const wasm = new Uint8Array(await (await fetch(wasmUrl)).arrayBuffer());
  const host = await createVoydHost({
    wasm,
    bufferSize: 1024 * 1024,
    defaultAdapters: { runtime: "browser" },
  });
  const app = createVoydVxAppRuntime({ host, initialModel: hydration.model });
  const mounted = await hydrateVxApp({
    container: hydration.container,
    app,
    onHydrationMismatch: import.meta.env.MODE === "development"
      ? (mismatch) => console.warn("Voyd hydration mismatch", mismatch)
      : undefined,
  });
  import.meta.hot?.dispose(() => mounted.dispose());
}

start().catch((error) => {
  console.error(error);
  const notice = document.createElement("p");
  notice.setAttribute("role", "alert");
  notice.className = "m-5 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800";
  notice.textContent = "Interactive features could not start. You can still edit and submit this form.";
  hydration.container.prepend(notice);
});
