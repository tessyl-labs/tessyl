import type { NativeNode, NativeStaticFrameV1, TesseraArtifact, TesseraArtifactV2 } from "./types.js";
import { resourceProfile } from "./profiles.js";
import { validateStaticFrame } from "./protocol/validate.js";
import { validateArtifact } from "./build/artifact.js";

const SVG_TAGS = new Set(["svg", "g", "path", "line", "polyline", "polygon", "circle", "rect", "text"]);

export const staticFallbackStyles = `
[data-tessyl-fallback]{display:block;max-width:100%;color:CanvasText;font:16px/1.5 system-ui,sans-serif}
[data-tessyl-fallback] figure{margin:0}
[data-tessyl-fallback] [data-native-component="column"]{display:flex;flex-direction:column;gap:1rem}
[data-tessyl-fallback] [data-native-component="row"]{display:flex;align-items:stretch;gap:1rem}
[data-tessyl-fallback] [data-native-component="grid"]{display:grid;grid-template-columns:1fr;gap:1rem}
[data-tessyl-fallback] [data-native-columns="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}
[data-tessyl-fallback] [data-native-columns="3"]{grid-template-columns:repeat(3,minmax(0,1fr))}
[data-tessyl-fallback] [data-native-columns="4"]{grid-template-columns:repeat(4,minmax(0,1fr))}
[data-tessyl-fallback] [data-native-columns="5"]{grid-template-columns:repeat(5,minmax(0,1fr))}
[data-tessyl-fallback] [data-native-columns="6"]{grid-template-columns:repeat(6,minmax(0,1fr))}
[data-tessyl-fallback] [data-native-columns="7"]{grid-template-columns:repeat(7,minmax(0,1fr))}
[data-tessyl-fallback] [data-native-columns="8"]{grid-template-columns:repeat(8,minmax(0,1fr))}
[data-tessyl-fallback] [data-native-columns="9"]{grid-template-columns:repeat(9,minmax(0,1fr))}
[data-tessyl-fallback] [data-native-columns="10"]{grid-template-columns:repeat(10,minmax(0,1fr))}
[data-tessyl-fallback] [data-native-columns="11"]{grid-template-columns:repeat(11,minmax(0,1fr))}
[data-tessyl-fallback] [data-native-columns="12"]{grid-template-columns:repeat(12,minmax(0,1fr))}
[data-tessyl-fallback] [data-native-gap="none"]{gap:0}
[data-tessyl-fallback] [data-native-gap="xs"]{gap:.25rem}
[data-tessyl-fallback] [data-native-gap="sm"]{gap:.5rem}
[data-tessyl-fallback] [data-native-gap="lg"]{gap:1.5rem}
[data-tessyl-fallback] [data-native-gap="xl"]{gap:2rem}
[data-tessyl-fallback] [data-native-align="start"]{align-items:flex-start}
[data-tessyl-fallback] [data-native-align="center"]{align-items:center}
[data-tessyl-fallback] [data-native-align="end"]{align-items:flex-end}
[data-tessyl-fallback] [data-native-align="stretch"]{align-items:stretch}
[data-tessyl-fallback] [data-native-wrap="true"]{flex-wrap:wrap}
[data-tessyl-fallback] [data-native-width="fit"]{width:fit-content}
[data-tessyl-fallback] [data-native-width="fill"]{width:100%}
[data-tessyl-fallback] [data-native-width="content"]{width:100%;max-width:60rem;margin-inline:auto}
[data-tessyl-fallback] [data-native-width="visualization"]{width:100%;max-width:56rem;margin-inline:auto}
[data-tessyl-fallback] table{border-collapse:collapse;width:100%}
[data-tessyl-fallback] th,[data-tessyl-fallback] td{border:1px solid GrayText;padding:.4rem;text-align:left}
[data-tessyl-fallback] svg,[data-tessyl-fallback] canvas{display:block;width:100%;max-width:100%;height:auto;min-height:10rem;overflow:hidden}
[data-tessyl-fallback] [data-native-component="particle-snapshot"]{min-height:0;border-radius:.75rem;background:#f8fafc}
[data-tessyl-fallback] [data-native-component="particle-field"][data-native-tone="accent"] [data-native-component="particle-snapshot"]{background:radial-gradient(circle at 50% 48%,#134e4a 0,#0f2531 42%,#08131f 100%)}
[data-tessyl-fallback] [data-native-component="particle-snapshot"] circle{paint-order:stroke fill}
[data-tessyl-fallback] [data-native-component="particle-snapshot"] circle[data-native-tone="neutral"]{fill:#94a3b8;stroke:#94a3b8}
[data-tessyl-fallback] [data-native-component="particle-snapshot"] circle[data-native-tone="accent"]{fill:#67e8f9;stroke:#67e8f9}
[data-tessyl-fallback] [data-native-component="particle-snapshot"] circle[data-native-tone="informative"]{fill:#93c5fd;stroke:#93c5fd}
[data-tessyl-fallback] [data-native-component="particle-snapshot"] circle[data-native-tone="positive"]{fill:#5eead4;stroke:#5eead4}
[data-tessyl-fallback] [data-native-component="particle-snapshot"] circle[data-native-tone="caution"]{fill:#fde68a;stroke:#fde68a}
[data-tessyl-fallback] [data-native-component="particle-snapshot"] circle[data-native-tone="critical"]{fill:#fda4af;stroke:#fda4af}
[data-tessyl-fallback] [aria-label="Particle data"],[data-tessyl-fallback] [aria-label="Scene data"]{max-height:14rem;overflow:auto}
[data-tessyl-fallback] [data-native-component="particle-field"][data-native-caption-visible="false"] figcaption,[data-tessyl-fallback] [data-native-component="particle-field"][data-native-details-visible="false"]>[aria-label="Particle data"]{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
[data-tessyl-fallback] [data-native-component="static-value"]{display:flex;gap:.35rem}
@media(max-width:38rem){[data-tessyl-fallback] [data-native-component="grid"]{grid-template-columns:1fr}[data-tessyl-fallback] table{font-size:.875rem}}
`;

