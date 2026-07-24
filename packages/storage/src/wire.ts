import { StorageError } from "./errors.js";

export type VoydValueNode =
  | { readonly tag: "Empty" }
  | { readonly tag: "BoolNode"; readonly value: boolean }
  | { readonly tag: "I32Node"; readonly value: number }
  | { readonly tag: "I64Node"; readonly value: bigint | number }
  | { readonly tag: "F32Node"; readonly value: number }
  | { readonly tag: "F64Node"; readonly value: number }
  | { readonly tag: "TextNode"; readonly value: string }
  | { readonly tag: "ListNode"; readonly items: readonly number[] }
  | { readonly tag: "RecordNode"; readonly fields: readonly VoydValueField[] }
  | { readonly tag: "NamedNode"; readonly name: string; readonly fields: readonly VoydValueField[] };

export interface VoydValueField {
  readonly name: string;
  readonly node: number;
}

export interface VoydValue {
  readonly root: number;
  readonly nodes: readonly { readonly value: VoydValueNode }[];
}

const MAX_DEPTH = 32;
const MAX_NODES = 50_000;
const MIN_I64 = -(1n << 63n);
const MAX_I64 = (1n << 63n) - 1n;
const RESERVED_VARIANT_FIELD = "$variant";

const invalid = (message: string): never => {
  throw new StorageError("invalid_request", message, { operation: "document.value" });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const decodeVoydValue = (value: VoydValue): unknown => {
  if (!Number.isInteger(value.root) || !Array.isArray(value.nodes) || value.nodes.length < 1 || value.nodes.length > MAX_NODES) {
    invalid("Invalid Voyd document value graph");
  }

  const active = new Set<number>();
  const visited = new Set<number>();
  const decodeNode = (index: number, depth: number): unknown => {
    if (!Number.isInteger(index) || index < 0 || index >= value.nodes.length || depth > MAX_DEPTH || active.has(index) || visited.has(index)) {
      invalid("Invalid or cyclic Voyd document value graph");
    }
    const node = value.nodes[index]!.value;
    active.add(index);
    visited.add(index);
    try {
      switch (node.tag) {
        case "Empty": return null;
        case "BoolNode":
          if (typeof node.value !== "boolean") invalid("Invalid boolean document node");
          return node.value;
        case "I32Node":
          if (!Number.isInteger(node.value) || node.value < -2_147_483_648 || node.value > 2_147_483_647) invalid("Invalid i32 document node");
          return node.value;
        case "I64Node": {
          let numeric: bigint;
          try {
            numeric = typeof node.value === "bigint" ? node.value : BigInt(node.value);
          } catch {
            return invalid("Invalid i64 document node");
          }
          if (numeric < MIN_I64 || numeric > MAX_I64) invalid("Document i64 value is out of range");
          return numeric;
        }
        case "F32Node":
        case "F64Node":
          if (typeof node.value !== "number" || !Number.isFinite(node.value)) invalid("Invalid floating-point document node");
          return node.value;
        case "TextNode":
          if (typeof node.value !== "string") invalid("Invalid text document node");
          return node.value;
        case "ListNode":
          if (!Array.isArray(node.items)) invalid("Invalid list document node");
          return node.items.map((child) => decodeNode(child, depth + 1));
        case "RecordNode":
          return decodeFields(node.fields, depth);
        case "NamedNode": {
          if (typeof node.name !== "string" || !node.name) invalid("Invalid named document node");
          return { [RESERVED_VARIANT_FIELD]: node.name, ...decodeFields(node.fields, depth) };
        }
        default:
          return invalid("Unknown Voyd document node");
      }
    } finally {
      active.delete(index);
    }
  };

  const decodeFields = (fields: readonly VoydValueField[], depth: number): Record<string, unknown> => {
    if (!Array.isArray(fields)) invalid("Invalid document fields");
    const result: Record<string, unknown> = Object.create(null);
    for (const field of fields) {
      if (!field || typeof field.name !== "string" || !field.name || field.name === RESERVED_VARIANT_FIELD || Object.hasOwn(result, field.name)) {
        invalid("Invalid or duplicate document field");
      }
      result[field.name] = decodeNode(field.node, depth + 1);
    }
    return result;
  };

  return decodeNode(value.root, 0);
};

export const encodeVoydValue = (value: unknown): VoydValue => {
  const nodes: { value: VoydValueNode }[] = [];

  const append = (node: VoydValueNode): number => {
    if (nodes.length >= MAX_NODES) invalid("Document exceeds the node limit");
    nodes.push({ value: node });
    return nodes.length - 1;
  };

  const encodeNode = (current: unknown, depth: number): number => {
    if (depth > MAX_DEPTH) invalid("Document exceeds the nesting limit");
    if (current === null) return append({ tag: "Empty" });
    if (typeof current === "boolean") return append({ tag: "BoolNode", value: current });
    if (typeof current === "string") return append({ tag: "TextNode", value: current });
    if (typeof current === "number") {
      if (!Number.isFinite(current)) invalid("Document numbers must be finite");
      if (Number.isInteger(current) && current >= -2_147_483_648 && current <= 2_147_483_647) return append({ tag: "I32Node", value: current });
      return append({ tag: "F64Node", value: current });
    }
    if (typeof current === "bigint") {
      if (current < MIN_I64 || current > MAX_I64) invalid("Document i64 value is out of range");
      return append({ tag: "I64Node", value: current });
    }
    if (Array.isArray(current)) return append({ tag: "ListNode", items: current.map((item) => encodeNode(item, depth + 1)) });
    if (!isRecord(current)) invalid("Document contains an unsupported value");
    const record = current as Record<string, unknown>;

    const variant = record[RESERVED_VARIANT_FIELD];
    const fields: VoydValueField[] = [];
    for (const [name, fieldValue] of Object.entries(record)) {
      if (name === RESERVED_VARIANT_FIELD) continue;
      fields.push({ name, node: encodeNode(fieldValue, depth + 1) });
    }
    if (variant !== undefined) {
      if (typeof variant !== "string" || !variant) invalid("Document variant name must be a non-empty string");
      return append({ tag: "NamedNode", name: variant as string, fields });
    }
    return append({ tag: "RecordNode", fields });
  };

  const root = encodeNode(value, 0);
  return { root, nodes };
};

export const serializeVoydValue = (value: VoydValue): string => {
  decodeVoydValue(value);
  return JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item);
};

export const parseStoredVoydValue = (bodyJson: string): VoydValue => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyJson);
  } catch (cause) {
    throw new StorageError("invalid_data", "Stored document is not valid JSON", { operation: "document.value", cause });
  }
  if (isRecord(parsed) && Number.isInteger(parsed.root) && Array.isArray(parsed.nodes)) {
    const value = parsed as unknown as VoydValue;
    decodeVoydValue(value);
    return {
      root: value.root,
      nodes: value.nodes.map((entry) => entry.value.tag === "I64Node"
        ? { value: { ...entry.value, value: BigInt(entry.value.value) } }
        : entry),
    };
  }
  throw new StorageError("invalid_data", "Stored document does not use the Voyd value format", {
    operation: "document.value",
  });
};

export const decodeStoredDocumentBody = (bodyJson: string): Record<string, unknown> => {
  const parsed = JSON.parse(bodyJson) as unknown;
  const decoded = isRecord(parsed) && Number.isInteger(parsed.root) && Array.isArray(parsed.nodes)
    ? decodeVoydValue(parsed as unknown as VoydValue)
    : parsed;
  if (!isRecord(decoded)) invalid("Document root must be an object");
  return decoded as Record<string, unknown>;
};
