import { renderThemeCss } from "@tessyl/design-tokens";
import { parse } from "./parser.js";
import { TFM_RENDERER_CSS } from "./renderer-styles.js";
import {
  TFM_SCHEMA_VERSION,
  TFM_VOCABULARY_VERSION,
  type TfmDiagnostic,
  type TfmNode,
  type TfmParseOptions,
  type TfmParseResult,
  type TfmSpan,
} from "./types.js";

export type TfmResourceKind = "video" | "audio" | "transcript" | "app" | "dataset";

export type TfmResourceRequest = {
  kind: TfmResourceKind;
  id: string;
};

/**
 * Resources are supplied by the host after it has authorized the opaque TFM
 * identifier. All strings and URLs are still validated and escaped by the renderer.
 */
export type TfmResolvedResource = {
  url?: string;
  label?: string;
  columns?: readonly string[];
  rows?: readonly (readonly string[])[];
};

export type TfmProvidedResource = TfmResolvedResource & TfmResourceRequest;

export type TfmRenderOptions = TfmParseOptions & {
  /** A standalone document includes design tokens, renderer CSS, and a restrictive CSP. */
  format?: "document" | "fragment";
  title?: string;
  /** Markdown images are blocked by default to prevent requests chosen by untrusted authors. */
  imagePolicy?: "deny" | "same-origin" | "https";
  /** A serializable bundle of resources that the host has already authorized. */
  resources?: readonly TfmProvidedResource[];
  /** This callback is a host authorization boundary and must not trust opaque IDs by prefix alone. */
  resolveResource?: (request: TfmResourceRequest) => TfmResolvedResource | undefined;
};

export type TfmAsyncRenderOptions = Omit<TfmRenderOptions, "resolveResource"> & {
  resolveResource?: (request: TfmResourceRequest) => TfmResolvedResource | undefined | Promise<TfmResolvedResource | undefined>;
};

export type TfmRenderResult = {
  schemaVersion: typeof TFM_SCHEMA_VERSION;
  vocabularyVersion: typeof TFM_VOCABULARY_VERSION;
  success: boolean;
  html: string;
  contentSecurityPolicy: string;
  diagnostics: TfmDiagnostic[];
};

/** Minimal DOM-free shape accepted by the optional browser hydration helper. */
export type TfmHydrationRoot = {
  querySelectorAll(selectors: string): unknown;
};

const EMPTY_SPAN: TfmSpan = {
  start: 0,
  end: 0,
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
};

const URL_BASE = new URL("https://tfm.invalid/");
const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const RESOURCE_PROTOCOLS = new Set(["https:"]);
const MAX_RESOURCE_RESOLUTIONS = 256;
const RESOURCE_RESOLUTION_CONCURRENCY = 8;
const MAX_RESOURCE_BUNDLE_ENTRIES = 1_000;
const MAX_DATASET_COLUMNS = 50;
const MAX_DATASET_ROWS = 200;
const MAX_DATASET_CELLS = 10_000;
const SORT_SCRIPT_HASH = "sha256-bRKLrkp7aQcuBh3KjcWGNiLpLKPoUJnD9HhyRCtWv8U=";
const TFM_SORT_SCRIPT = `(()=>{for(const table of document.querySelectorAll('table[data-tfm-sortable="true"]')){const body=table.tBodies[0];if(!body)continue;for(const button of table.querySelectorAll('button[data-tfm-column]'))button.addEventListener('click',()=>{const column=Number(button.dataset.tfmColumn),heading=button.closest('th'),descending=heading?.getAttribute('aria-sort')==='ascending';for(const cell of table.querySelectorAll('th[aria-sort]'))cell.removeAttribute('aria-sort');heading?.setAttribute('aria-sort',descending?'descending':'ascending');const rows=Array.from(body.rows);rows.sort((left,right)=>{const a=left.cells[column]?.textContent?.trim()??'',b=right.cells[column]?.textContent?.trim()??'',an=Number(a),bn=Number(b),order=a!==''&&b!==''&&Number.isFinite(an)&&Number.isFinite(bn)?an-bn:a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});return descending?-order:order});body.append(...rows)})}})();`;
const hydratedSortButtons = new WeakMap<HTMLButtonElement, EventListener>();

