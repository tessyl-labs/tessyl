import { TessylNativeError } from "../errors.js";
import { resourceProfile } from "../profiles.js";
import { validateRuntimeResponse, type RuntimeRequest, type RuntimeResponse } from "../protocol/messages.js";
import { isCanonicalArticleSlug, validateBoundaryValue, validateFrame, validateRuntimeStep } from "../protocol/validate.js";
import { RENDERER_SRCDOC } from "../renderer/srcdoc.js";
import { renderValidatedStaticArtifact, renderValidatedStaticArtifactHtml, renderStaticFallback, staticFallbackStyles } from "../fallback-renderer.js";
import type { InitializeTesseraInput, NativeFrameV1, NativeNode, TesseraInstance, TesseraStatus, TessylNativeConfig } from "../types.js";
import { assertOutstandingDelayCapacity } from "./command-limits.js";
import { runtimeScheduler } from "./runtime-scheduler.js";
import { createNativeShell, type NativeShell } from "./shell.js";
import { projectStaticFallback } from "../build/fallback.js";

type Pending = { generation: number; resolve(value: unknown): void; reject(error: unknown): void; timeout: ReturnType<typeof setTimeout> };
type QueuedMessage = { message: unknown; releaseIds: number[]; handlerIds: number[]; coalesceKey?: string; purgeKey?: string; simulationAdvanceMs?: number };
type RendererPending = { generation: number; resolve(): void; reject(error: unknown): void; timeout: ReturnType<typeof setTimeout> };
type SubscriptionKind = "animation_frame" | "fixed_timestep" | "reduced_motion" | "container_size" | "native_input_number" | "native_input_string" | "native_input_boolean" | "native_dataset_text" | "native_shareable_state";
type ActiveSubscription = { kind: SubscriptionKind; mapHandlerIds: number[]; ownedHandlerIds: number[]; cancel(): void };
type FlatSubscription = Omit<ActiveSubscription, "cancel"> & { identity: string; key: string };

export class BrowserTesseraInstance implements TesseraInstance {
  #status: TesseraStatus = "loading";
  #generation = 0;
  #requestId = 0;
  #rendererRequestId = 0;
  #worker?: Worker;
  #workerPort?: MessagePort;
  #iframe?: HTMLIFrameElement;
  #rendererPort?: MessagePort;
  #releaseWorkerSlot?: () => void;
  #pending = new Map<number, Pending>();
  #rendererPending = new Map<number, RendererPending>();
  #retiredRendererRequests = new Set<number>();
  #rendererReady?: { resolve(): void; reject(error: unknown): void; timeout: ReturnType<typeof setTimeout> };
  #workerReady?: { generation: number; resolve(): void; reject(error: unknown): void; timeout: ReturnType<typeof setTimeout> };
  #queue: QueuedMessage[] = [];
  #drainGeneration?: number;
  #requestedActive = true;
  #nearViewport = true;
  #pageSuspended = false;
  #active = true;
  #lifecycle: Promise<void> = Promise.resolve();
  #commandTimers = new Map<ReturnType<typeof setTimeout>, number[]>();
  #commandHandlerRefs = new Map<number, number>();
  #subscriptions = new Map<string, ActiveSubscription>();
  #inFlightHandlerIds = new Set<number>();
  #deferredSubscriptionHandlerReleases = new Set<number>();
  #frameHandlerIds = new Set<number>();
  #transitionTimes: number[] = [];
  #runStartedAt = 0;
  #intersection?: IntersectionObserver;
  readonly #id = `tessera-${crypto.randomUUID()}`;
  readonly #profile = resourceProfile("standard-v1");
  readonly #input: InitializeTesseraInput;
  readonly #hostContainer: HTMLElement;
  readonly #config: TessylNativeConfig;
  readonly #shell: NativeShell;
  readonly #rendererAssets: Readonly<Record<string, string>>;
  readonly #initialShareableState: string;
  #shareableState: string;
  #animationGenerationStartedAt = 0;
  #fixedStepElapsed = new Map<string, number>();
  #latestFrame?: NativeFrameV1;
  #expandedView = false;

  readonly #onVisibilityChange = (): void => this.#recomputeActive();
  readonly #onPageHide = (): void => { this.#pageSuspended = true; this.#recomputeActive(); };
  readonly #onPageShow = (): void => { this.#pageSuspended = false; this.#recomputeActive(); };
  readonly #onAbort = (): void => this.dispose();