export const renderStaticFallback = (container: HTMLElement, frame: NativeStaticFrameV1): void => {
  const validated = validateStaticFrame(frame, resourceProfile("standard-v1"));
  const render = (node: NativeNode, inSvg = false): Node => {
    if (node.kind === "text") return document.createTextNode(node.value);
    if (node.kind === "fragment") {
      const fragment = document.createDocumentFragment();
      node.children.forEach((child) => fragment.append(render(child, inSvg)));
      return fragment;
    }
    if (typeof node.attrs?.["data-native-math-source"] === "string") return renderMathNode(node.attrs["data-native-math-source"], node.attrs["data-native-display"] === true);
    const useSvg = inSvg || SVG_TAGS.has(node.tag);
    const element = useSvg ? document.createElementNS("http://www.w3.org/2000/svg", node.tag) : document.createElement(node.tag);
    for (const [name, value] of Object.entries(node.attrs ?? {})) element.setAttribute(name === "viewbox" ? "viewBox" : name, String(value));
    (node.children ?? []).forEach((child) => element.append(render(child, useSvg)));
    return element;
  };
  container.dataset.tessylFallback = "";
  container.replaceChildren(render(validated.root));
};

export const renderStaticFallbackHtml = (frame: NativeStaticFrameV1): string => {
  const validated = validateStaticFrame(frame, resourceProfile("standard-v1"));
  return `<div data-tessyl-fallback>${serialize(validated.root)}</div>`;
};

