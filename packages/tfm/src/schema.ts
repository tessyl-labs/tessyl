import type { TfmAttribute, TfmDiagnostic, TfmSpan } from "./types.js";

type AttributeSpec =
  | { type: "boolean"; required?: boolean; default?: boolean }
  | { type: "integer"; required?: boolean; default?: number; min: number; max: number }
  | { type: "enum"; required?: boolean; default?: string; values: readonly string[] }
  | { type: "string"; required?: boolean; default?: string }
  | { type: "opaque-id"; required?: boolean; prefix: string };

type DirectiveSpec = {
  form: "leaf" | "container";
  attributes: Readonly<Record<string, AttributeSpec>>;
};

export const DIRECTIVE_SPECS: Readonly<Record<string, DirectiveSpec>> = {
  "tessyl-video": {
    form: "leaf",
    attributes: {
      asset: { type: "opaque-id", required: true, prefix: "asr_video_" },
      controls: { type: "boolean", default: true },
    },
  },
  "tessyl-audio": {
    form: "leaf",
    attributes: {
      asset: { type: "opaque-id", required: true, prefix: "asr_audio_" },
      transcript: { type: "opaque-id", prefix: "asr_text_" },
      controls: { type: "boolean", default: true },
    },
  },
  "tessyl-app": {
    form: "leaf",
    attributes: {
      revision: { type: "opaque-id", required: true, prefix: "tsr_" },
      height: { type: "enum", default: "standard", values: ["compact", "standard", "tall"] },
    },
  },
  "tessyl-data-table": {
    form: "leaf",
    attributes: {
      dataset: { type: "opaque-id", required: true, prefix: "dsr_" },
      sortable: { type: "boolean", default: true },
    },
  },
  "tessyl-aside": {
    form: "container",
    attributes: {
      tone: {
        type: "enum",
        default: "informative",
        values: ["informative", "note", "tip", "warning", "caution"],
      },
      title: { type: "string" },
    },
  },
  "tessyl-infobox": {
    form: "container",
    attributes: {
      tone: { type: "enum", default: "neutral", values: ["neutral", "positive", "warning"] },
      title: { type: "string" },
    },
  },
  "tessyl-columns": { form: "container", attributes: {} },
  "tessyl-column": { form: "container", attributes: {} },
  "tessyl-card-grid": {
    form: "container",
    attributes: {
      columns: { type: "integer", default: 3, min: 1, max: 4 },
    },
  },
  "tessyl-card": {
    form: "container",
    attributes: {
      title: { type: "string", required: true },
    },
  },
};

const OPAQUE_SUFFIX = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

export const validateAttributes = (
  directiveName: string,
  raw: Readonly<Record<string, string | null>>,
  span: TfmSpan,
  maxCount: number,
  maxLength: number,
  report: (diagnostic: TfmDiagnostic) => void,
): TfmAttribute[] => {
  const spec = Object.hasOwn(DIRECTIVE_SPECS, directiveName)
    ? DIRECTIVE_SPECS[directiveName]
    : undefined;
  if (!spec) return [];

  const entries = Object.entries(raw);
  if (entries.length > maxCount) {
    report(error(
      "TFM_ATTRIBUTE_COUNT_LIMIT",
      `Directive ${directiveName} has more than ${maxCount} attributes.`,
      span,
    ));
  }

  const boundedEntries = entries.slice(0, maxCount);
  for (const [name, value] of boundedEntries) {
    if (name.length > maxLength || (value?.length ?? 0) > maxLength) {
      report(error(
        "TFM_ATTRIBUTE_LENGTH_LIMIT",
        `Attribute ${name.slice(0, 64)} exceeds the ${maxLength} character limit.`,
        span,
      ));
    }
    if (!Object.hasOwn(spec.attributes, name)) {
      report(error(
        "TFM_UNKNOWN_ATTRIBUTE",
        `Unknown attribute ${name.slice(0, 64)} on ${directiveName}.`,
        span,
      ));
    }
  }

  const normalized: TfmAttribute[] = [];
  for (const [name, attribute] of Object.entries(spec.attributes)) {
    const rawValue = raw[name];
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      if ("default" in attribute && attribute.default !== undefined) {
        normalized.push(toAttribute(name, attribute.type, attribute.default));
      } else if (attribute.required) {
        report(error(
          "TFM_MISSING_ATTRIBUTE",
          `Directive ${directiveName} requires attribute ${name}.`,
          span,
        ));
      }
      continue;
    }
    if (name.length > maxLength || rawValue.length > maxLength) continue;

    switch (attribute.type) {
      case "boolean":
        if (rawValue !== "true" && rawValue !== "false") {
          report(invalid(directiveName, name, "true or false", span));
        } else {
          normalized.push(toAttribute(name, "boolean", rawValue === "true"));
        }
        break;
      case "integer": {
        const value = /^-?\d+$/.test(rawValue) ? Number(rawValue) : Number.NaN;
        if (!Number.isSafeInteger(value) || value < attribute.min || value > attribute.max) {
          report(invalid(
            directiveName,
            name,
            `an integer from ${attribute.min} through ${attribute.max}`,
            span,
          ));
        } else {
          normalized.push(toAttribute(name, "integer", value));
        }
        break;
      }
      case "enum":
        if (!attribute.values.includes(rawValue)) {
          report(invalid(directiveName, name, attribute.values.join(", "), span));
        } else {
          normalized.push(toAttribute(name, "enum", rawValue));
        }
        break;
      case "opaque-id": {
        const suffix = rawValue.startsWith(attribute.prefix)
          ? rawValue.slice(attribute.prefix.length)
          : "";
        if (!OPAQUE_SUFFIX.test(suffix)) {
          report(invalid(directiveName, name, `an opaque ${attribute.prefix} reference`, span));
        } else {
          normalized.push(toAttribute(name, "opaque-id", rawValue));
        }
        break;
      }
      case "string":
        normalized.push(toAttribute(name, "string", rawValue));
        break;
    }
  }
  return normalized;
};

const toAttribute = (
  name: string,
  type: TfmAttribute["type"],
  value: string | boolean | number,
): TfmAttribute => ({
  name,
  type,
  value: String(value),
  booleanValue: typeof value === "boolean" ? value : false,
  integerValue: typeof value === "number" ? value : 0,
});

const error = (code: string, message: string, span: TfmSpan): TfmDiagnostic => ({
  code,
  severity: "error",
  message,
  span,
});

const invalid = (
  directiveName: string,
  name: string,
  expected: string,
  span: TfmSpan,
): TfmDiagnostic => error(
  "TFM_INVALID_ATTRIBUTE",
  `Attribute ${name} on ${directiveName} must be ${expected}.`,
  span,
);
