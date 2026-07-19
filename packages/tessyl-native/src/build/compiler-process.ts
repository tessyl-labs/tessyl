import { fileURLToPath } from "node:url";
import { createVoydHost } from "@voyd-lang/js-host";
import { createSdk } from "@voyd-lang/sdk";
import { createVoydVxAppRuntime } from "@voyd-lang/vx-dom";
import { resourceProfile } from "../profiles.js";
import { normalizeNativeFrame } from "../protocol/normalize-frame.js";
import { validateRuntimeStep } from "../protocol/validate.js";
import { projectStaticFallback } from "./fallback.js";
import { enforceWasmLimits, inspectWasm, stripAuthorTestExports } from "./wasm.js";
import type { NativeElementNode, NativeFrameV1, NativeNode, TesseraAssetReferenceV1, TesseraFallbackInteractionV1, TesseraFallbackPlanV1 } from "../types.js";

type ProcessInput = { entry: string; entrySource: string; files: Record<string, string>; profile: "standard-v1"; fallback?: TesseraFallbackPlanV1; assets?: readonly TesseraAssetReferenceV1[]; workflow: "check" | "test" | "build" };

const send = (value: unknown): void => { if (process.connected) process.send?.(value); };

const compile = async (input: ProcessInput): Promise<void> => {
  const profile = resourceProfile(input.profile);
  let result = await createSdk().compile({
    entryPath: input.entry,
    source: input.entrySource,
    files: input.files,
    roots: {
      src: fileURLToPath(new URL("../../.voyd", import.meta.url)),
      pkgDirs: [fileURLToPath(new URL("../../voyd", import.meta.url))],
    },
    optimizationLevel: "release",
    includeTests: input.workflow !== "check",
    runtimeDiagnostics: true,
    boundaryExports: { mode: "only", include: ["app"], onUnsupported: "diagnostic" },
  });
  if (!result.success) { send({ success: false, diagnostics: result.diagnostics.slice(0, 100) }); return; }
  if (input.workflow !== "check" && result.tests?.cases.length) {
    const failures: string[] = [];
    const summary = await result.tests.run({ isolation: "per-test", adapters: [], reporter: { onEvent(event) { if (event.type === "test:result" && event.result.status === "failed") failures.push(`${event.result.displayName}: ${String(event.result.error).slice(0, 300)}`); } } });
    if (summary.failed > 0) { send({ success: false, diagnostics: [{ code: "author_test_failed", severity: "error", message: `${summary.failed} Voyd author test(s) failed${failures.length ? ` — ${failures.join("; ")}` : ""}`.slice(0, 500) }] }); return; }
  }
  if (input.workflow !== "build") { send({ success: true, diagnostics: [] }); return; }
  let app: ReturnType<typeof createVoydVxAppRuntime> | undefined;
  try {
    const wasm = enforceWasmLimits(stripAuthorTestExports(result.wasm), profile);
    inspectWasm(wasm, profile);
    const host = await createVoydHost({ wasm, defaultAdapters: false, bufferSize: profile.maxBoundaryBytes });
    app = createVoydVxAppRuntime({ host });
    const rawInitial = await app.init?.() as Record<string, unknown>;
    const initial = validateRuntimeStep({
      ...(rawInitial?.frame === undefined ? {} : { frame: normalizeNativeFrame(rawInitial.frame, profile) }),
      ...(rawInitial?.commands === undefined ? {} : { commands: rawInitial.commands }),
      ...(rawInitial?.subscriptions === undefined ? {} : { subscriptions: rawInitial.subscriptions }),
    }, profile);
    let frame = (initial.frame ?? normalizeNativeFrame(await app.render(), profile)) as NativeFrameV1;
    assertReviewedAssets(frame, input.assets ?? []);
    for (const interaction of input.fallback?.interactions ?? []) {
      const message = fallbackMessage(frame, interaction);
      if (!message) throw new Error(`Fallback target was not found: ${interaction.targetLabel.slice(0, 80)}`);
      const rawStep = await app.dispatch(message as never) as Record<string, unknown>;
      const step = validateRuntimeStep({
        ...(rawStep?.frame === undefined ? {} : { frame: normalizeNativeFrame(rawStep.frame, profile) }),
        ...(rawStep?.commands === undefined ? {} : { commands: rawStep.commands }),
        ...(rawStep?.subscriptions === undefined ? {} : { subscriptions: rawStep.subscriptions }),
      }, profile);
      frame = (step.frame ?? normalizeNativeFrame(await app.render(), profile)) as NativeFrameV1;
      assertReviewedAssets(frame, input.assets ?? []);
    }
    const fallback = projectStaticFallback(frame, profile);
    const fallbackText = nodeText(fallback.root);
    const diagnostics = (input.fallback?.essentialContent ?? [])
      .filter((content) => !fallbackText.includes(content))
      .map((content) => ({ code: "fallback_content_removed", severity: "warning" as const, message: `Projected fallback is missing essential content: ${content.slice(0, 120)}` }));
    send({ success: true, wasm, fallback, diagnostics });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Author build execution failed";
    send({ success: false, diagnostics: [{ code: "author_build_failed", severity: "error", message: message.slice(0, 500) }] });
  } finally {
    await app?.dispose?.();
  }
};