export const renderValidatedStaticArtifactHtml = (artifact: TesseraArtifactV2, frame: NativeStaticFrameV1 = artifact.fallback): string => {
  const metadata = artifact.metadata;
  const paragraphs = [metadata.caption ?? metadata.purpose, metadata.unitsPolicy ? `Units policy: ${metadata.unitsPolicy}` : undefined, `Revision ${metadata.revision}`].filter((value): value is string => Boolean(value));
  const lists = [
    ["Instructions", metadata.instructions], ["Assumptions", metadata.assumptions], ["Limitations", metadata.limitations],
    ["Authors", metadata.authors], ["Reviewers", metadata.reviewers],
    ["Citations", metadata.citations?.map((citation) => [citation.title, citation.dataset, citation.license, citation.url].filter(Boolean).join(" — "))],
    ["Reviewed resources", [...artifact.resources.datasets.map((item) => `Dataset ${item.id}@${item.revision} — ${item.citation}`), ...artifact.resources.assets.map((item) => `Asset ${item.id}@${item.revision} — ${item.accessibleName} — ${item.license}`)]],
  ] as const;
  const details = `${paragraphs.map((value) => `<p>${escapeHtml(value)}</p>`).join("")}${lists.map(([title, values]) => values?.length ? `<section><h3>${escapeHtml(title)}</h3><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul></section>` : "").join("")}<p>Build: ${escapeHtml(artifact.buildProvenance.builder)} · ${escapeHtml(artifact.manifest.capabilityProfile)} · source ${escapeHtml(artifact.manifest.sourceHash)} · Wasm ${escapeHtml(artifact.manifest.wasmHash)}</p>`;
  return `<article aria-label="${escapeHtml(metadata.accessibleName)}">${renderStaticFallbackHtml(frame)}<footer aria-label="Tessera metadata and provenance">${details}</footer></article>`;
};

export const renderStaticArtifactHtml = async (artifact: TesseraArtifact): Promise<string> => {
  const validated = await validateArtifact(artifact);
  return renderValidatedStaticArtifactHtml(validated);
};

export const renderValidatedStaticArtifact = (container: HTMLElement, artifact: TesseraArtifactV2, frame: NativeStaticFrameV1 = artifact.fallback): void => {
  // Every value in this trusted serialization is validated and escaped above.
  container.innerHTML = renderValidatedStaticArtifactHtml(artifact, frame);
};

export const renderStaticArtifact = async (container: HTMLElement, artifact: TesseraArtifact): Promise<void> => {
  const validated = await validateArtifact(artifact);
  renderValidatedStaticArtifact(container, validated);
};

const serialize = (node: NativeNode): string => {
  if (node.kind === "text") return escapeHtml(node.value);
  if (node.kind === "fragment") return node.children.map(serialize).join("");
  if (typeof node.attrs?.["data-native-math-source"] === "string") return serializeMath(node.attrs["data-native-math-source"], node.attrs["data-native-display"] === true);
  const attrs = Object.entries(node.attrs ?? {}).map(([name, value]) => ` ${escapeHtml(name === "viewbox" ? "viewBox" : name)}="${escapeHtml(String(value))}"`).join("");
  return `<${node.tag}${attrs}>${(node.children ?? []).map(serialize).join("")}</${node.tag}>`;
};

const mathTokens = (source: string): string[] => source.match(/[A-Za-z]+|\d+(?:\.\d+)?|\S/g) ?? [];
const mathTokenTag = (token: string): "mi" | "mn" | "mo" => /^\d/.test(token) ? "mn" : /^[A-Za-z]/.test(token) ? "mi" : "mo";
const serializeMath = (source: string, display: boolean): string => `<math xmlns="http://www.w3.org/1998/Math/MathML" display="${display ? "block" : "inline"}" aria-label="${escapeHtml(source)}"><mrow>${mathTokens(source).map((token) => `<${mathTokenTag(token)}>${escapeHtml(token)}</${mathTokenTag(token)}>`).join("")}</mrow></math>`;
const renderMathNode = (source: string, display: boolean): MathMLElement => {
  const namespace = "http://www.w3.org/1998/Math/MathML";
  const math = document.createElementNS(namespace, "math");
  math.setAttribute("display", display ? "block" : "inline");
  math.setAttribute("aria-label", source);
  const row = document.createElementNS(namespace, "mrow");
  for (const token of mathTokens(source)) {
    const item = document.createElementNS(namespace, mathTokenTag(token));
    item.textContent = token;
    row.append(item);
  }
  math.append(row);
  return math;
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
