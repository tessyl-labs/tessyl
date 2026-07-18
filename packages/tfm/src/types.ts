export const TFM_SCHEMA_VERSION = "tfm-1" as const;
export const TFM_VOCABULARY_VERSION = "tfm-directives-1" as const;

export type TfmSpan = {
  start: number;
  end: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type TfmDiagnostic = {
  code: string;
  severity: "error" | "warning";
  message: string;
  span: TfmSpan;
};

export type TfmAttribute = {
  name: string;
  type: "string" | "boolean" | "integer" | "enum" | "opaque-id";
  value: string;
  booleanValue: boolean;
  integerValue: number;
};

export type TfmNodeKind =
  | "root"
  | "paragraph"
  | "heading"
  | "text"
  | "emphasis"
  | "strong"
  | "strikethrough"
  | "link"
  | "image"
  | "list"
  | "list-item"
  | "block-quote"
  | "code-block"
  | "inline-code"
  | "table"
  | "table-row"
  | "table-cell"
  | "break"
  | "thematic-break"
  | "definition"
  | "footnote-definition"
  | "footnote-reference"
  | "invalid-directive"
  | "unsupported"
  | "tessyl-video"
  | "tessyl-audio"
  | "tessyl-app"
  | "tessyl-data-table"
  | "tessyl-aside"
  | "tessyl-infobox"
  | "tessyl-columns"
  | "tessyl-column"
  | "tessyl-card-grid"
  | "tessyl-card";

/**
 * A boundary-safe flat node. Empty strings, false, and zero are sentinels for
 * fields that are not meaningful for a particular node kind.
 */
export type TfmNode = {
  kind: TfmNodeKind;
  children: number[];
  span: TfmSpan;
  text: string;
  url: string;
  title: string;
  language: string;
  identifier: string;
  depth: number;
  ordered: boolean;
  listStart: number;
  task: boolean;
  checked: boolean;
  attributes: TfmAttribute[];
};

export type TfmLimits = {
  maxSourceBytes: number;
  maxNestingDepth: number;
  maxNodeCount: number;
  maxAttributeCount: number;
  maxAttributeLength: number;
  maxDiagnostics: number;
};

export type TfmParseResult = {
  schemaVersion: typeof TFM_SCHEMA_VERSION;
  vocabularyVersion: typeof TFM_VOCABULARY_VERSION;
  success: boolean;
  root: number;
  nodes: TfmNode[];
  diagnostics: TfmDiagnostic[];
  limits: TfmLimits;
};

export type TfmParseOptions = {
  /** Limits may be lowered per parse but cannot exceed the package defaults. */
  limits?: Partial<TfmLimits>;
};

export const DEFAULT_TFM_LIMITS: Readonly<TfmLimits> = Object.freeze({
  maxSourceBytes: 2_000_000,
  maxNestingDepth: 64,
  maxNodeCount: 50_000,
  maxAttributeCount: 32,
  maxAttributeLength: 1_024,
  maxDiagnostics: 100,
});
