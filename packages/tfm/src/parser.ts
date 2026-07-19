import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { DIRECTIVE_SPECS, isDirectiveName, validateAttributes } from "./schema.js";
import { validateDirectiveSyntax } from "./preflight.js";
import {
  DEFAULT_TFM_LIMITS,
  TFM_SCHEMA_VERSION,
  TFM_VOCABULARY_VERSION,
  type TfmDiagnostic,
  type TfmLimits,
  type TfmNode,
  type TfmNodeKind,
  type TfmParseOptions,
  type TfmParseResult,
  type TfmSpan,
} from "./types.js";

type Point = { line?: number; column?: number; offset?: number };
type Position = { start?: Point; end?: Point };
type MdNode = {
  type: string;
  children?: MdNode[];
  value?: string;
  depth?: number;
  ordered?: boolean | null;
  checked?: boolean | null;
  start?: number | null;
  alt?: string | null;
  url?: string;
  title?: string | null;
  lang?: string | null;
  name?: string;
  attributes?: Record<string, string | null> | null;
  identifier?: string;
  label?: string | null;
  align?: Array<"left" | "right" | "center" | null>;
  position?: Position;
};

const EMPTY_SPAN: TfmSpan = {
  start: 0,
  end: 0,
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 1,
};

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);

export const parse = (source: string, options: TfmParseOptions = {}): TfmParseResult => {
  const limits = effectiveLimits(options.limits);
  const diagnostics = new DiagnosticCollector(limits.maxDiagnostics);
  if (source.length > limits.maxSourceBytes) {
    const span = { ...EMPTY_SPAN };
    diagnostics.add({
      code: "TFM_SOURCE_LIMIT",
      severity: "error",
      message: `TFM source exceeds the ${limits.maxSourceBytes} byte limit.`,
      span,
    });
    return result([emptyNode("root", span)], diagnostics.finish(), limits);
  }
  const sourceBytes = new TextEncoder().encode(source).byteLength;
  if (sourceBytes > limits.maxSourceBytes) {
    const span = sourceSpan(source);
    diagnostics.add({
      code: "TFM_SOURCE_LIMIT",
      severity: "error",
      message: `TFM source is ${sourceBytes} bytes; the limit is ${limits.maxSourceBytes}.`,
      span,
    });
    return result([emptyNode("root", span)], diagnostics.finish(), limits);
  }

  let root: MdNode;
  try {
    root = processor.parse(source) as MdNode;
  } catch {
    diagnostics.add({
      code: "TFM_PARSE_ERROR",
      severity: "error",
      message: "The Markdown source could not be parsed.",
      span: sourceSpan(source),
    });
    return result([emptyNode("root", sourceSpan(source))], diagnostics.finish(), limits);
  }

  validateDirectiveSyntax(source, root, limits, (diagnostic) => diagnostics.add(diagnostic));

  const measured = measureTree(root, limits);
  if (measured.depthExceeded) {
    diagnostics.add({
      code: "TFM_NESTING_LIMIT",
      severity: "error",
      message: `TFM nesting exceeds ${limits.maxNestingDepth} levels.`,
      span: spanOf(measured.offender),
    });
  }
  if (measured.countExceeded) {
    diagnostics.add({
      code: "TFM_NODE_LIMIT",
      severity: "error",
      message: `TFM document exceeds ${limits.maxNodeCount} nodes.`,
      span: spanOf(measured.offender),
    });
  }
  if (measured.depthExceeded || measured.countExceeded) {
    return result([emptyNode("root", spanOf(root))], diagnostics.finish(), limits);
  }

  const nodes = flatten(root, source, limits, diagnostics);
  return result(nodes, diagnostics.finish(), limits);
};

const result = (
  nodes: TfmNode[],
  diagnostics: TfmDiagnostic[],
  limits: TfmLimits,
): TfmParseResult => ({
  schemaVersion: TFM_SCHEMA_VERSION,
  vocabularyVersion: TFM_VOCABULARY_VERSION,
  success: diagnostics.every(({ severity }) => severity !== "error"),
  root: 0,
  nodes,
  diagnostics,
  limits,
});

