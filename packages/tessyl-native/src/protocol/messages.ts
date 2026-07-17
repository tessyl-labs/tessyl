import { TessylNativeError } from "../errors.js";

export type RuntimeRequestKind = "boot" | "init" | "render" | "dispatch" | "release_handlers" | "dispose" | "pause";
export type RuntimeRequest = {
  version: 1;
  tesseraId: string;
  generation: number;
  requestId: number;
  kind: RuntimeRequestKind;
  payload?: unknown;
};
export type RuntimeResponse = {
  version: 1;
  tesseraId: string;
  generation: number;
  requestId: number;
  kind: "ready" | "result" | "runtime_error";
  payload?: unknown;
};

const validateBase = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const record = value as Record<string, unknown>;
  const keys = new Set(["version", "tesseraId", "generation", "requestId", "kind", "payload"]);
  if (Object.keys(record).some((key) => !keys.has(key))) return invalid();
  if (
    record.version !== 1 ||
    typeof record.tesseraId !== "string" ||
    record.tesseraId.length > 80 ||
    !Number.isSafeInteger(record.generation) ||
    (record.generation as number) < 1 ||
    !Number.isSafeInteger(record.requestId) ||
    (record.requestId as number) < 0 ||
    typeof record.kind !== "string"
  ) return invalid();
  return record;
};

const REQUEST_KINDS = new Set<RuntimeRequestKind>(["boot", "init", "render", "dispatch", "release_handlers", "dispose", "pause"]);
const RESPONSE_KINDS = new Set<RuntimeResponse["kind"]>(["ready", "result", "runtime_error"]);

export const validateRuntimeRequest = (value: unknown): RuntimeRequest => {
  const record = validateBase(value);
  if (!REQUEST_KINDS.has(record.kind as RuntimeRequestKind) || (record.requestId as number) < 1) return invalid();
  const requiresPayload = record.kind === "boot" || record.kind === "dispatch" || record.kind === "release_handlers";
  if (requiresPayload ? record.payload === undefined : record.payload !== undefined) return invalid();
  return record as RuntimeRequest;
};

export const validateRuntimeResponse = (value: unknown): RuntimeResponse => {
  const record = validateBase(value);
  if (!RESPONSE_KINDS.has(record.kind as RuntimeResponse["kind"])) return invalid();
  if (record.kind === "ready") {
    if (record.requestId !== 0 || record.payload !== undefined) return invalid();
  } else if ((record.requestId as number) < 1 || (record.kind === "runtime_error" && record.payload === undefined)) return invalid();
  return record as RuntimeResponse;
};

const invalid = (): never => {
  throw new TessylNativeError({ code: "protocol_violation", phase: "run", message: "invalid runtime envelope", recoverable: true });
};
