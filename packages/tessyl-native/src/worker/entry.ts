/// <reference lib="webworker" />
import { createVoydHost } from "@voyd-lang/js-host";
import { createVoydVxAppRuntime } from "@voyd-lang/vx-dom";
import { resourceProfile } from "../profiles.js";
import { validateBoundaryValue, validateRuntimeStep } from "../protocol/validate.js";
import { validateRuntimeRequest, type RuntimeRequest, type RuntimeResponse } from "../protocol/messages.js";
import { normalizeNativeFrame } from "../protocol/normalize-frame.js";
import { inspectWasm, wasmImportDescriptors } from "../build/wasm.js";

let port: MessagePort | undefined;
let app: ReturnType<typeof createVoydVxAppRuntime> | undefined;
let tesseraId = "";
let generation = 0;
const profile = resourceProfile("standard-v1");

const boundedStep = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object") return validateRuntimeStep(value, profile);
  const raw = value as Record<string, unknown>;
  return validateRuntimeStep({
    ...(raw.frame === undefined ? {} : { frame: normalizeNativeFrame(raw.frame, profile) }),
    ...(raw.commands === undefined ? {} : { commands: raw.commands }),
    ...(raw.subscriptions === undefined ? {} : { subscriptions: raw.subscriptions }),
  }, profile);
};

const respond = (request: RuntimeRequest, kind: RuntimeResponse["kind"], payload?: unknown): void => {
  port?.postMessage({ version: 1, tesseraId, generation, requestId: request.requestId, kind, ...(payload === undefined ? {} : { payload }) });
};

const createRestrictedHost = async (wasm: Uint8Array) => {
  const imports = WebAssembly.Module.imports;
  let patched = false;
  try {
    imports(new WebAssembly.Module(wasm.slice().buffer));
  } catch {
    Object.defineProperty(WebAssembly.Module, "imports", {
      configurable: true,
      value: () => wasmImportDescriptors(wasm),
    });
    patched = true;
  }
  try {
    return await createVoydHost({ wasm, defaultAdapters: false, bufferSize: profile.maxBoundaryBytes });
  } finally {
    if (patched) Object.defineProperty(WebAssembly.Module, "imports", { configurable: true, value: imports });
  }
};

const handle = async (raw: unknown): Promise<void> => {
  const request = validateRuntimeRequest(raw);
  if (request.tesseraId !== tesseraId || request.generation !== generation) return;
  try {
    if (request.kind === "boot") {
      const bytes = request.payload;
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > profile.maxWasmBytes) throw new Error("invalid Wasm payload");
      inspectWasm(bytes, profile);
      const host = await createRestrictedHost(bytes);
      app = createVoydVxAppRuntime({ host });
      respond(request, "result");
      return;
    }
    if (!app) throw new Error("runtime is not booted");
    if (request.kind === "init") respond(request, "result", boundedStep(await app.init?.()));
    else if (request.kind === "render") respond(request, "result", validateRuntimeStep({ frame: normalizeNativeFrame(await app.render(), profile) }, profile));
    else if (request.kind === "dispatch") {
      validateBoundaryValue(request.payload, profile.maxBoundaryBytes, "dispatch", profile);
      respond(request, "result", boundedStep(await app.dispatch(request.payload as never)));
    } else if (request.kind === "release_handlers") {
      if (!Array.isArray(request.payload) || request.payload.some((id) => !Number.isSafeInteger(id))) throw new Error("invalid handler release");
      app.retainedCallbacks?.releaseMany?.(request.payload as number[]);
      respond(request, "result");
    } else if (request.kind === "dispose") {
      await app.dispose?.(); app = undefined; respond(request, "result"); port?.close();
    } else if (request.kind === "pause") respond(request, "result");
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "runtime failure";
    respond(request, "runtime_error", { message });
  }
};

const bootstrap = (event: MessageEvent): void => {
  if (event.data?.kind !== "tessyl_worker_boot" || !(event.ports[0] instanceof MessagePort)) return;
  self.removeEventListener("message", bootstrap);
  tesseraId = String(event.data.tesseraId).slice(0, 80);
  generation = Number(event.data.generation);
  port = event.ports[0];
  port.onmessage = (message) => { void handle(message.data); };
  port.start();
  port.postMessage({ version: 1, tesseraId, generation, requestId: 0, kind: "ready" });
};
self.addEventListener("message", bootstrap);