const effectiveLimits = (requested: Partial<TfmLimits> | undefined): TfmLimits => {
  const bounded = <K extends keyof TfmLimits>(key: K): number => {
    const fallback = DEFAULT_TFM_LIMITS[key];
    const value = requested?.[key];
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? Math.min(value, fallback)
      : fallback;
  };
  return {
    maxSourceBytes: bounded("maxSourceBytes"),
    maxNestingDepth: bounded("maxNestingDepth"),
    maxNodeCount: bounded("maxNodeCount"),
    maxAttributeCount: bounded("maxAttributeCount"),
    maxAttributeLength: bounded("maxAttributeLength"),
    maxDiagnostics: bounded("maxDiagnostics"),
  };
};

const measureTree = (root: MdNode, limits: TfmLimits): {
  countExceeded: boolean;
  depthExceeded: boolean;
  offender: MdNode;
} => {
  const pending: Array<{ node: MdNode; depth: number }> = [{ node: root, depth: 1 }];
  let count = 0;
  let offender = root;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    count += 1;
    offender = current.node;
    if (count > limits.maxNodeCount) {
      return { countExceeded: true, depthExceeded: false, offender };
    }
    if (current.depth > limits.maxNestingDepth) {
      return { countExceeded: false, depthExceeded: true, offender };
    }
    for (const child of current.node.children ?? []) {
      pending.push({ node: child, depth: current.depth + 1 });
    }
  }
  return { countExceeded: false, depthExceeded: false, offender };
};

const flatten = (
  root: MdNode,
  source: string,
  limits: TfmLimits,
  diagnostics: DiagnosticCollector,
): TfmNode[] => {
  const output: TfmNode[] = [];
  const definitionIdentifiers = collectDefinitionIdentifiers(root);

  const visit = (node: MdNode, parentDirective: string | undefined): number => {
    const index = output.length;
    output.push(emptyNode("unsupported", spanOf(node)));
    const directive = directiveInfo(node);
    const nextParent = directive?.valid ? directive.name : parentDirective;
    const unresolvedReference = (node.type === "linkReference" || node.type === "imageReference") &&
      !definitionIdentifiers.has(normalizeIdentifier(node.identifier ?? node.label ?? ""));
    const retainChildren = (directive === undefined || directive.valid) && !unresolvedReference;
    const children = retainChildren
      ? (node.children ?? []).map((child) => visit(child, nextParent))
      : [];
    if (directive && !directive.valid) {
      for (const child of node.children ?? []) {
        inspectDiscarded(child, parentDirective);
      }
    }
    output[index] = convertNode(
      node,
      children,
      parentDirective,
      source,
      limits,
      diagnostics,
      definitionIdentifiers,
    );
    return index;
  };

  const inspectDiscarded = (node: MdNode, parentDirective: string | undefined): void => {
    const directive = directiveInfo(node);
    const nextParent = directive?.valid ? directive.name : parentDirective;
    convertNode(node, [], parentDirective, source, limits, diagnostics, definitionIdentifiers);
    for (const child of node.children ?? []) inspectDiscarded(child, nextParent);
  };

  visit(root, undefined);
  return output;
};

const convertNode = (
  node: MdNode,
  children: number[],
  parentDirective: string | undefined,
  source: string,
  limits: TfmLimits,
  diagnostics: DiagnosticCollector,
  definitionIdentifiers: ReadonlySet<string>,
): TfmNode => {
  const span = spanOf(node);
  const base = { ...emptyNode(kindOf(node), span), children };
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
    case "html":
    case "yaml":
      if (node.type === "html") {
        diagnostics.add({
          code: "TFM_RAW_HTML",
          severity: "error",
          message: "Raw HTML is prohibited and has been preserved as inert text.",
          span,
        });
      }
      return {
        ...base,
        kind: node.type === "html" ? "text" : kindOf(node),
        text: node.type === "html"
          ? boundedSnippet(node.value ?? sliceSource(source, span))
          : node.value ?? sliceSource(source, span),
        language: node.type === "code" ? node.lang ?? "" : "",
      };
    case "heading":
      return { ...base, depth: node.depth ?? 0 };
    case "link":
    case "image":
      return {
        ...base,
        url: node.url ?? "",
        title: node.title ?? "",
        text: node.type === "image" ? node.alt ?? "" : "",
      };
    case "linkReference":
    case "imageReference": {
      const identifier = normalizeIdentifier(node.identifier ?? node.label ?? "");
      if (!definitionIdentifiers.has(identifier)) {
        return { ...base, kind: "text", text: sliceSource(source, span), children: [] };
      }
      return {
        ...base,
        kind: node.type === "linkReference" ? "link" : "image",
        identifier,
        text: node.type === "imageReference" ? node.alt ?? "" : "",
      };
    }
    case "definition":
      return {
        ...base,
        identifier: normalizeIdentifier(node.identifier ?? node.label ?? ""),
        url: node.url ?? "",
        title: node.title ?? "",
      };
    case "footnoteDefinition":
    case "footnoteReference":
      return { ...base, identifier: normalizeIdentifier(node.identifier ?? node.label ?? "") };
    case "table":
      return { ...base, alignments: (node.align ?? []).map((value) => value ?? "") };
    case "list":
      return { ...base, ordered: node.ordered === true, listStart: node.start ?? 0 };
    case "listItem":
      return { ...base, task: node.checked !== null && node.checked !== undefined, checked: node.checked === true };
    case "textDirective":
      diagnostics.add({
        code: "TFM_UNSUPPORTED_INLINE_DIRECTIVE",
        severity: "error",
        message: "Single-colon inline directives are not supported in TFM v1.",
        span,
      });
      return { ...base, kind: "text", text: sliceSource(source, span), children: [] };
    case "leafDirective":
    case "containerDirective":
      return convertDirective(node, children, parentDirective, source, limits, diagnostics);
    default:
      return base;
  }
};