  constructor(input: InitializeTesseraInput, config: TessylNativeConfig) {
    this.#hostContainer = input.container;
    this.#config = config;
    this.#initialShareableState = boundedShareableState(input.shareableState ?? "");
    this.#shareableState = this.#initialShareableState;
    this.#rendererAssets = Object.fromEntries(input.artifact.resources.assets.flatMap((definition) => {
      const bytes = input.assets?.[definition.id];
      return bytes ? [[definition.id, dataUrl(bytes, definition.mediaType)]] : [];
    }));
    this.#shell = createNativeShell({
      container: input.container,
      metadata: input.artifact.metadata,
      expanded: input.presentation?.expandedView === true,
      onReset: () => { void this.reset().catch(() => undefined); },
      onRestart: () => { void this.restart().catch(() => undefined); },
      onExpandedChange: (expanded) => {
        this.#expandedView = expanded;
        if (this.#iframe) {
          this.#iframe.style.height = expanded ? "min(82vh, 52rem)" : presentationHeight(input.presentation?.height);
          this.#iframe.dataset.tessylExpandedView = String(expanded);
        }
        try { this.#config.runtime?.onExpandedViewChange?.(expanded); } catch { /* Shell adapters are observational. */ }
      },
      onExport: () => this.exportResult(),
      onInspectSource: () => this.#inspectSource(),
      onInspectProvenance: () => this.#inspectProvenance(),
    });
    this.#input = {
      ...input,
      container: this.#shell.content,
      ...(input.datasets ? { datasets: cloneByteEntries(input.datasets) } : {}),
      ...(input.assets ? { assets: cloneByteEntries(input.assets) } : {}),
    };
    renderStaticFallback(this.#input.container, input.artifact.fallback);
    input.signal?.addEventListener("abort", this.#onAbort, { once: true });
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
    window.addEventListener("pagehide", this.#onPageHide);
    window.addEventListener("pageshow", this.#onPageShow);
    document.addEventListener("freeze", this.#onPageHide);
    document.addEventListener("resume", this.#onPageShow);
    if (typeof IntersectionObserver !== "undefined") {
      this.#intersection = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        this.#nearViewport = entry.isIntersecting;
        this.#recomputeActive();
      }, { rootMargin: "320px" });
      this.#intersection.observe(this.#hostContainer);
    }
    this.#recomputeActive();
  }

  get status(): TesseraStatus { return this.#status; }

  async initializeRenderer(publishStatus = true): Promise<void> {
    if (this.#status === "disposed") throw disposed();
    if (this.#iframe && this.#rendererPort) return;
    const iframe = document.createElement("iframe");
    iframe.title = this.#input.artifact.fallback.root.kind === "element" ? String(this.#input.artifact.fallback.root.attrs?.["aria-label"] ?? "Interactive content") : "Interactive content";
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.srcdoc = RENDERER_SRCDOC;
    iframe.style.width = "100%";
    iframe.style.border = "0";
    iframe.style.height = this.#input.presentation?.expandedView ? "min(82vh, 52rem)" : presentationHeight(this.#input.presentation?.height);
    iframe.dataset.tessylExpandedView = String(this.#input.presentation?.expandedView === true);
    iframe.hidden = true;
    const channel = new MessageChannel();
    this.#rendererPort = channel.port1;
    this.#rendererPort.onmessage = (event) => this.#onRendererMessage(event.data);
    this.#rendererPort.start();
    this.#iframe = iframe;
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { this.#rendererReady = undefined; reject(this.#rendererFailure("Renderer initialization timed out", "timeout")); }, this.#profile.startupTimeoutMs);
      this.#rendererReady = { resolve, reject, timeout };
    });
    iframe.addEventListener("load", () => iframe.contentWindow?.postMessage({ version: 1, kind: "tessyl_renderer_boot", assets: this.#rendererAssets }, "*", [channel.port2]), { once: true });
    iframe.addEventListener("error", () => {
      const pending = this.#rendererReady;
      if (!pending) return;
      clearTimeout(pending.timeout); this.#rendererReady = undefined; pending.reject(this.#rendererFailure("Renderer failed to load"));
    }, { once: true });
    this.#input.container.append(iframe);
    await ready;
    if (publishStatus) this.#setStatus(this.#active ? "initialized" : "paused");
  }

  run(): Promise<void> {
    return this.#serialize(() => this.#runLocked());
  }

  reset(): Promise<void> {
    return this.#serialize(async () => {
      if (this.status === "disposed") throw disposed();
      this.#terminateGeneration();
      this.#disposeRenderer();
      this.#latestFrame = undefined;
      this.#shareableState = this.#initialShareableState;
      try { this.#config.runtime?.onShareableStateChange?.(this.#shareableState); } catch { /* Share adapters are observational. */ }
      renderStaticFallback(this.#input.container, this.#input.artifact.fallback);
      this.#setStatus(this.#active ? "initialized" : "paused");
      if (this.#active) await this.#runLocked();
    });
  }

  async restart(): Promise<void> {
    const started = performance.now();
    await this.reset();
    try { this.#config.telemetry?.record({ phase: "run", outcome: "success", durationMs: performance.now() - started, revision: this.#input.artifact.metadata.revision, restartCategory: "manual", capabilitySource: "host" }); } catch { /* Observability cannot control recovery. */ }
  }

  setActive(active: boolean): void {
    if (this.#status === "disposed" || this.#requestedActive === active) return;
    this.#requestedActive = active;
    this.#recomputeActive();
  }

  setExpandedView(expanded: boolean): void {
    if (this.#status === "disposed") return;
    this.#shell.setExpanded(expanded);
  }

  getShareableState(): string { return this.#shareableState; }

  async exportResult(): Promise<Blob> {
    const fallback = this.#latestFrame ? projectStaticFallback(this.#latestFrame, this.#profile) : this.#input.artifact.fallback;
    const html = `<!doctype html><meta charset="utf-8"><style>${staticFallbackStyles}</style>${renderValidatedStaticArtifactHtml(this.#input.artifact, fallback)}`;
    return new Blob([html], { type: "text/html" });
  }

  dispose(): void {
    if (this.#status === "disposed") return;
    const fallback = this.#latestFrame ? projectStaticFallback(this.#latestFrame, this.#profile) : this.#input.artifact.fallback;
    this.#setStatus("disposed");
    this.#requestedActive = false;
    this.#active = false;
    this.#intersection?.disconnect();
    this.#input.signal?.removeEventListener("abort", this.#onAbort);
    document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    window.removeEventListener("pagehide", this.#onPageHide);
    window.removeEventListener("pageshow", this.#onPageShow);
    document.removeEventListener("freeze", this.#onPageHide);
    document.removeEventListener("resume", this.#onPageShow);
    this.#terminateGeneration();
    this.#disposeRenderer();
    this.#latestFrame = undefined;
    if (this.#expandedView) {
      this.#expandedView = false;
      try { this.#config.runtime?.onExpandedViewChange?.(false); } catch { /* Shell adapters are observational. */ }
    }
    this.#shell.dispose();
    renderValidatedStaticArtifact(this.#hostContainer, this.#input.artifact, fallback);
    runtimeScheduler.cancel(this);
    this.#queue = [];
  }

  #serialize(operation: () => Promise<void>): Promise<void> {
    const next = this.#lifecycle.then(operation, operation);
    this.#lifecycle = next.catch(() => undefined);
    return next;
  }

  async #runLocked(): Promise<void> {
    if (this.#status === "disposed") throw disposed();
    delete this.#hostContainer.dataset.tessylNativeFailureCode;
    if (this.#status === "running") return;
    if (!this.#active) { this.#setStatus("paused"); return; }
    this.#setStatus("starting");
    this.#runStartedAt = performance.now();
    try {
      if (!this.#iframe) await this.initializeRenderer(false);
      await this.#startGeneration();
      if (!this.#active) { this.#terminateGeneration(); this.#setStatus("paused"); return; }
      this.#setStatus("running");
      if (this.#iframe) this.#iframe.inert = false;
    } catch (error) {
      if (this.status === "disposed") throw disposed();
      if (!this.#active) { this.#setStatus("paused"); return; }
      this.#fail(error);
      throw error;
    }
  }

  async #startGeneration(): Promise<void> {
    this.#terminateGeneration();
    const generation = ++this.#generation;
    const release = await runtimeScheduler.acquire(this);
    if (this.#status === "disposed" || !this.#active || generation !== this.#generation) { release(); throw disposed("Runtime start was cancelled"); }
    this.#releaseWorkerSlot = release;
    this.#animationGenerationStartedAt = performance.now();
    this.#fixedStepElapsed.clear();
    this.#requestId = 0;
    const worker = new Worker(new URL("../worker/entry.js", import.meta.url), { type: "module", name: this.#id });
    const channel = new MessageChannel();
    this.#worker = worker;
    this.#workerPort = channel.port1;
    this.#workerPort.onmessage = (event) => this.#onWorkerMessage(event.data);
    this.#workerPort.start();
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new TessylNativeError({ code: "timeout", phase: "run", message: "Worker startup timed out", recoverable: true })), this.#profile.startupTimeoutMs);
      this.#workerReady = { generation, resolve, reject, timeout };
    });
    worker.addEventListener("error", () => {
      if (generation === this.#generation && worker === this.#worker) this.#fail(new TessylNativeError({ code: "trap", phase: "run", message: "Worker execution failed", recoverable: true }));
    }, { once: true });
    worker.postMessage({ kind: "tessyl_worker_boot", tesseraId: this.#id, generation }, [channel.port2]);
    await ready;
    this.#assertGeneration(generation);
    await this.#request("boot", this.#input.artifact.wasm.slice(), this.#profile.startupTimeoutMs);
    this.#assertGeneration(generation);
    const step = validateRuntimeStep(await this.#request("init", undefined, this.#profile.startupTimeoutMs), this.#profile);
    await this.#acceptStep(step);
  }

  #request(kind: RuntimeRequest["kind"], payload?: unknown, timeoutMs = this.#profile.rpcTimeoutMs): Promise<unknown> {
    if (!this.#workerPort) return Promise.reject(new TessylNativeError({ code: "trap", phase: "run", message: "Worker is unavailable", recoverable: true }));
    const requestId = ++this.#requestId;
    const generation = this.#generation;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(requestId);
        this.#terminateGeneration();
        reject(new TessylNativeError({ code: "timeout", phase: "run", message: "Tessera operation timed out", recoverable: true }));
      }, timeoutMs);
      this.#pending.set(requestId, { generation, resolve, reject, timeout });
      this.#workerPort!.postMessage({ version: 1, tesseraId: this.#id, generation, requestId, kind, ...(payload === undefined ? {} : { payload }) } satisfies RuntimeRequest);
    });
  }

  #onWorkerMessage(raw: unknown): void {
    let response: RuntimeResponse;
    try { response = validateRuntimeResponse(raw); }
    catch (error) { this.#fail(error); return; }
    if (response.tesseraId !== this.#id || response.generation !== this.#generation) return;
    if (response.kind === "ready") {
      const ready = this.#workerReady;
      if (!ready || ready.generation !== response.generation) { this.#fail(this.#protocolFailure("Unexpected Worker ready message")); return; }
      clearTimeout(ready.timeout); this.#workerReady = undefined; ready.resolve(); return;
    }
    const pending = this.#pending.get(response.requestId);
    if (!pending || pending.generation !== response.generation) { this.#fail(this.#protocolFailure("Unexpected or duplicate Worker response")); return; }
    clearTimeout(pending.timeout); this.#pending.delete(response.requestId);
    if (response.kind === "runtime_error") pending.reject(new TessylNativeError({ code: "trap", phase: "run", message: "Tessera runtime failed", recoverable: true, cause: response.payload }));
    else pending.resolve(response.payload);
  }

  #onRendererMessage(raw: unknown): void {
    try {
      validateBoundaryValue(raw, this.#profile.maxBoundaryBytes, "renderer", this.#profile);
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw this.#protocolFailure("Invalid renderer message");
      const record = raw as Record<string, unknown>;
      if (record.version !== 1 || typeof record.kind !== "string") throw this.#protocolFailure("Invalid renderer envelope");
      if (record.kind === "ready") {
        if (Object.keys(record).some((key) => !["version", "kind"].includes(key)) || !this.#rendererReady) throw this.#protocolFailure("Unexpected renderer ready message");
        const ready = this.#rendererReady; clearTimeout(ready.timeout); this.#rendererReady = undefined; ready.resolve(); return;
      }
      if (record.kind === "rendered") {
        if (Object.keys(record).some((key) => !["version", "kind", "requestId"].includes(key)) || !Number.isSafeInteger(record.requestId)) throw this.#protocolFailure("Invalid renderer reply");
        const pending = this.#rendererPending.get(record.requestId as number);
        if (!pending && this.#retiredRendererRequests.delete(record.requestId as number)) return;
        if (!pending) throw this.#protocolFailure("Unexpected renderer reply");
        if (pending.generation !== this.#generation) { clearTimeout(pending.timeout); pending.reject(this.#rendererFailure("Stale renderer reply")); this.#retireRendererRequest(record.requestId as number); return; }
        clearTimeout(pending.timeout); this.#rendererPending.delete(record.requestId as number); pending.resolve(); return;
      }
      if (record.kind === "render_error") {
        if (Object.keys(record).some((key) => !["version", "kind", "requestId"].includes(key)) || !Number.isSafeInteger(record.requestId)) throw this.#protocolFailure("Invalid renderer error reply");
        const pending = this.#rendererPending.get(record.requestId as number);
        if (!pending && this.#retiredRendererRequests.delete(record.requestId as number)) return;
        if (!pending) throw this.#protocolFailure("Unexpected renderer error reply");
        if (pending.generation !== this.#generation) { clearTimeout(pending.timeout); pending.reject(this.#rendererFailure("Stale renderer reply")); this.#retireRendererRequest(record.requestId as number); return; }
        clearTimeout(pending.timeout); this.#rendererPending.delete(record.requestId as number);
        pending.reject(this.#rendererFailure("Renderer rejected the frame")); return;
      }
      if (record.kind === "event") {
        if (this.#status !== "running") return;
        if (Object.keys(record).some((key) => !["version", "kind", "handlerId", "message", "payload", "mapHandlerIds"].includes(key))) throw this.#protocolFailure("Invalid renderer event");
        const mapHandlerIds = record.mapHandlerIds === undefined ? [] : record.mapHandlerIds;
        if (!Array.isArray(mapHandlerIds) || mapHandlerIds.some((id) => !Number.isSafeInteger(id) || id < 0)) throw this.#protocolFailure("Invalid renderer event map");
        let runtimeMessage: unknown = record.handlerId === undefined
          ? { kind: "msgpack", value: record.message }
          : { kind: "event", handlerId: record.handlerId, payload: record.payload };
        for (const handlerId of mapHandlerIds as number[]) runtimeMessage = { kind: "map", handlerId, message: runtimeMessage };
        const payloadKind = (record.payload as Record<string, unknown> | undefined)?.kind;
        const coalesceKey = payloadKind === "input"
          ? `input:${String(record.handlerId ?? "message")}:${(mapHandlerIds as number[]).join(",")}`
          : undefined;
        const eventHandlerIds = [record.handlerId, ...(mapHandlerIds as number[])].filter((id): id is number => Number.isSafeInteger(id));
        this.#enqueue(runtimeMessage, [], coalesceKey, eventHandlerIds);
        return;
      }
      if (record.kind === "event_error") {
        if (Object.keys(record).some((key) => !["version", "kind", "code"].includes(key)) || record.code !== "resource_limit") throw this.#protocolFailure("Invalid renderer event error");
        this.#fail(new TessylNativeError({ code: "resource_limit", phase: "run", message: "Renderer event payload exceeded its resource limit", recoverable: true }));
        return;
      }
      if (record.kind === "article_link") {
        if (this.#status !== "running") return;
        if (Object.keys(record).some((key) => !["version", "kind", "slug"].includes(key)) || typeof record.slug !== "string" || !isCanonicalArticleSlug(record.slug)) throw this.#protocolFailure("Invalid article link activation");
        try { this.#config.runtime?.onArticleLink(record.slug); } catch { /* Host navigation adapters cannot corrupt a runtime. */ }
        return;
      }
      throw this.#protocolFailure("Unknown renderer message");
    } catch (error) { this.#fail(error); }
  }

  #enqueue(message: unknown, releaseIds: number[] = [], coalesceKey?: string, handlerIds: number[] = [], purgeKey?: string, simulationAdvanceMs?: number): boolean {
    try { validateBoundaryValue(message, this.#profile.maxBoundaryBytes, "event", this.#profile); }
    catch (error) { this.#fail(error); return false; }
    if (coalesceKey) {
      const existingIndex = this.#queue.findIndex((queued) => queued.coalesceKey === coalesceKey);
      if (existingIndex >= 0) {
        const existing = this.#queue.splice(existingIndex, 1)[0]!;
        existing.message = message; existing.releaseIds.push(...releaseIds); existing.handlerIds = [...new Set([...existing.handlerIds, ...handlerIds])];
        this.#queue.push(existing);
        return true;
      }
    }
    if (this.#queue.length >= this.#profile.maxQueue) { this.#fail(new TessylNativeError({ code: "resource_limit", phase: "run", message: "Event queue limit exceeded", recoverable: true })); return false; }
    this.#queue.push({ message, releaseIds, handlerIds, ...(coalesceKey ? { coalesceKey } : {}), ...(purgeKey ? { purgeKey } : {}), ...(simulationAdvanceMs ? { simulationAdvanceMs } : {}) });
    void this.#drain();
    return true;
  }

  #purgeQueuedSimulation(purgeKey: string): number {
    let discardedAdvance = 0;
    this.#queue = this.#queue.filter((queued) => {
      if (queued.purgeKey !== purgeKey) return true;
      discardedAdvance += queued.simulationAdvanceMs ?? 0;
      return false;
    });
    return discardedAdvance;
  }

  async #drain(): Promise<void> {
    if (this.#drainGeneration !== undefined || !this.#active || this.#status === "disposed") return;
    const generation = this.#generation;
    this.#drainGeneration = generation;
    let batch = 0;
    try {
      while (this.#queue.length && this.#active && generation === this.#generation) {
        const queued = this.#queue.shift()!;
        this.#inFlightHandlerIds = new Set(queued.handlerIds);
        const step = validateRuntimeStep(await this.#request("dispatch", queued.message), this.#profile);
        this.#assertGeneration(generation);
        await this.#acceptStep(step);
        this.#assertGeneration(generation);
        await this.#finishCommandHandlers(queued.releaseIds);
        this.#assertGeneration(generation);
        this.#inFlightHandlerIds.clear();
        await this.#flushDeferredSubscriptionHandlerReleases();
        this.#assertGeneration(generation);
        batch += 1;
        if (batch >= 8) { batch = 0; await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
      }
    } catch (error) { if (generation === this.#generation) this.#fail(error); }
    finally {
      this.#inFlightHandlerIds.clear();
      if (this.#drainGeneration === generation) {
        this.#drainGeneration = undefined;
        if (this.#queue.length && this.#active) void this.#drain();
      }
    }
  }

  async #acceptStep(step: Record<string, unknown>): Promise<void> {
    this.#recordTransition();
    if (step.frame) await this.#renderFrame(validateFrame(step.frame, this.#profile));
    if (step.subscriptions) await this.#syncSubscriptions(step.subscriptions);
    if (step.commands) await this.#runCommand(step.commands);
  }

  async #renderFrame(frame: NativeFrameV1): Promise<void> {
    assertFrameAssets(frame, new Map(this.#input.artifact.resources.assets.map((definition) => [definition.id, definition.accessibleName])));
    this.#latestFrame = structuredClone(frame);
    const handlerIds = collectFrameHandlerIds(frame);
    const requestId = ++this.#rendererRequestId;
    const rendered = new Promise<void>((resolve, reject) => {
      const generation = this.#generation;
      const timeout = setTimeout(() => { this.#retireRendererRequest(requestId); reject(this.#rendererFailure("Renderer operation timed out", "timeout")); }, this.#profile.rpcTimeoutMs);
      this.#rendererPending.set(requestId, { generation, resolve, reject, timeout });
    });
    this.#rendererPort?.postMessage({ version: 1, kind: "render", requestId, frame });
    await rendered;
    if (this.#iframe?.hidden) {
      this.#iframe.hidden = false;
      // Keep the initialized iframe attached: removing and re-appending a
      // srcdoc iframe reloads it and discards the frame we just rendered.
      for (const child of Array.from(this.#input.container.childNodes)) {
        if (child !== this.#iframe) child.remove();
      }
    }
    const queuedHandlerIds = new Set(this.#queue.flatMap((queued) => queued.handlerIds));
    const removed = [...this.#frameHandlerIds].filter((id) => !handlerIds.has(id) && !queuedHandlerIds.has(id));
    const deferred = [...this.#frameHandlerIds].filter((id) => !handlerIds.has(id) && queuedHandlerIds.has(id));
    this.#frameHandlerIds = new Set([...handlerIds, ...deferred]);
    await this.#releaseHandlers(removed);
  }

  async #runCommand(raw: unknown): Promise<void> {
    type Effect = { kind: "message"; value: unknown; mapHandlerIds: number[]; ownedHandlerIds: number[] } | { kind: "delay"; value: unknown; ms: number; mapHandlerIds: number[]; ownedHandlerIds: number[] } | { kind: "share"; value: string; ownedHandlerIds: number[] } | { kind: "none"; ownedHandlerIds: number[] };
    const effects: Effect[] = [];
    const visit = (value: unknown, mapHandlerIds: number[] = [], ownedHandlerIds: number[] = []): void => {
      const command = value as Record<string, unknown>;
      if (command.kind === "batch") { for (const child of command.children as unknown[]) visit(child, mapHandlerIds, ownedHandlerIds); return; }
      if (command.kind === "map") {
        const owned = Array.isArray(command.__vxOwnedMapHandlerIds) ? command.__vxOwnedMapHandlerIds as number[] : [];
        visit(command.child, [...mapHandlerIds, Number(command.handlerId)], [...ownedHandlerIds, ...owned]);
        return;
      }
      if (command.kind === "message") effects.push({ kind: "message", value: command.value, mapHandlerIds, ownedHandlerIds });
      else if (command.kind === "delay") effects.push({ kind: "delay", value: command.value, ms: Number(command.ms), mapHandlerIds, ownedHandlerIds });
      else if (command.kind === "native_share_state") effects.push({ kind: "share", value: String(command.value), ownedHandlerIds });
      else effects.push({ kind: "none", ownedHandlerIds });
    };
    visit(raw);
    const generation = this.#generation;
    const delayCount = effects.reduce((count, effect) => count + (effect.kind === "delay" ? 1 : 0), 0);
    assertOutstandingDelayCapacity(this.#commandTimers.size, delayCount, this.#profile);
    const mappedMessages = new Map<Effect, unknown>();
    for (const effect of effects) {
      if (effect.kind === "none" || effect.kind === "share") continue;
      const message = mapRuntimeMessage({ kind: "msgpack", value: effect.value }, effect.mapHandlerIds);
      validateBoundaryValue(message, this.#profile.maxBoundaryBytes, "command message", this.#profile);
      mappedMessages.set(effect, message);
    }
    const immediateCount = effects.reduce((count, effect) => count + (effect.kind === "message" ? 1 : 0), 0);
    if (this.#queue.length + immediateCount > this.#profile.maxQueue) {
      throw new TessylNativeError({ code: "resource_limit", phase: "run", message: "Command message queue limit exceeded", recoverable: true });
    }
    for (const effect of effects) for (const id of new Set(effect.ownedHandlerIds)) this.#commandHandlerRefs.set(id, (this.#commandHandlerRefs.get(id) ?? 0) + 1);
    for (const effect of effects) {
      if (generation !== this.#generation || this.#status === "failed" || this.#status === "disposed") return;
      if (effect.kind === "none") { await this.#finishCommandHandlers(effect.ownedHandlerIds); continue; }
      if (effect.kind === "share") {
        this.#shareableState = boundedShareableState(effect.value);
        try { this.#config.runtime?.onShareableStateChange?.(this.#shareableState); } catch { /* Share adapters are observational. */ }
        await this.#finishCommandHandlers(effect.ownedHandlerIds);
        continue;
      }
      const message = mappedMessages.get(effect);
      if (effect.kind === "message") {
        if (!this.#enqueue(message, effect.ownedHandlerIds)) return;
      }
      else {
        const timer = setTimeout(() => {
          this.#commandTimers.delete(timer);
          this.#enqueue(message, effect.ownedHandlerIds);
        }, effect.ms);
        this.#commandTimers.set(timer, effect.ownedHandlerIds);
      }
    }
  }

  async #finishCommandHandlers(ids: number[]): Promise<void> {
    const releasable: number[] = [];
    for (const id of new Set(ids)) {
      const next = (this.#commandHandlerRefs.get(id) ?? 1) - 1;
      if (next <= 0) { this.#commandHandlerRefs.delete(id); releasable.push(id); }
      else this.#commandHandlerRefs.set(id, next);
    }
    await this.#releaseHandlers(releasable);
  }

  async #syncSubscriptions(raw: unknown): Promise<void> {
    const next = flattenSubscriptions(raw);
    const nextIds = new Set(next.map((item) => item.identity));
    const release: number[] = [];
    for (const [identity, current] of this.#subscriptions) {
      if (nextIds.has(identity)) continue;
      current.cancel(); this.#purgeQueuedSimulation(`subscription:${identity}`); this.#subscriptions.delete(identity); release.push(...current.ownedHandlerIds);
    }
    for (const item of next) {
      const current = this.#subscriptions.get(item.identity);
      if (current) {
        release.push(...current.ownedHandlerIds.filter((id) => !item.ownedHandlerIds.includes(id)));
        current.mapHandlerIds = item.mapHandlerIds;
        current.ownedHandlerIds = item.ownedHandlerIds;
        continue;
      }
      const record: ActiveSubscription = { kind: item.kind, mapHandlerIds: item.mapHandlerIds, ownedHandlerIds: item.ownedHandlerIds, cancel: () => undefined };
      if (item.kind === "animation_frame") {
        let previous = performance.now();
        let animation: number | undefined;
        const media = matchMedia("(prefers-reduced-motion: reduce)");
        let reduced: boolean | undefined;
        const tick = (now: number): void => {
          if (!this.#active || this.#status === "failed" || this.#status === "disposed") return;
          if (now - previous + 0.1 < 1_000 / this.#profile.maxAnimationUpdatesPerSecond) { animation = requestAnimationFrame(tick); return; }
          const delta = Math.min(Math.max(now - previous, 0), 100);
          const elapsed = Math.max(0, now - this.#animationGenerationStartedAt);
          const base = { kind: "subscription", subscriptionKind: "animation_frame", key: item.key, payload: { elapsed_ms: elapsed, delta_ms: delta, reduced_motion: false } };
          previous = now; animation = requestAnimationFrame(tick); this.#enqueue(mapRuntimeMessage(base, record.mapHandlerIds), [], `subscription:${item.identity}`, record.mapHandlerIds, `subscription:${item.identity}`);
        };
        const updateMotion = (): void => {
          const nextReduced = media.matches;
          if (nextReduced === reduced) return;
          reduced = nextReduced;
          if (nextReduced) {
            if (animation !== undefined) cancelAnimationFrame(animation);
            animation = undefined;
            const elapsed = Math.max(0, performance.now() - this.#animationGenerationStartedAt);
            const base = { kind: "subscription", subscriptionKind: "animation_frame", key: item.key, payload: { elapsed_ms: elapsed, delta_ms: 0, reduced_motion: true } };
            this.#enqueue(mapRuntimeMessage(base, record.mapHandlerIds), [], `subscription:${item.identity}`, record.mapHandlerIds, `subscription:${item.identity}`);
          } else if (animation === undefined) {
            previous = performance.now();
            animation = requestAnimationFrame(tick);
          }
        };
        media.addEventListener("change", updateMotion);
        const motionPoll = setInterval(updateMotion, 100);
        updateMotion();
        record.cancel = () => { media.removeEventListener("change", updateMotion); clearInterval(motionPoll); if (animation !== undefined) cancelAnimationFrame(animation); };
      } else if (item.kind === "fixed_timestep") {
        const hz = Number(item.key);
        if (!Number.isInteger(hz) || hz < 1 || hz > this.#profile.maxAnimationUpdatesPerSecond) throw new TessylNativeError({ code: "protocol_violation", phase: "run", message: "Fixed timestep frequency is invalid", recoverable: true });
        const stepMs = 1_000 / hz;
        const media = matchMedia("(prefers-reduced-motion: reduce)");
        let previous = performance.now();
        let accumulator = 0;
        let simulatedElapsed = this.#fixedStepElapsed.get(item.identity) ?? 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let reduced: boolean | undefined;
        const purgeKey = `subscription:${item.identity}`;
        const schedule = (): void => { timer = setTimeout(tick, stepMs); };
        const tick = (): void => {
          timer = undefined;
          if (!this.#active || this.#status === "failed" || this.#status === "disposed") return;
          const now = performance.now();
          if (this.#queue.some((queued) => queued.purgeKey === purgeKey)) {
            previous = now; accumulator = 0; schedule(); return;
          }
          accumulator += Math.min(Math.max(now - previous, 0), 100);
          previous = now;
          const availableSteps = Math.floor(accumulator / stepMs);
          const steps = Math.min(availableSteps, this.#profile.maxSimulationStepsPerFrame);
          accumulator = availableSteps > this.#profile.maxSimulationStepsPerFrame ? accumulator % stepMs : accumulator - steps * stepMs;
          simulatedElapsed += steps * stepMs;
          this.#fixedStepElapsed.set(item.identity, simulatedElapsed);
          const base = { kind: "subscription", subscriptionKind: "fixed_timestep", key: item.key, payload: { elapsed_ms: simulatedElapsed, step_ms: stepMs, steps, alpha: accumulator / stepMs, reduced_motion: false } };
          schedule();
          this.#enqueue(mapRuntimeMessage(base, record.mapHandlerIds), [], undefined, record.mapHandlerIds, purgeKey, steps * stepMs);
        };
        const updateMotion = (): void => {
          const nextReduced = media.matches;
          if (nextReduced === reduced) return;
          reduced = nextReduced;
          if (nextReduced) {
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined; previous = performance.now(); accumulator = 0;
            simulatedElapsed = Math.max(0, simulatedElapsed - this.#purgeQueuedSimulation(purgeKey));
            this.#fixedStepElapsed.set(item.identity, simulatedElapsed);
            const base = { kind: "subscription", subscriptionKind: "fixed_timestep", key: item.key, payload: { elapsed_ms: simulatedElapsed, step_ms: stepMs, steps: 0, alpha: 0, reduced_motion: true } };
            this.#enqueue(mapRuntimeMessage(base, record.mapHandlerIds), [], undefined, record.mapHandlerIds, purgeKey);
          } else if (timer === undefined) {
            previous = performance.now();
            schedule();
          }
        };
        media.addEventListener("change", updateMotion);
        const motionPoll = setInterval(updateMotion, 100);
        updateMotion();
        record.cancel = () => {
          media.removeEventListener("change", updateMotion); clearInterval(motionPoll); if (timer !== undefined) clearTimeout(timer);
          simulatedElapsed = Math.max(0, simulatedElapsed - this.#purgeQueuedSimulation(purgeKey));
          this.#fixedStepElapsed.set(item.identity, simulatedElapsed);
        };
      } else if (item.kind === "reduced_motion") {
        const media = matchMedia("(prefers-reduced-motion: reduce)");
        let reduced: boolean | undefined;
        const emit = (): void => {
          if (media.matches === reduced) return;
          reduced = media.matches;
          const base = { kind: "subscription", subscriptionKind: "reduced_motion", key: item.key, payload: media.matches };
          this.#enqueue(mapRuntimeMessage(base, record.mapHandlerIds), [], `subscription:${item.identity}`, record.mapHandlerIds, `subscription:${item.identity}`);
        };
        media.addEventListener("change", emit);
        const motionPoll = setInterval(emit, 100);
        emit();
        record.cancel = () => { media.removeEventListener("change", emit); clearInterval(motionPoll); };
      } else if (item.kind === "container_size") {
        const observer = new ResizeObserver((entries) => {
          const box = entries[0]?.contentRect;
          if (!box || !this.#active) return;
          const base = { kind: "subscription", subscriptionKind: "container_size", key: item.key, payload: { width: box.width, height: box.height } };
          this.#enqueue(mapRuntimeMessage(base, record.mapHandlerIds), [], `subscription:${item.identity}`, record.mapHandlerIds, `subscription:${item.identity}`);
        });
        observer.observe(this.#input.container);
        record.cancel = () => observer.disconnect();
      } else if (item.kind.startsWith("native_input_")) {
        const definition = this.#input.artifact.resources.inputs.find((candidate) => candidate.name === item.key);
        const expectedType = item.kind.slice("native_input_".length);
        if (!definition || definition.type !== expectedType) throw new TessylNativeError({ code: "protocol_violation", phase: "run", message: `Input subscription is not declared: ${item.key.slice(0, 64)}`, recoverable: true });
        const value = this.#input.inputs?.[item.key] ?? definition.default;
        if (value !== undefined) {
          const base = { kind: "subscription", subscriptionKind: item.kind, key: item.key, payload: value };
          this.#enqueue(mapRuntimeMessage(base, record.mapHandlerIds), [], `subscription:${item.identity}`, record.mapHandlerIds, `subscription:${item.identity}`);
        }
      } else if (item.kind === "native_dataset_text") {
        const definition = this.#input.artifact.resources.datasets.find((candidate) => candidate.id === item.key);
        const bytes = this.#input.datasets?.[item.key];
        if (!definition || !bytes) throw new TessylNativeError({ code: "protocol_violation", phase: "run", message: `Dataset subscription is not declared or supplied: ${item.key.slice(0, 64)}`, recoverable: true });
        const payload = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const base = { kind: "subscription", subscriptionKind: item.kind, key: item.key, payload };
        this.#enqueue(mapRuntimeMessage(base, record.mapHandlerIds), [], `subscription:${item.identity}`, record.mapHandlerIds, `subscription:${item.identity}`);
      } else {
        const base = { kind: "subscription", subscriptionKind: "native_shareable_state", key: item.key, payload: this.#initialShareableState };
        this.#enqueue(mapRuntimeMessage(base, record.mapHandlerIds), [], `subscription:${item.identity}`, record.mapHandlerIds, `subscription:${item.identity}`);
      }
      this.#subscriptions.set(item.identity, record);
    }
    const stillOwned = new Set([...this.#subscriptions.values()].flatMap((subscription) => subscription.ownedHandlerIds));
    const queued = new Set(this.#queue.flatMap((item) => item.handlerIds));
    const immediate: number[] = [];
    for (const id of release.filter((candidate) => !stillOwned.has(candidate))) {
      if (queued.has(id) || this.#inFlightHandlerIds.has(id)) this.#deferredSubscriptionHandlerReleases.add(id);
      else immediate.push(id);
    }
    await this.#releaseHandlers(immediate);
  }

  async #flushDeferredSubscriptionHandlerReleases(): Promise<void> {
    if (!this.#deferredSubscriptionHandlerReleases.size) return;
    const protectedIds = new Set([
      ...this.#inFlightHandlerIds,
      ...this.#queue.flatMap((item) => item.handlerIds),
      ...[...this.#subscriptions.values()].flatMap((subscription) => [...subscription.mapHandlerIds, ...subscription.ownedHandlerIds]),
    ]);
    const releasable = [...this.#deferredSubscriptionHandlerReleases].filter((id) => !protectedIds.has(id));
    for (const id of releasable) this.#deferredSubscriptionHandlerReleases.delete(id);
    await this.#releaseHandlers(releasable);
  }

  #clearRuntimeEffects(): void {
    for (const timer of this.#commandTimers.keys()) clearTimeout(timer);
    this.#commandTimers.clear(); this.#commandHandlerRefs.clear();
    for (const subscription of this.#subscriptions.values()) subscription.cancel();
    this.#subscriptions.clear(); this.#frameHandlerIds.clear();
    this.#inFlightHandlerIds.clear(); this.#deferredSubscriptionHandlerReleases.clear();
  }

  async #releaseHandlers(ids: number[]): Promise<void> {
    const unique = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id >= 0);
    if (!unique.length || !this.#workerPort) return;
    await this.#request("release_handlers", unique);
  }

  #terminateGeneration(): void {
    this.#generation += 1;
    this.#workerReady && clearTimeout(this.#workerReady.timeout);
    this.#workerReady?.reject(new TessylNativeError({ code: "trap", phase: "run", message: "Runtime generation terminated", recoverable: true }));
    this.#workerReady = undefined;
    runtimeScheduler.cancel(this);
    this.#workerPort?.close(); this.#workerPort = undefined;
    this.#worker?.terminate(); this.#worker = undefined;
    this.#releaseWorkerSlot = undefined;
    for (const pending of this.#pending.values()) { clearTimeout(pending.timeout); pending.reject(new TessylNativeError({ code: "trap", phase: "run", message: "Runtime generation terminated", recoverable: true })); }
    this.#pending.clear(); this.#queue = []; this.#drainGeneration = undefined; this.#transitionTimes = [];
    for (const [requestId, pending] of this.#rendererPending) {
      clearTimeout(pending.timeout); pending.reject(this.#rendererFailure("Renderer generation terminated")); this.#retireRendererRequest(requestId);
    }
    this.#clearRuntimeEffects();
  }

  #retireRendererRequest(requestId: number): void {
    this.#rendererPending.delete(requestId);
    this.#retiredRendererRequests.add(requestId);
    while (this.#retiredRendererRequests.size > this.#profile.maxQueue * 4) this.#retiredRendererRequests.delete(this.#retiredRendererRequests.values().next().value!);
  }

  #disposeRenderer(): void {
    this.#rendererReady && clearTimeout(this.#rendererReady.timeout);
    this.#rendererReady?.reject(this.#rendererFailure("Renderer was disposed")); this.#rendererReady = undefined;
    for (const pending of this.#rendererPending.values()) { clearTimeout(pending.timeout); pending.reject(this.#rendererFailure("Renderer was disposed")); }
    this.#rendererPending.clear();
    this.#retiredRendererRequests.clear();
    this.#rendererPort?.postMessage({ version: 1, kind: "dispose" });
    this.#rendererPort?.close(); this.#rendererPort = undefined;
    this.#iframe?.remove(); this.#iframe = undefined;
  }

  #recordTransition(): void {
    const now = performance.now();
    this.#transitionTimes = this.#transitionTimes.filter((time) => now - time < 1_000);
    if (this.#transitionTimes.length >= this.#profile.maxTransitionsPerSecond) throw new TessylNativeError({ code: "resource_limit", phase: "run", message: "Transition rate limit exceeded", recoverable: true });
    this.#transitionTimes.push(now);
  }

  #recomputeActive(): void {
    if (this.#status === "disposed") return;
    const next = this.#requestedActive && this.#nearViewport && !this.#pageSuspended && document.visibilityState !== "hidden";
    if (this.#status === "failed") { this.#active = next; return; }
    if (next === this.#active) return;
    this.#active = next;
    if (!next) {
      if (this.#iframe) this.#iframe.inert = true;
      this.#terminateGeneration();
      this.#setStatus("paused");
    } else if (this.#status === "paused") void this.run().catch((error) => this.#fail(error));
  }

  #assertGeneration(generation: number): void {
    if (generation !== this.#generation || !this.#active || this.#status === "disposed") throw new TessylNativeError({ code: "trap", phase: "run", message: "Runtime generation is no longer active", recoverable: true });
  }

  #setStatus(status: TesseraStatus): void {
    this.#status = status;
    this.#shell.setStatus(status);
    try { this.#input.onStatusChange?.(status); } catch { /* Integration callbacks are observational. */ }
  }
  #fail(error: unknown): void {
    if (this.#status === "disposed" || this.#status === "failed" || (!this.#active && this.#status === "paused")) return;
    const code = error instanceof TessylNativeError ? error.code : "trap";
    this.#hostContainer.dataset.tessylNativeFailureCode = code;
    this.#terminateGeneration(); this.#disposeRenderer();
    this.#latestFrame = undefined;
    renderStaticFallback(this.#input.container, this.#input.artifact.fallback);
    this.#setStatus("failed");
    try { this.#config.telemetry?.record({ phase: "run", outcome: "failed", code, durationMs: Math.max(0, performance.now() - this.#runStartedAt), revision: this.#input.artifact.metadata.revision, ...(code === "resource_limit" ? { resourceBucket: "runtime" } : {}), capabilitySource: "author", restartCategory: "failure" }); } catch { /* Observability must not control lifecycle correctness. */ }
  }
  #protocolFailure(message: string): TessylNativeError { return new TessylNativeError({ code: "protocol_violation", phase: "run", message, recoverable: true }); }
  #rendererFailure(message: string, code: "protocol_violation" | "timeout" = "protocol_violation"): TessylNativeError { return new TessylNativeError({ code, phase: "run", message, recoverable: true }); }

  #inspectSource(): void {
    try {
      const decoded = JSON.parse(new TextDecoder().decode(this.#input.artifact.sourceBundle)) as { files?: Record<string, string> };
      const files = Object.freeze({ ...(decoded.files ?? {}) });
      this.#shell.showInspection("Tessera source", Object.entries(files).map(([label, text]) => ({ label, text })));
      this.#config.runtime?.onInspectSource?.(files, this.#input.artifact.metadata);
    } catch { /* A validated artifact remains usable if an inspection adapter fails. */ }
  }

  #inspectProvenance(): void {
    try {
      const artifact = this.#input.artifact;
      this.#shell.showInspection("Revision and provenance", [
        { label: "Revision", text: artifact.metadata.revision },
        { label: "Build", text: `${artifact.buildProvenance.builder} · ${artifact.manifest.capabilityProfile} · SDK ${artifact.manifest.sdkVersion}` },
        { label: "Content hashes", text: `source ${artifact.manifest.sourceHash}\nwasm ${artifact.manifest.wasmHash}\nfallback ${artifact.manifest.fallbackHash}` },
        { label: "Dependencies", text: artifact.dependencyLock.packages.map((item) => `${item.name}@${item.version} ${item.contentHash}`).join("\n") },
        { label: "Reviewed resources", text: [...artifact.resources.datasets.map((item) => `dataset ${item.id}@${item.revision} — ${item.citation}`), ...artifact.resources.assets.map((item) => `asset ${item.id}@${item.revision} — ${item.license}`)].join("\n") || "None" },
      ]);
      if (this.#config.runtime?.onInspectProvenance) {
        const copy = structuredClone(artifact);
        copy.wasm = artifact.wasm.slice();
        copy.sourceBundle = artifact.sourceBundle.slice();
        this.#config.runtime.onInspectProvenance(copy);
      }
    } catch { /* Inspection is observational. */ }
  }
}

const flattenSubscriptions = (raw: unknown): FlatSubscription[] => {
  const out: FlatSubscription[] = [];
  const visit = (value: unknown, mapHandlerIds: number[] = [], mapHandlerKeys: string[] = [], ownedHandlerIds: number[] = []): void => {
    const subscription = value as Record<string, unknown>;
    if (subscription.kind === "none") return;
    if (subscription.kind === "batch") { for (const child of subscription.children as unknown[]) visit(child, mapHandlerIds, mapHandlerKeys, ownedHandlerIds); return; }
    if (subscription.kind === "map") {
      const owned = Array.isArray(subscription.__vxOwnedMapHandlerIds) ? subscription.__vxOwnedMapHandlerIds as number[] : [];
      const handlerId = Number(subscription.handlerId);
      visit(subscription.child, [...mapHandlerIds, handlerId], [...mapHandlerKeys, String(subscription.handlerKey ?? `id:${handlerId}`)], [...ownedHandlerIds, ...owned]);
      return;
    }
    const kind = subscription.kind as SubscriptionKind;
    const key = String(subscription.key);
    out.push({ identity: `${kind}:${key}:${mapHandlerKeys.join("/")}`, kind, key, mapHandlerIds, ownedHandlerIds: [...new Set(ownedHandlerIds)] });
  };
  visit(raw);
  return out;
};

const mapRuntimeMessage = (message: unknown, handlerIds: readonly number[]): unknown => handlerIds.reduceRight<unknown>((child, handlerId) => ({ kind: "map", handlerId, message: child }), message);

const collectFrameHandlerIds = (frame: NativeFrameV1): Set<number> => {
  const ids = new Set<number>();
  const stack: NativeNode[] = [frame.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === "element") {
      for (const event of node.events ?? []) {
        if (event.handlerId !== undefined) ids.add(event.handlerId);
        for (const id of event.mapHandlerIds ?? []) ids.add(id);
      }
      stack.push(...(node.children ?? []));
    } else if (node.kind === "fragment") stack.push(...node.children);
  }
  return ids;
};

const disposed = (message = "Tessera instance is disposed"): TessylNativeError => new TessylNativeError({ code: "disposed", phase: "run", message });

const presentationHeight = (height: "compact" | "standard" | "tall" | undefined): string => ({ compact: "18rem", standard: "28rem", tall: "40rem" })[height ?? "standard"];

const boundedShareableState = (value: string): string => {
  if (typeof value !== "string") throw new TessylNativeError({ code: "invalid_artifact", phase: "initialize", message: "Shareable state must be a string" });
  if (new TextEncoder().encode(value).byteLength > 8_192) throw new TessylNativeError({ code: "resource_limit", phase: "initialize", message: "Shareable state exceeds 8192 bytes", recoverable: true });
  return value;
};

const assertFrameAssets = (frame: NativeFrameV1, declared: ReadonlyMap<string, string>): void => {
  const stack: NativeNode[] = [frame.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === "fragment") { stack.push(...node.children); continue; }
    if (node.kind !== "element") continue;
    const id = node.attrs?.["data-native-asset-id"];
    if (id !== undefined) {
      if (typeof id !== "string" || !declared.has(id)) throw new TessylNativeError({ code: "protocol_violation", phase: "run", message: "Frame requested an undeclared reviewed asset", recoverable: true });
      if (node.tag !== "img" || node.attrs?.["aria-label"] !== declared.get(id)) throw new TessylNativeError({ code: "protocol_violation", phase: "run", message: "Frame changed reviewed asset accessibility metadata", recoverable: true });
    }
    stack.push(...(node.children ?? []));
  }
};

const dataUrl = (bytes: Uint8Array, mediaType: string): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 16_384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384));
  return `data:${mediaType};base64,${btoa(binary)}`;
};

const cloneByteEntries = (entries: Readonly<Record<string, Uint8Array>>): Readonly<Record<string, Uint8Array>> => Object.freeze(Object.fromEntries(Object.entries(entries).map(([key, bytes]) => [key, bytes.slice()])));
