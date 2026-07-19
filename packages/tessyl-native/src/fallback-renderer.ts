import type { NativeNode, NativeStaticFrameV1, TesseraArtifact, TesseraArtifactV2 } from "./types.js";
import { resourceProfile } from "./profiles.js";
import { validateStaticFrame } from "./protocol/validate.js";
import { validateArtifact } from "./build/artifact.js";

const SVG_TAGS = new Set(["svg", "g", "path", "line", "polyline", "polygon", "circle", "rect", "text"]);

export const staticFallbackStyles = `
[data-tessyl-fallback]{display:block;max-width:100%;color:CanvasText;font:16px/1.5 system-ui,sans-serif}
[data-tessyl-fallback] table{border-collapse:collapse;width:100%}
[data-tessyl-fallback] th,[data-tessyl-fallback] td{border:1px solid GrayText;padding:.4rem;text-align:left}
[data-tessyl-fallback] svg,[data-tessyl-fallback] canvas{display:block;width:100%;max-width:100%;height:auto;min-height:10rem;overflow:hidden}
[data-tessyl-fallback] [aria-label="Particle data"],[data-tessyl-fallback] [aria-label="Scene data"]{max-height:14rem;overflow:auto}
[data-tessyl-fallback] [data-native-component="static-value"]{display:flex;gap:.35rem}
@media(max-width:38rem){[data-tessyl-fallback] table{font-size:.875rem}}
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