const convertDirective = (
  node: MdNode,
  children: number[],
  parentDirective: string | undefined,
  source: string,
  limits: TfmLimits,
  diagnostics: DiagnosticCollector,
): TfmNode => {
  const name = node.name ?? "";
  const span = spanOf(node);
  const spec = isDirectiveName(name) ? DIRECTIVE_SPECS[name] : undefined;
  if (!spec) {
    diagnostics.add({
      code: "TFM_UNKNOWN_DIRECTIVE",
      severity: "error",
      message: `Unknown TFM directive ${(name || "(unnamed)").slice(0, 64)}.`,
      span,
    });
    return { ...emptyNode("invalid-directive", span), text: boundedSnippet(sliceSource(source, span)) };
  }

  const actualForm = node.type === "leafDirective" ? "leaf" : "container";
  if (actualForm !== spec.form) {
    diagnostics.add({
      code: "TFM_WRONG_DIRECTIVE_FORM",
      severity: "error",
      message: `Directive ${name} must use the ${spec.form} form.`,
      span,
    });
    return { ...emptyNode("invalid-directive", span), text: boundedSnippet(sliceSource(source, span)) };
  }

  validateNesting(name, parentDirective, span, diagnostics);
  validateContainerChildren(name, node.children ?? [], span, diagnostics);
  const attributes = validateAttributes(
    name,
    node.attributes ?? {},
    span,
    limits.maxAttributeCount,
    limits.maxAttributeLength,
    (diagnostic) => diagnostics.add(diagnostic),
  );
  return { ...emptyNode(name as TfmNodeKind, span), children, attributes };
};

const validateContainerChildren = (
  name: string,
  children: readonly MdNode[],
  span: TfmSpan,
  diagnostics: DiagnosticCollector,
): void => {
  const requiredChild = name === "tessyl-columns"
    ? "tessyl-column"
    : name === "tessyl-card-grid"
      ? "tessyl-card"
      : undefined;
  if (!requiredChild) return;
  for (const child of children) {
    if (child.type !== "containerDirective" || child.name !== requiredChild) {
      diagnostics.add({
        code: "TFM_INVALID_NESTING",
        severity: "error",
        message: `Directive ${name} may contain only ${requiredChild} directives.`,
        span: spanOf(child) ?? span,
      });
    }
  }
};

const validateNesting = (
  name: string,
  parent: string | undefined,
  span: TfmSpan,
  diagnostics: DiagnosticCollector,
): void => {
  const requiredParent = name === "tessyl-column"
    ? "tessyl-columns"
    : name === "tessyl-card"
      ? "tessyl-card-grid"
      : undefined;
  if (requiredParent && parent !== requiredParent) {
    diagnostics.add({
      code: "TFM_INVALID_NESTING",
      severity: "error",
      message: `Directive ${name} must be a direct child of ${requiredParent}.`,
      span,
    });
  }
  if (parent === "tessyl-columns" && name !== "tessyl-column") {
    diagnostics.add({
      code: "TFM_INVALID_NESTING",
      severity: "error",
      message: `Only tessyl-column directives may be nested directly in ${parent}.`,
      span,
    });
  }
  if (parent === "tessyl-card-grid" && name !== "tessyl-card") {
    diagnostics.add({
      code: "TFM_INVALID_NESTING",
      severity: "error",
      message: `Only tessyl-card directives may be nested directly in ${parent}.`,
      span,
    });
  }
};