const assertReviewedAssets = (frame: NativeFrameV1, assets: readonly TesseraAssetReferenceV1[]): void => {
  const declared = new Map(assets.map((asset) => [asset.id, asset.accessibleName]));
  const stack: NativeNode[] = [frame.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === "fragment") { stack.push(...node.children); continue; }
    if (node.kind !== "element") continue;
    const id = node.attrs?.["data-native-asset-id"];
    if (id !== undefined && (typeof id !== "string" || node.tag !== "img" || !declared.has(id) || node.attrs?.["aria-label"] !== declared.get(id))) throw new Error("Rendered reviewed asset metadata does not match its declaration");
    stack.push(...(node.children ?? []));
  }
};

const nodeText = (node: NativeNode): string => node.kind === "text"
  ? node.value
  : (node.kind === "fragment" ? node.children : node.children ?? []).map(nodeText).join(" ");

const fallbackMessage = (frame: NativeFrameV1, interaction: TesseraFallbackInteractionV1): unknown | undefined => {
  const stack: NativeNode[] = [frame.root];
  const matches: NativeElementNode[] = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === "fragment") { stack.push(...node.children); continue; }
    if (node.kind !== "element") continue;
    stack.push(...(node.children ?? []));
    const label = String(node.attrs?.["aria-label"] ?? nodeText(node)).trim();
    const descriptor = node.events?.find((event) => event.event === interaction.event);
    if (label !== interaction.targetLabel || !descriptor) continue;
    matches.push(node);
  }
  if (matches.length > 1) throw new Error(`Fallback target is ambiguous: ${interaction.targetLabel.slice(0, 80)}`);
  const node = matches[0];
  if (node) {
    const descriptor = node.events?.find((event) => event.event === interaction.event)!;
    const payload = interaction.event === "click"
      ? { kind: "event", event: "click" }
      : { kind: "input", value: String(interaction.value ?? ""), checked: interaction.value === true, input_type: String(node.attrs?.type ?? node.tag) };
    let message: unknown = descriptor.handlerId === undefined
      ? { kind: "msgpack", value: descriptor.message }
      : { kind: "event", handlerId: descriptor.handlerId, payload };
    for (const handlerId of descriptor.mapHandlerIds ?? []) message = { kind: "map", handlerId, message };
    return message;
  }
  return undefined;
};

process.once("message", (input: ProcessInput) => {
  void compile(input).catch((error) => {
    send({ success: false, infrastructureError: error instanceof Error ? error.message.slice(0, 300) : "compiler process failed" });
  });
});
