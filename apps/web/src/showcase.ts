import { createTessylNative, TessylNativeError, type TesseraArtifactV1, type TesseraInstance } from "@tessyl/native";
import "./style.css";

type SerializedArtifact = Omit<TesseraArtifactV1, "wasm" | "sourceBundle"> & {
  wasm: string;
  sourceBundle: string;
};

const native = createTessylNative({
  runtime: { onArticleLink: (slug) => { location.href = `/wiki/${encodeURIComponent(slug)}`; } },
});
const instances = new Map<string, TesseraInstance>();
const starting = new Set<string>();

const decode = (value: string): Uint8Array => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const loadArtifact = async (url: string): Promise<TesseraArtifactV1> => {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error("artifact unavailable");
  const artifact = await response.json() as SerializedArtifact;
  return { ...artifact, wasm: decode(artifact.wasm), sourceBundle: decode(artifact.sourceBundle) };
};

const statusNode = (id: string): HTMLElement | null => document.querySelector(`[data-tessera-status="${CSS.escape(id)}"]`);
const setStatus = (id: string, value: string): void => { const node = statusNode(id); if (node) node.textContent = value; };

const prepare = async (container: HTMLElement): Promise<TesseraInstance> => {
  const id = container.dataset.tesseraId!;
  const artifactUrl = container.dataset.artifact!;
  setStatus(id, "Validating static artifact");
  const instance = await native.initialize({
    artifact: await loadArtifact(artifactUrl),
    container,
    ...(id === "chart"
      ? { presentation: { height: "tall" as const } }
      : id === "simulation"
        ? { presentation: { expandedView: true } }
        : {}),
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
    if (entry.isIntersecting) {
      observer.unobserve(container);
      void start(container);
    }
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

window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  observer.disconnect();
  instances.forEach((instance) => instance.dispose());
  instances.clear();
});