const directiveInfo = (node: MdNode): { name: string; valid: boolean } | undefined => {
  if (node.type !== "leafDirective" && node.type !== "containerDirective") return undefined;
  const name = node.name ?? "";
  const spec = isDirectiveName(name) ? DIRECTIVE_SPECS[name] : undefined;
  const form = node.type === "leafDirective" ? "leaf" : "container";
  return { name, valid: spec?.form === form };
};

const kindOf = (node: MdNode): TfmNodeKind => {
  switch (node.type) {
    case "root": return "root";
    case "paragraph": return "paragraph";
    case "heading": return "heading";
    case "text": return "text";
    case "emphasis": return "emphasis";
    case "strong": return "strong";
    case "delete": return "strikethrough";
    case "link": return "link";
    case "image": return "image";
    case "list": return "list";
    case "listItem": return "list-item";
    case "blockquote": return "block-quote";
    case "code": return "code-block";
    case "inlineCode": return "inline-code";
    case "table": return "table";
    case "tableRow": return "table-row";
    case "tableCell": return "table-cell";
    case "break": return "break";
    case "thematicBreak": return "thematic-break";
    case "definition": return "definition";
    case "footnoteDefinition": return "footnote-definition";
    case "footnoteReference": return "footnote-reference";
    default: return "unsupported";
  }
};

const emptyNode = (kind: TfmNodeKind, span: TfmSpan): TfmNode => ({
  kind,
  children: [],
  span,
  text: "",
  url: "",
  title: "",
  language: "",
  identifier: "",
  depth: 0,
  ordered: false,
  listStart: 0,
  task: false,
  checked: false,
  attributes: [],
  alignments: [],
});

const spanOf = (node: MdNode | undefined): TfmSpan => {
  const start = node?.position?.start;
  const end = node?.position?.end;
  if (!start || !end) return { ...EMPTY_SPAN };
  return {
    start: start.offset ?? 0,
    end: end.offset ?? start.offset ?? 0,
    startLine: start.line ?? 1,
    startColumn: start.column ?? 1,
    endLine: end.line ?? start.line ?? 1,
    endColumn: end.column ?? start.column ?? 1,
  };
};

const sourceSpan = (source: string): TfmSpan => {
  let lineCount = 1;
  let lastLineBreak = -1;
  for (let index = source.indexOf("\n"); index !== -1; index = source.indexOf("\n", index + 1)) {
    lineCount += 1;
    lastLineBreak = index;
  }
  return {
    start: 0,
    end: source.length,
    startLine: 1,
    startColumn: 1,
    endLine: lineCount,
    endColumn: source.length - lastLineBreak,
  };
};

const sliceSource = (source: string, span: TfmSpan): string => source.slice(span.start, span.end);

const boundedSnippet = (value: string): string => value.length <= 256
  ? value
  : `${value.slice(0, 255)}…`;

const normalizeIdentifier = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

const collectDefinitionIdentifiers = (root: MdNode): Set<string> => {
  const definitions = new Set<string>();
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    if (current.type === "definition") {
      definitions.add(normalizeIdentifier(current.identifier ?? current.label ?? ""));
    }
    pending.push(...(current.children ?? []));
  }
  return definitions;
};

class DiagnosticCollector {
  readonly #diagnostics: TfmDiagnostic[] = [];
  #truncated = false;

  constructor(private readonly maximum: number) {}

  add(diagnostic: TfmDiagnostic): void {
    if (this.#diagnostics.length < this.maximum) {
      this.#diagnostics.push(diagnostic);
    } else {
      this.#truncated = true;
    }
  }

  finish(): TfmDiagnostic[] {
    if (this.#truncated && this.#diagnostics.length > 0) {
      this.#diagnostics[this.#diagnostics.length - 1] = {
        code: "TFM_DIAGNOSTIC_LIMIT",
        severity: "error",
        message: `Further diagnostics were suppressed after reaching the limit of ${this.maximum}.`,
        span: { ...EMPTY_SPAN },
      };
    }
    return this.#diagnostics;
  }
}
