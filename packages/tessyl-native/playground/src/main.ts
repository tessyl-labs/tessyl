import {
  createTessylNative,
  TessylNativeError,
  type TesseraArtifactV2,
  type TesseraInstance,
  type TesseraPresentation,
} from "@tessyl/native";

type SerializedArtifact = Omit<TesseraArtifactV2, "wasm" | "sourceBundle"> & { wasm: string; sourceBundle: string };

const native = createTessylNative({
  runtime: {
    onArticleLink: (slug) => { console.info(`Tessera requested article navigation: ${slug}`); },
    onShareableStateChange: (state) => { document.documentElement.dataset.lastShareableState = state; },
  },
});
const instances = new Map<string, TesseraInstance>();
const starting = new Set<string>();
const encoder = new TextEncoder();
const chartResources = {
  datasets: { growth_scenarios: encoder.encode('{"periods":[0,1,2,3]}') },
  assets: { growth_badge: encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="#0f766e"/></svg>') },
  shareableState: "growth=1.2",
} as const;

const decode = (value: string): Uint8Array => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const loadArtifact = async (url: string): Promise<TesseraArtifactV2> => {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("artifact unavailable");
  const artifact = await response.json() as SerializedArtifact;
  return { ...artifact, wasm: decode(artifact.wasm), sourceBundle: decode(artifact.sourceBundle) };
};

const statusNode = (id: string): HTMLElement | null => document.querySelector(`[data-tessera-status="${CSS.escape(id)}"]`);
const setStatus = (id: string, value: string): void => { const node = statusNode(id); if (node) node.textContent = value; };

const presentationFor = (container: HTMLElement): TesseraPresentation | undefined => {
  if (container.dataset.expandedView === "true") return { expandedView: true };
  const height = container.dataset.presentationHeight;
  if (height === "compact" || height === "standard" || height === "tall") return { height };
  return undefined;
};

const prepare = async (container: HTMLElement): Promise<TesseraInstance> => {
  const id = container.dataset.tesseraId!;
  setStatus(id, "Validating static artifact");
  const presentation = presentationFor(container);
  const instance = await native.initialize({
    artifact: await loadArtifact(container.dataset.artifact!),
    container,
    ...(id === "calculator" ? { inputs: { currency_scale: 1.25 } } : {}),
    ...(id === "chart" ? chartResources : {}),
    ...(presentation ? { presentation } : {}),
    onStatusChange: (status) => setStatus(id, status === "failed" ? "Failed safely — use Reset to restart" : status),
  });
  instances.set(id, instance);
  return instance;
};

const start = async (container: HTMLElement): Promise<void> => {
  const id = container.dataset.tesseraId!;
  if (starting.has(id)) return;
  starting.add(id);
  try {
    const existing = instances.get(id);
    if (existing) await existing.reset();
    else await (await prepare(container)).run();
  } catch (error) {
    const code = error instanceof TessylNativeError ? error.code : "unknown";
    setStatus(id, `Interactive startup failed (${code}); static content remains available`);
  } finally {
    starting.delete(id);
  }
};

const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const container = entry.target as HTMLElement;
    if (!entry.isIntersecting) continue;
    observer.unobserve(container);
    void start(container);
  }
}, { rootMargin: "320px" });

document.querySelectorAll<HTMLElement>("[data-tessera-id]").forEach((container) => observer.observe(container));
document.querySelectorAll<HTMLButtonElement>("[data-tessera-reset]").forEach((button) => button.addEventListener("click", () => {
  const id = button.dataset.tesseraReset!;
  const instance = instances.get(id);
  if (instance) void instance.reset().catch(() => setStatus(id, "Restart failed safely"));
  else {
    const container = document.querySelector<HTMLElement>(`[data-tessera-id="${CSS.escape(id)}"]`);
    if (container) void start(container);
  }
}));
document.querySelectorAll<HTMLButtonElement>("[data-tessera-export]").forEach((button) => button.addEventListener("click", () => {
  const id = button.dataset.tesseraExport!;
  const output = document.querySelector<HTMLElement>(`[data-tessera-export-status="${CSS.escape(id)}"]`);
  void instances.get(id)?.exportResult().then(async (blob) => {
    if (!output) return;
    output.textContent = `Export ready: ${blob.type}, ${blob.size} bytes`;
    output.dataset.tesseraExportText = await blob.text();
  });
}));

window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  observer.disconnect();
  instances.forEach((instance) => instance.dispose());
  instances.clear();
});
