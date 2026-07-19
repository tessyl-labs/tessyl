import { defineAdapter } from "../generated/voyd-adapter.js";
import { DEFAULT_TFM_LIMITS, parse, renderHtml, type TfmNode, type TfmRenderResult } from "../src/index.js";

const MAX_VOYD_RESOURCES = 1_000;
const MAX_VOYD_DATASET_COLUMNS = 50;
const MAX_VOYD_DATASET_CELLS = 10_000;
const EMPTY_SPAN = { start: 0, end: 0, startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 } as const;

type VoydRenderResource = {
  kind: string;
  id: string;
  url: string;
  label: string;
  columns: readonly string[];
  cells: readonly string[];
};

const attribute = (node: TfmNode, name: string): string =>
  node.attributes.find((item) => item.name === name)?.value ?? "";

const requestedResourceKeys = (source: string): Set<string> => {
  const keys = new Set<string>();
  const add = (kind: string, id: string): void => {
    if (id) keys.add(`${kind}\u0000${id}`);
  };
  for (const node of parse(source).nodes) {
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
  return keys;
};

export const renderHtmlWithVoydResources = (
  source: string,
  resources: readonly VoydRenderResource[],
): TfmRenderResult => {
  const requested = requestedResourceKeys(source);
  const seen = new Set<string>();
  let remainingCells = MAX_VOYD_DATASET_CELLS;
  let truncatedDataset = false;
  const relevantResources = resources.filter((resource) => {
    const key = `${resource.kind}\u0000${resource.id}`;
    if (!requested.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_VOYD_RESOURCES);
  const rendered = renderHtml(source, { resources: relevantResources.map((resource) => {
    const base = {
      kind: resource.kind as "video" | "audio" | "transcript" | "app" | "dataset",
      id: resource.id,
      ...(resource.url ? { url: resource.url } : {}),
      ...(resource.label ? { label: resource.label } : {}),
    };
    if (resource.kind !== "dataset") return base;
    const columns = resource.columns.slice(0, Math.min(MAX_VOYD_DATASET_COLUMNS, remainingCells));
    const cellLimit = columns.length === 0 ? 0 : Math.min(resource.cells.length, remainingCells);
    const cells = resource.cells.slice(0, cellLimit);
    if (columns.length < resource.columns.length || cells.length < resource.cells.length) truncatedDataset = true;
    remainingCells -= cells.length;
    return {
      ...base,
      columns,
      rows: columns.length === 0 ? [] : Array.from(
        { length: Math.ceil(cells.length / columns.length) },
        (_, index) => cells.slice(index * columns.length, (index + 1) * columns.length),
      ),
    };
  }) });
  if (truncatedDataset && rendered.diagnostics.length < DEFAULT_TFM_LIMITS.maxDiagnostics) {
    rendered.diagnostics.push({
      code: "TFM_DATASET_LIMIT",
      severity: "warning",
      message: `Voyd resource datasets were truncated to the ${MAX_VOYD_DATASET_CELLS}-cell render budget.`,
      span: EMPTY_SPAN,
    });
  }
  return rendered;
};

export default defineAdapter({
  "tessyl:tfm/parser@1": {
    parse,
  },
  "tessyl:tfm/renderer@1": {
    render_html: renderHtml,
    render_html_with_resources: renderHtmlWithVoydResources,
  },
});

export { parse, renderHtml };