const contentSecurityPolicy = (imagePolicy: TfmRenderOptions["imagePolicy"] = "deny"): string => [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  imagePolicy === "https" ? "img-src 'self' https:" : imagePolicy === "same-origin" ? "img-src 'self'" : "img-src 'none'",
  "media-src 'self' https:",
  "frame-src 'self' https:",
  `script-src '${SORT_SCRIPT_HASH}'`,
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join("; ");

export const TFM_CONTENT_SECURITY_POLICY = contentSecurityPolicy();

/** Activates package-owned sorting controls in a fragment render. */
export const hydrateTfm = (root: TfmHydrationRoot): (() => void) => {
  const domRoot = root as ParentNode;
  const cleanups: Array<() => void> = [];
  for (const table of domRoot.querySelectorAll<HTMLTableElement>('table[data-tfm-sortable="true"]')) {
    const body = table.tBodies[0];
    if (!body) continue;
    for (const button of table.querySelectorAll<HTMLButtonElement>("button[data-tfm-column]")) {
      if (hydratedSortButtons.has(button)) continue;
      const listener = (): void => {
        const column = Number(button.dataset.tfmColumn);
        const heading = button.closest("th");
        const descending = heading?.getAttribute("aria-sort") === "ascending";
        for (const cell of table.querySelectorAll("th[aria-sort]")) cell.removeAttribute("aria-sort");
        heading?.setAttribute("aria-sort", descending ? "descending" : "ascending");
        const rows = Array.from(body.rows);
        rows.sort((left, right) => compareTableCells(left, right, column, descending));
        body.append(...rows);
      };
      button.addEventListener("click", listener);
      hydratedSortButtons.set(button, listener);
      cleanups.push(() => {
        button.removeEventListener("click", listener);
        hydratedSortButtons.delete(button);
      });
    }
  }
  return () => cleanups.forEach((cleanup) => cleanup());
};

export const renderHtml = (source: string, options: TfmRenderOptions = {}): TfmRenderResult => {
  const parsed = parse(source, { limits: options.limits });
  return renderParsedHtml(parsed, options);
};

export const renderHtmlAsync = async (
  source: string,
  options: TfmAsyncRenderOptions = {},
): Promise<TfmRenderResult> => {
  const parsed = parse(source, { limits: options.limits });
  const { resolveResource, ...syncOptions } = options;
  if (!parsed.success || !resolveResource) return renderParsedHtml(parsed, syncOptions);
  const allRequests = collectResourceRequests(parsed);
  const requestedKeys = new Set(allRequests.map(({ kind, id }) => resourceKey(kind, id)));
  const provided = new Map<string, TfmProvidedResource>();
  let invalidProvidedResources = 0;
  for (const resource of (options.resources ?? []).slice(0, MAX_RESOURCE_BUNDLE_ENTRIES)) {
    if (!isResourceKind(resource.kind) || typeof resource.id !== "string" || resource.id.length > 256 || !isResolvedResource(resource)) {
      invalidProvidedResources += 1;
      continue;
    }
    const key = resourceKey(resource.kind, resource.id);
    if (requestedKeys.has(key) && !provided.has(key)) provided.set(key, resource);
  }
  const unresolvedRequests = allRequests.filter(({ kind, id }) => !provided.has(resourceKey(kind, id)));
  const requests = unresolvedRequests.slice(0, MAX_RESOURCE_RESOLUTIONS);
  const failures: TfmResourceRequest[] = [];
  const settled: Array<TfmProvidedResource | undefined> = Array(requests.length);
  let nextRequest = 0;
  const worker = async (): Promise<void> => {
    while (nextRequest < requests.length) {
      const index = nextRequest;
      nextRequest += 1;
      const request = requests[index]!;
      try {
        const resource = await resolveResource(request);
        settled[index] = resource ? { ...resource, ...request } : undefined;
      } catch {
        failures.push(request);
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(RESOURCE_RESOLUTION_CONCURRENCY, requests.length) },
    () => worker(),
  ));
  const resolved = new Map(settled.flatMap((resource) => resource
    ? [[resourceKey(resource.kind, resource.id), resource] as const]
    : []));
  const orderedResources = allRequests.flatMap(({ kind, id }) => {
    const key = resourceKey(kind, id);
    const resource = resolved.get(key) ?? provided.get(key);
    return resource ? [resource] : [];
  });
  const result = renderParsedHtml(parsed, { ...syncOptions, resources: orderedResources });
  if (invalidProvidedResources > 0 && result.diagnostics.length < parsed.limits.maxDiagnostics) {
    result.diagnostics.push({ code: "TFM_INVALID_RESOURCE", severity: "warning", message: `The provided resource bundle contained ${invalidProvidedResources} invalid entries.`, span: EMPTY_SPAN });
  }
  if ((options.resources?.length ?? 0) > MAX_RESOURCE_BUNDLE_ENTRIES && result.diagnostics.length < parsed.limits.maxDiagnostics) {
    result.diagnostics.push({ code: "TFM_RESOURCE_LIMIT", severity: "warning", message: `The provided resource bundle exceeded ${MAX_RESOURCE_BUNDLE_ENTRIES} entries and was truncated.`, span: EMPTY_SPAN });
  }
  for (const request of failures) {
    if (result.diagnostics.length >= parsed.limits.maxDiagnostics) break;
    result.diagnostics.push({ code: "TFM_RESOURCE_RESOLUTION", severity: "warning", message: `The ${request.kind} resource could not be resolved.`, span: EMPTY_SPAN });
  }
  if (unresolvedRequests.length > requests.length && result.diagnostics.length < parsed.limits.maxDiagnostics) {
    result.diagnostics.push({ code: "TFM_RESOURCE_LIMIT", severity: "warning", message: `Resource resolution was limited to ${MAX_RESOURCE_RESOLUTIONS} unique requests.`, span: EMPTY_SPAN });
  }
  return result;
};

const renderParsedHtml = (parsed: TfmParseResult, options: TfmRenderOptions): TfmRenderResult => {
  const policy = contentSecurityPolicy(options.imagePolicy);
  if (!parsed.success) return renderFailure(parsed, policy);

  const diagnostics = [...parsed.diagnostics];
  const renderer = new Renderer(parsed, options, diagnostics);
  const body = renderer.render();
  const success = diagnostics.every(({ severity }) => severity !== "error");
  if (!success) return renderResult(false, "", diagnostics, policy);

  const article = `<article class="tfm" data-tfm-schema="${TFM_SCHEMA_VERSION}" data-tfm-vocabulary="${TFM_VOCABULARY_VERSION}">${body}</article>`;
  const html = options.format === "fragment" ? article : renderDocument(article, options.title, policy);
  return renderResult(true, html, diagnostics, policy);
};

const renderFailure = (parsed: TfmParseResult, policy: string): TfmRenderResult =>
  renderResult(false, "", parsed.diagnostics, policy);

const renderResult = (
  success: boolean,
  html: string,
  diagnostics: TfmDiagnostic[],
  policy: string,
): TfmRenderResult => ({
  schemaVersion: TFM_SCHEMA_VERSION,
  vocabularyVersion: TFM_VOCABULARY_VERSION,
  success,
  html,
  contentSecurityPolicy: policy,
  diagnostics,
});

const renderDocument = (article: string, title = "TFM document", policy: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(policy)}">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${renderThemeCss(":root")}html{background:var(--ts-color-canvas);color:var(--ts-color-text-body);font-family:var(--ts-font-sans)}body{margin:0;padding:clamp(1rem,4vw,3rem)}${TFM_RENDERER_CSS}</style>
</head>
<body>${article}<script>${TFM_SORT_SCRIPT}</script></body>
</html>`;

class Renderer {
  readonly #definitions = new Map<string, TfmNode>();
  readonly #active = new Set<number>();
  readonly #resourceCache = new Map<string, TfmResolvedResource | undefined>();
  #diagnosticLimitReached = false;
  #remainingResourceCharacters = 1_000_000;
  #remainingDatasetCells = MAX_DATASET_CELLS;
  #remainingResourceResolutions = MAX_RESOURCE_RESOLUTIONS;

  constructor(
    private readonly parsed: TfmParseResult,
    private readonly options: TfmRenderOptions,
    private readonly diagnostics: TfmDiagnostic[],
  ) {
    for (const node of parsed.nodes) {
      if (node.kind === "definition" && node.identifier && !this.#definitions.has(node.identifier)) {
        this.#definitions.set(node.identifier, node);
      }
    }
    const resources = options.resources ?? [];
    if (resources.length > MAX_RESOURCE_BUNDLE_ENTRIES) this.warning("TFM_RESOURCE_LIMIT", `The provided resource bundle exceeded ${MAX_RESOURCE_BUNDLE_ENTRIES} entries and was truncated.`, EMPTY_SPAN);
    for (const resource of resources.slice(0, MAX_RESOURCE_BUNDLE_ENTRIES)) {
      if (!isResourceKind(resource.kind) || typeof resource.id !== "string" || resource.id.length > 256 || !isResolvedResource(resource)) {
        this.warning("TFM_INVALID_RESOURCE", "The provided resource bundle contains an invalid entry.", EMPTY_SPAN);
        continue;
      }
      const key = resourceKey(resource.kind, resource.id);
      if (!this.#resourceCache.has(key)) this.#resourceCache.set(key, resource);
    }
  }

  render(): string {
    if (!this.validIndex(this.parsed.root)) return "";
    return this.node(this.parsed.root);
  }

  private node(index: number): string {
    if (!this.validIndex(index)) return "";
    if (this.#active.has(index)) {
      this.error("TFM_RENDER_CYCLE", "The TFM node table contains a cycle.", this.parsed.nodes[index]?.span);
      return "";
    }
    this.#active.add(index);
    const node = this.parsed.nodes[index]!;
    const children = (): string => node.children.map((child) => this.node(child)).join("");
    let html: string;

    switch (node.kind) {
      case "root": html = children(); break;
      case "paragraph": html = `<p>${children()}</p>`; break;
      case "heading": html = `<h${clamp(node.depth, 1, 6)}>${children()}</h${clamp(node.depth, 1, 6)}>`; break;
      case "text": html = escapeHtml(node.text); break;
      case "emphasis": html = `<em>${children()}</em>`; break;
      case "strong": html = `<strong>${children()}</strong>`; break;
      case "strikethrough": html = `<del>${children()}</del>`; break;
      case "link": html = this.link(node, children()); break;
      case "image": html = this.image(node); break;
      case "list": html = this.list(node, children()); break;
      case "list-item": html = this.listItem(node, children()); break;
      case "block-quote": html = `<blockquote>${children()}</blockquote>`; break;
      case "code-block": html = this.codeBlock(node); break;
      case "inline-code": html = `<code>${escapeHtml(node.text)}</code>`; break;
      case "table": html = this.markdownTable(node); break;
      case "table-row": html = `<tr>${children()}</tr>`; break;
      case "table-cell": html = `<td>${children()}</td>`; break;
      case "break": html = "<br>\n"; break;
      case "thematic-break": html = "<hr>"; break;
      case "definition": html = ""; break;
      case "footnote-definition": html = `<section class="tfm-footnote" id="${footnoteId(node.identifier)}">${children()}</section>`; break;
      case "footnote-reference": html = `<sup><a href="#${footnoteId(node.identifier)}" aria-label="Footnote ${escapeAttribute(node.identifier)}">${escapeHtml(node.identifier)}</a></sup>`; break;
      case "tessyl-video": html = this.video(node, children()); break;
      case "tessyl-audio": html = this.audio(node, children()); break;
      case "tessyl-app": html = this.app(node, children()); break;
      case "tessyl-data-table": html = this.dataTable(node, children()); break;
      case "tessyl-aside": html = this.callout(node, children(), "aside"); break;
      case "tessyl-infobox": html = this.callout(node, children(), "infobox"); break;
      case "tessyl-columns": html = `<section class="tfm-columns">${children()}</section>`; break;
      case "tessyl-column": html = `<div class="tfm-column">${children()}</div>`; break;
      case "tessyl-card-grid": html = `<section class="tfm-card-grid" data-tfm-columns="${escapeAttribute(this.attribute(node, "columns") || "3")}">${children()}</section>`; break;
      case "tessyl-card": html = `<article class="tfm-directive tfm-card"><h3>${escapeHtml(this.attribute(node, "title"))}</h3>${children()}</article>`; break;
      case "invalid-directive":
      case "unsupported":
        this.error("TFM_UNRENDERABLE_NODE", `Node kind ${node.kind} cannot be rendered safely.`, node.span);
        html = "";
        break;
      default: {
        const unexpected: never = node.kind;
        this.error("TFM_UNRENDERABLE_NODE", `Unexpected node kind ${String(unexpected)} cannot be rendered safely.`, node.span);
        html = "";
      }
    }

    this.#active.delete(index);
    return html;
  }

  private link(node: TfmNode, label: string): string {
    const definition = node.identifier ? this.#definitions.get(node.identifier) : undefined;
    const rawUrl = node.url || definition?.url || "";
    const title = node.title || definition?.title || "";
    const url = safeUrl(rawUrl, LINK_PROTOCOLS, true);
    if (!url) {
      this.warning("TFM_UNSAFE_URL", "A link with a disallowed or malformed URL was rendered as text.", node.span);
      return `<span class="tfm-unsafe-link">${label}</span>`;
    }
    const external = isExternalUrl(url);
    return `<a href="${escapeAttribute(url)}"${title ? ` title="${escapeAttribute(title)}"` : ""}${external ? ' target="_blank" rel="nofollow noopener noreferrer ugc"' : ""}>${label}</a>`;
  }

  private image(node: TfmNode): string {
    const definition = node.identifier ? this.#definitions.get(node.identifier) : undefined;
    const rawUrl = node.url || definition?.url || "";
    const title = node.title || definition?.title || "";
    const policy = this.options.imagePolicy ?? "deny";
    const protocols = policy === "https" ? RESOURCE_PROTOCOLS : new Set<string>();
    const url = policy === "deny" ? undefined : safeUrl(rawUrl, protocols, true);
    if (!url || (policy === "same-origin" && isExternalUrl(url))) {
      this.warning("TFM_UNSAFE_IMAGE_URL", "A Markdown image URL was blocked by the renderer policy.", node.span);
      return `<span class="tfm-resource-placeholder" role="img" aria-label="${escapeAttribute(node.text || "Blocked image")}">${escapeHtml(node.text || "Image unavailable")}</span>`;
    }
    return `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(node.text)}"${title ? ` title="${escapeAttribute(title)}"` : ""} loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  }

  private list(node: TfmNode, content: string): string {
    if (!node.ordered) return `<ul>${content}</ul>`;
    const start = node.listStart > 0 && node.listStart !== 1 ? ` start="${node.listStart}"` : "";
    return `<ol${start}>${content}</ol>`;
  }

  private listItem(node: TfmNode, content: string): string {
    const task = node.task ? ` class="tfm-task"><input type="checkbox" disabled${node.checked ? " checked" : ""} aria-label="${node.checked ? "Completed" : "Not completed"}">` : ">";
    return `<li${task}${content}</li>`;
  }

  private codeBlock(node: TfmNode): string {
    const language = safeToken(node.language);
    return `<pre${language ? ` data-tfm-language="${escapeAttribute(language)}"` : ""}><code>${escapeHtml(node.text)}</code></pre>`;
  }

  private markdownTable(node: TfmNode): string {
    const [headIndex, ...bodyIndices] = node.children;
    if (headIndex === undefined) return "<table></table>";
    const head = this.tableRow(headIndex, true, node.alignments);
    const body = bodyIndices.map((index) => this.tableRow(index, false, node.alignments)).join("");
    return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  private tableRow(index: number, heading: boolean, alignments: readonly string[] = []): string {
    if (!this.validIndex(index)) return "";
    const row = this.parsed.nodes[index]!;
    if (row.kind !== "table-row") {
      this.error("TFM_INVALID_TABLE", "A table contains a non-row child.", row.span);
      return "";
    }
    const cells = row.children.map((cellIndex) => {
      if (!this.validIndex(cellIndex)) return "";
      const cell = this.parsed.nodes[cellIndex]!;
      if (cell.kind !== "table-cell") {
        this.error("TFM_INVALID_TABLE", "A table row contains a non-cell child.", cell.span);
        return "";
      }
      const column = row.children.indexOf(cellIndex);
      const alignment = alignments[column];
      const alignClass = alignment === "left" || alignment === "center" || alignment === "right" ? ` class="tfm-align-${alignment}"` : "";
      return `<${heading ? "th" : "td"}${heading ? ' scope="col"' : ""}${alignClass}>${cell.children.map((child) => this.node(child)).join("")}</${heading ? "th" : "td"}>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }

  private video(node: TfmNode, caption: string): string {
    const id = this.attribute(node, "asset");
    const resource = this.resolve("video", id, node.span);
    const url = this.resourceUrl(resource?.url, node.span);
    const controls = this.attribute(node, "controls") !== "false";
    const media = url
      ? `<video src="${escapeAttribute(url)}"${controls ? " controls" : ""} preload="metadata"></video>`
      : this.placeholder(resource?.label || "Video asset", id);
    return `<figure class="tfm-directive tfm-video">${media}${caption ? `<figcaption class="tfm-caption">${caption}</figcaption>` : ""}</figure>`;
  }

  private audio(node: TfmNode, caption: string): string {
    const id = this.attribute(node, "asset");
    const resource = this.resolve("audio", id, node.span);
    const url = this.resourceUrl(resource?.url, node.span);
    const controls = this.attribute(node, "controls") !== "false";
    const media = url
      ? `<audio src="${escapeAttribute(url)}"${controls ? " controls" : ""} preload="metadata"></audio>`
      : this.placeholder(resource?.label || "Audio asset", id);
    const transcriptId = this.attribute(node, "transcript");
    const transcript = transcriptId ? this.transcript(transcriptId, node.span) : "";
    return `<figure class="tfm-directive tfm-audio"><div class="tfm-directive__body">${media}${transcript}</div>${caption ? `<figcaption class="tfm-caption tfm-directive__body">${caption}</figcaption>` : ""}</figure>`;
  }

  private transcript(id: string, span: TfmSpan): string {
    const resource = this.resolve("transcript", id, span);
    const url = this.resourceUrl(resource?.url, span);
    const label = escapeHtml(this.boundedResourceText(resource?.label || "Read transcript"));
    return url
      ? `<p><a href="${escapeAttribute(url)}" target="_blank" rel="nofollow noopener noreferrer">${label}</a></p>`
      : `<p class="tfm-caption">${label} <span class="tfm-resource-id">${escapeHtml(id)}</span></p>`;
  }

  private app(node: TfmNode, caption: string): string {
    const id = this.attribute(node, "revision");
    const height = this.attribute(node, "height") || "standard";
    const resource = this.resolve("app", id, node.span);
    const url = this.resourceUrl(resource?.url, node.span);
    const label = this.boundedResourceText(resource?.label || "Interactive application");
    const app = url
      ? `<iframe class="tfm-app-frame" data-tfm-height="${escapeAttribute(height)}" src="${escapeAttribute(url)}" title="${escapeAttribute(label)}" sandbox="allow-scripts" loading="lazy" referrerpolicy="no-referrer"></iframe>`
      : this.placeholder(label, id);
    return `<figure class="tfm-directive tfm-app">${app}${caption ? `<figcaption class="tfm-caption tfm-directive__body">${caption}</figcaption>` : ""}</figure>`;
  }

  private dataTable(node: TfmNode, caption: string): string {
    const id = this.attribute(node, "dataset");
    const sortable = this.attribute(node, "sortable") !== "false";
    const resource = this.resolve("dataset", id, node.span);
    let content: string;
    if (isDatasetResource(resource)) {
      const columns = resource.columns.slice(0, Math.min(MAX_DATASET_COLUMNS, this.#remainingDatasetCells));
      const maximumRows = columns.length === 0 ? 0 : Math.min(MAX_DATASET_ROWS, Math.floor(this.#remainingDatasetCells / columns.length));
      const rows = resource.rows.slice(0, maximumRows);
      const invalid = columns.some((value) => typeof value !== "string") || rows.some((row) =>
        !Array.isArray(row) || row.slice(0, columns.length).some((value) => typeof value !== "string"));
      if (invalid) {
        this.warning("TFM_INVALID_RESOURCE", "The dataset resolver returned an invalid bounded table value.", node.span);
        return `<figure class="tfm-directive tfm-data-table"><div class="tfm-directive__body">${this.placeholder(resource.label || "Dataset", id)}</div></figure>`;
      }
      let truncated = resource.columns.length > columns.length || resource.rows.length > rows.length || rows.some((row) => row.length > MAX_DATASET_COLUMNS);
      const bounded = (value: string): string => {
        const maximum = Math.min(4_096, this.#remainingResourceCharacters);
        const output = value.slice(0, maximum);
        if (output.length < value.length) truncated = true;
        this.#remainingResourceCharacters -= output.length;
        return output;
      };
      this.#remainingDatasetCells -= columns.length * rows.length;
      const head = columns.map((value, index) => `<th scope="col">${sortable ? `<button type="button" class="tfm-sort-button" data-tfm-column="${index}">${escapeHtml(bounded(value))}</button>` : escapeHtml(bounded(value))}</th>`).join("");
      const body = rows.map((row) => `<tr>${columns.map((_, index) => `<td>${escapeHtml(bounded(row[index] ?? ""))}</td>`).join("")}</tr>`).join("");
      if (truncated) this.warning("TFM_DATASET_LIMIT", "The rendered dataset was truncated to safe table limits.", node.span);
      content = `<div class="tfm-dataset"><table data-tfm-sortable="${sortable}">${caption ? `<caption>${caption}</caption>` : ""}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    } else {
      content = this.placeholder(resource?.label || "Dataset", id);
    }
    return `<figure class="tfm-directive tfm-data-table"><div class="tfm-directive__body">${content}</div></figure>`;
  }

  private callout(node: TfmNode, content: string, kind: "aside" | "infobox"): string {
    const title = this.attribute(node, "title");
    const tone = this.attribute(node, "tone");
    const heading = title ? `<header class="tfm-directive__header"><strong>${escapeHtml(title)}</strong><span class="tfm-directive__kind">${kind}</span></header>` : "";
    return `<aside class="tfm-directive tfm-${kind}" data-tfm-tone="${escapeAttribute(tone)}">${heading}<div class="tfm-directive__body">${content}</div></aside>`;
  }

  private placeholder(label: string, id: string): string {
    return `<div class="tfm-resource-placeholder"><span>${escapeHtml(this.boundedResourceText(label))}<span class="tfm-resource-id">${escapeHtml(id)}</span></span></div>`;
  }

  private resolve(kind: TfmResourceKind, id: string, span: TfmSpan): TfmResolvedResource | undefined {
    const key = resourceKey(kind, id);
    if (this.#resourceCache.has(key)) return this.#resourceCache.get(key);
    if (!this.options.resolveResource) {
      this.#resourceCache.set(key, undefined);
      return undefined;
    }
    if (this.#remainingResourceResolutions <= 0) {
      this.warning("TFM_RESOURCE_LIMIT", `Resource resolution was limited to ${MAX_RESOURCE_RESOLUTIONS} unique requests.`, span);
      this.#resourceCache.set(key, undefined);
      return undefined;
    }
    this.#remainingResourceResolutions -= 1;
    try {
      const resource = this.options.resolveResource({ kind, id });
      if (!isResolvedResource(resource)) {
        if (resource !== undefined) this.warning("TFM_INVALID_RESOURCE", `The ${kind} resolver returned an invalid resource.`, span);
        this.#resourceCache.set(key, undefined);
        return undefined;
      }
      this.#resourceCache.set(key, resource);
      return resource;
    } catch {
      this.warning("TFM_RESOURCE_RESOLUTION", `The ${kind} resource could not be resolved.`, span);
      this.#resourceCache.set(key, undefined);
      return undefined;
    }
  }

  private resourceUrl(value: string | undefined, span: TfmSpan): string | undefined {
    if (!value) return undefined;
    if (value.length > 8_192 || value.length > this.#remainingResourceCharacters) {
      this.warning("TFM_RESOURCE_LIMIT", "A resource URL exceeded the renderer limit.", span);
      return undefined;
    }
    const url = safeUrl(value, RESOURCE_PROTOCOLS, true);
    if (!url) this.warning("TFM_UNSAFE_RESOURCE_URL", "A resource URL was blocked by the renderer policy.", span);
    else this.#remainingResourceCharacters -= value.length;
    return url;
  }

  private attribute(node: TfmNode, name: string): string {
    return node.attributes.find((attribute) => attribute.name === name)?.value ?? "";
  }

  private boundedResourceText(value: string): string {
    const maximum = Math.min(4_096, this.#remainingResourceCharacters);
    const output = value.slice(0, maximum);
    this.#remainingResourceCharacters -= output.length;
    return output;
  }

  private validIndex(index: number): boolean {
    if (Number.isSafeInteger(index) && index >= 0 && index < this.parsed.nodes.length) return true;
    this.error("TFM_INVALID_NODE_INDEX", "The TFM node table contains an invalid child index.", EMPTY_SPAN);
    return false;
  }

  private warning(code: string, message: string, span: TfmSpan): void {
    this.diagnostic({ code, severity: "warning", message, span });
  }

  private error(code: string, message: string, span = EMPTY_SPAN): void {
    this.diagnostic({ code, severity: "error", message, span });
  }

  private diagnostic(diagnostic: TfmDiagnostic): void {
    if (this.#diagnosticLimitReached) return;
    if (this.diagnostics.length < this.parsed.limits.maxDiagnostics) {
      this.diagnostics.push(diagnostic);
      return;
    }
    this.#diagnosticLimitReached = true;
    this.diagnostics[this.diagnostics.length - 1] = {
      code: "TFM_DIAGNOSTIC_LIMIT",
      severity: "error",
      message: `Further diagnostics were suppressed after reaching the limit of ${this.parsed.limits.maxDiagnostics}.`,
      span: EMPTY_SPAN,
    };
  }
}

const safeUrl = (
  raw: string,
  allowedProtocols: ReadonlySet<string>,
  allowRelative: boolean,
): string | undefined => {
  if (!raw || raw !== raw.trim() || /[\u0000-\u001f\u007f]/.test(raw)) return undefined;
  try {
    const parsed = new URL(raw, URL_BASE);
    const explicitProtocol = /^[A-Za-z][A-Za-z\d+.-]*:/.test(raw);
    if (!explicitProtocol) {
      if (!allowRelative || parsed.origin !== URL_BASE.origin || raw.startsWith("\\")) return undefined;
      return raw;
    }
    return allowedProtocols.has(parsed.protocol) ? raw : undefined;
  } catch {
    return undefined;
  }
};

const isExternalUrl = (url: string): boolean => {
  try {
    return new URL(url, URL_BASE).origin !== URL_BASE.origin;
  } catch {
    return false;
  }
};

const collectResourceRequests = (parsed: TfmParseResult): TfmResourceRequest[] => {
  const requests = new Map<string, TfmResourceRequest>();
  const add = (kind: TfmResourceKind, id: string): void => {
    if (!id) return;
    const request = { kind, id };
    requests.set(resourceKey(kind, id), request);
  };
  const attribute = (node: TfmNode, name: string): string =>
    node.attributes.find((item) => item.name === name)?.value ?? "";
  for (const node of parsed.nodes) {
    switch (node.kind) {
      case "tessyl-video": add("video", attribute(node, "asset")); break;
      case "tessyl-audio":
        add("audio", attribute(node, "asset"));
        add("transcript", attribute(node, "transcript"));
        break;
      case "tessyl-app": add("app", attribute(node, "revision")); break;
      case "tessyl-data-table": add("dataset", attribute(node, "dataset")); break;
    }
  }
  return [...requests.values()];
};

const resourceKey = (kind: TfmResourceKind, id: string): string => `${kind}\u0000${id}`;
const isResourceKind = (value: unknown): value is TfmResourceKind =>
  value === "video" || value === "audio" || value === "transcript" || value === "app" || value === "dataset";

const isResolvedResource = (value: unknown): value is TfmResolvedResource => {
  if (value === undefined) return false;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const resource = value as TfmResolvedResource;
  const allowed = new Set(["kind", "id", "url", "label", "columns", "rows"]);
  if (Object.keys(resource).some((key) => !allowed.has(key))) return false;
  if (resource.url !== undefined && typeof resource.url !== "string") return false;
  if (resource.label !== undefined && typeof resource.label !== "string") return false;
  // Dataset members are validated incrementally over the bounded slice that can
  // actually be rendered. Traversing an entire host-provided dataset here would
  // let an oversized resource bypass the renderer's CPU budget.
  if (resource.columns !== undefined && !Array.isArray(resource.columns)) return false;
  if (resource.rows !== undefined && !Array.isArray(resource.rows)) return false;
  return true;
};

const isDatasetResource = (value: TfmResolvedResource | undefined): value is TfmResolvedResource & {
  columns: readonly string[];
  rows: readonly (readonly string[])[];
} => Array.isArray(value?.columns) && Array.isArray(value?.rows);

const footnoteId = (identifier: string): string => {
  let encoded = "";
  for (let index = 0; index < identifier.length; index += 1) {
    encoded += identifier.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return `tfm-footnote-${encoded || "empty"}`;
};

const compareTableCells = (
  left: HTMLTableRowElement,
  right: HTMLTableRowElement,
  column: number,
  descending: boolean,
): number => {
  const a = left.cells[column]?.textContent?.trim() ?? "";
  const b = right.cells[column]?.textContent?.trim() ?? "";
  const aNumber = Number(a);
  const bNumber = Number(b);
  const order = a !== "" && b !== "" && Number.isFinite(aNumber) && Number.isFinite(bNumber)
    ? aNumber - bNumber
    : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return descending ? -order : order;
};

const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;");

const escapeAttribute = (value: string): string => escapeHtml(value)
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const safeToken = (value: string): string => /^[A-Za-z0-9_.+-]{1,64}$/.test(value) ? value : "";
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, Number.isSafeInteger(value) ? value : minimum));
