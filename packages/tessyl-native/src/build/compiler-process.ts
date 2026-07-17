import { fileURLToPath } from "node:url";
import { createVoydHost } from "@voyd-lang/js-host";
import { createSdk } from "@voyd-lang/sdk";
import { createVoydVxAppRuntime } from "@voyd-lang/vx-dom";
import { resourceProfile } from "../profiles.js";
import { normalizeNativeFrame } from "../protocol/normalize-frame.js";
import { validateRuntimeStep } from "../protocol/validate.js";
import { projectStaticFallback } from "./fallback.js";
import { enforceWasmLimits, inspectWasm } from "./wasm.js";

type ProcessInput = { entry: string; entrySource: string; files: Record<string, string>; profile: "standard-v1" };

const send = (value: unknown): void => { if (process.connected) process.send?.(value); };

const compile = async (input: ProcessInput): Promise<void> => {
  const profile = resourceProfile(input.profile);
  const result = await createSdk().compile({
    entryPath: input.entry,
    source: input.entrySource,
    files: input.files,
    roots: {
      src: fileURLToPath(new URL("../../.voyd", import.meta.url)),
      pkgDirs: [fileURLToPath(new URL("../../voyd", import.meta.url))],
    },
    optimizationLevel: "release",
    runtimeDiagnostics: true,
    boundaryExports: { mode: "only", include: ["app"], onUnsupported: "diagnostic" },
  });
  if (!result.success) { send({ success: false, diagnostics: result.diagnostics.slice(0, 100) }); return; }
  const wasm = enforceWasmLimits(result.wasm, profile);
  inspectWasm(wasm, profile);
  const host = await createVoydHost({ wasm, defaultAdapters: false, bufferSize: profile.maxBoundaryBytes });
  const app = createVoydVxAppRuntime({ host });
  const rawInitial = await app.init?.() as Record<string, unknown>;
  const initial = validateRuntimeStep({
    ...(rawInitial?.frame === undefined ? {} : { frame: normalizeNativeFrame(rawInitial.frame, profile) }),
    ...(rawInitial?.commands === undefined ? {} : { commands: rawInitial.commands }),
    ...(rawInitial?.subscriptions === undefined ? {} : { subscriptions: rawInitial.subscriptions }),
  }, profile);
  const frame = initial.frame ?? normalizeNativeFrame(await app.render(), profile);
  const fallback = projectStaticFallback(frame, profile);
  await app.dispose?.();
  send({ success: true, wasm, fallback });
};

process.once("message", (input: ProcessInput) => {
  void compile(input).catch((error) => {
    send({ success: false, infrastructureError: error instanceof Error ? error.message.slice(0, 300) : "compiler process failed" });
  });
});
