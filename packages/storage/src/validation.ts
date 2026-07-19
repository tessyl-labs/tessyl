import { createHash } from "node:crypto";
import {
  DEFAULT_STORAGE_LIMITS,
  type IndexDefinition,
  type IndexQuery,
  type OperationOptions,
  type PortableScalar,
  type SearchDocument,
  type SearchQuery,
  type SearchSchema,
  type StorageLimits,
  type TableDefinition,
  type TransactionRequest,
  type UploadRequest,
} from "./contracts.js";
import { StorageError } from "./errors.js";

const encoder = new TextEncoder();
const NAME = /^[a-z][a-z0-9_]{0,127}$/;
const LOCALE = /^[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8})*$/;
const MAX_INDEXED_TERM_BYTES = 32_000;
const MAX_ENCODED_INDEX_KEY_BYTES = 1_024;
const MAX_SEARCH_BOOST = 1_000;
export const MAX_OUTBOX_LEASE_SECONDS = 86_400;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const requireRecord = (value: unknown, message: string, operation: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new StorageError("invalid_request", message, { operation });
  return value;
};
const requireArray = (value: unknown, field: string, operation: string): readonly unknown[] => {
  if (!Array.isArray(value)) throw new StorageError("invalid_request", `${field} must be an array`, { operation });
  return value;
};

export const mergeLimits = (limits?: Partial<StorageLimits>): Readonly<StorageLimits> => {
  const merged = { ...DEFAULT_STORAGE_LIMITS, ...limits };
  for (const [name, value] of Object.entries(merged)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new StorageError("invalid_request", `Storage limit ${name} must be a positive safe integer`, { operation: "storage.configure" });
    if (value > DEFAULT_STORAGE_LIMITS[name as keyof StorageLimits]) throw new StorageError("invalid_request", `Storage limit ${name} may be lowered but not raised above the portable default`, { operation: "storage.configure" });
  }
  return Object.freeze(merged);
};

export const utf8Bytes = (value: string): number => encoder.encode(value).byteLength;
const isPortableString = (value: string): boolean => {
  if (value.includes("\0")) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};

export const assertPortableString = (value: string, operation: string): void => {
  if (typeof value !== "string" || !isPortableString(value)) throw new StorageError("invalid_request", "String is not portable across storage backends", { operation });
};

export const assertNamespace = (value: string, limits: StorageLimits): void => {
  if (typeof value !== "string" || !value || utf8Bytes(value) > limits.maxNamespaceBytes || !isPortableString(value)) {
    throw new StorageError("invalid_request", "Invalid namespace", { operation: "validate.namespace" });
  }
};

export const assertName = (value: string, kind = "name", limits?: StorageLimits): void => {
  if (typeof value !== "string" || !NAME.test(value) || (limits && utf8Bytes(value) > limits.maxNameBytes)) throw new StorageError("invalid_request", `Invalid ${kind}`, { operation: "validate.name" });
};

export const assertKey = (value: string, limits: StorageLimits): void => {
  if (typeof value !== "string" || !value || utf8Bytes(value) > limits.maxKeyBytes || !isPortableString(value)) {
    throw new StorageError("invalid_request", "Invalid storage key", { operation: "validate.key" });
  }
};

export const assertSessionId = (value: string): void => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new StorageError("invalid_request", "Invalid upload session ID", { operation: "validate.session_id" });
};

export const assertLeaseToken = (value: string, limits: StorageLimits): void => {
  if (typeof value !== "string" || !value || !isPortableString(value) || utf8Bytes(value) > limits.maxKeyBytes + 37) throw new StorageError("invalid_request", "Invalid outbox lease token", { operation: "validate.lease_token" });
};

export const parsePortableDocument = (bodyJson: string, limits: StorageLimits): Record<string, unknown> => {
  if (utf8Bytes(bodyJson) > limits.maxDocumentBytes) {
    throw new StorageError("limit_exceeded", "Document exceeds configured size", { operation: "validate.document" });
  }
  let value: unknown;
  try {
    value = JSON.parse(bodyJson);
  } catch (cause) {
    throw new StorageError("invalid_request", "Document is not valid JSON", { operation: "validate.document", cause });
  }
  validatePortableValue(value, 0, { nodes: 0 });
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new StorageError("invalid_request", "Document root must be an object", { operation: "validate.document" });
  }
  return value as Record<string, unknown>;
};

const validatePortableValue = (value: unknown, depth: number, state: { nodes: number }): void => {
  state.nodes += 1;
  if (depth > 32 || state.nodes > 50_000) {
    throw new StorageError("limit_exceeded", "Document nesting or node count exceeds portable limits", { operation: "validate.document" });
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { if (!isPortableString(value)) throw new StorageError("invalid_request", "Document contains a non-portable string", { operation: "validate.document" }); return; }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new StorageError("invalid_request", "Document numbers must be finite", { operation: "validate.document" });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) validatePortableValue(item, depth + 1, state);
    return;
  }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (!key || !isPortableString(key)) throw new StorageError("invalid_request", "Document contains an invalid field name", { operation: "validate.document" });
      validatePortableValue(item, depth + 1, state);
    }
    return;
  }
  throw new StorageError("invalid_request", "Document contains a non-portable value", { operation: "validate.document" });
};

export const validateTableDefinition = (definition: TableDefinition, limits: StorageLimits): void => {
  const raw = requireRecord(definition, "Table definition must be an object", "validate.table");
  requireArray(raw.indexes, "Table indexes", "validate.table");
  assertName(definition.name, "table name", limits);
  if (!Number.isSafeInteger(definition.schemaVersion) || definition.schemaVersion < 1) {
    throw new StorageError("invalid_request", "Table schemaVersion must be a positive integer", { operation: "validate.table" });
  }
  const names = new Set<string>();
  if (definition.indexes.length > limits.maxIndexEntriesPerDocument) {
    throw new StorageError("limit_exceeded", "Table declares too many indexes", { operation: "validate.table" });
  }
  for (const index of definition.indexes) {
    const rawIndex = requireRecord(index, "Table index must be an object", "validate.table");
    requireArray(rawIndex.fields, "Index fields", "validate.table");
    assertName(index.name, "index name", limits);
    if (typeof index.unique !== "boolean" || typeof index.ordered !== "boolean" || typeof index.sparse !== "boolean") throw new StorageError("invalid_request", "Index flags must be booleans", { operation: "validate.table" });
    if (names.has(index.name)) throw new StorageError("invalid_request", `Duplicate index ${index.name}`, { operation: "validate.table" });
    names.add(index.name);
    if (index.fields.length < 1 || index.fields.length > limits.maxIndexFields) {
      throw new StorageError("limit_exceeded", `Index ${index.name} has an invalid field count`, { operation: "validate.table" });
    }
    for (const field of index.fields) {
      requireRecord(field, "Index field must be an object", "validate.table");
      if (typeof field.path !== "string" || !field.path || field.path.split(".").some((part) => !NAME.test(part)) || !["string", "number", "boolean", "null"].includes(field.type)) {
        throw new StorageError("invalid_request", `Index ${index.name} has invalid path ${field.path}`, { operation: "validate.table" });
      }
    }
  }
};

export const canonicalJson = (value: unknown): string => JSON.stringify(sortValue(value));

export const compareUtf8 = (left: string, right: string): number => Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compareUtf8(a, b)).map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
};

export const definitionHash = (definition: TableDefinition | object): string =>
  createHash("sha256").update(canonicalJson(definition)).digest("hex");

export const getPath = (document: Record<string, unknown>, path: string): unknown => {
  let current: unknown = document;
  for (const part of path.split(".")) {
    if (!current || Array.isArray(current) || typeof current !== "object" || !(part in current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

export const extractIndexValues = (document: Record<string, unknown>, index: IndexDefinition): readonly PortableScalar[] | undefined => {
  const values: PortableScalar[] = [];
  for (const field of index.fields) {
    const value = getPath(document, field.path);
    if (value === undefined) {
      if (index.sparse) return undefined;
      values.push(null);
      continue;
    }
    const type = value === null ? "null" : typeof value;
    if (type !== field.type || (type === "number" && !Number.isFinite(value))) {
      throw new StorageError("invalid_request", `Index ${index.name} field ${field.path} must be ${field.type}`, { operation: "validate.index" });
    }
    values.push(value as PortableScalar);
  }
  return values;
};

const hexByte = (value: number): string => value.toString(16).padStart(2, "0");

export const encodeScalar = (value: PortableScalar): string => {
  if (value === null) return "0";
  if (typeof value === "boolean") return value ? "11" : "10";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new StorageError("invalid_request", "Index numbers must be finite", { operation: "validate.index" });
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, Object.is(value, -0) ? 0 : value, false);
    const bytes = new Uint8Array(buffer);
    if ((bytes[0]! & 0x80) !== 0) for (let index = 0; index < bytes.length; index += 1) bytes[index] = (~bytes[index]!) & 0xff;
    else bytes[0] = bytes[0]! ^ 0x80;
    return `2${[...bytes].map(hexByte).join("")}`;
  }
  assertPortableString(value, "validate.index");
  return `3${Buffer.from(value, "utf8").toString("hex")}`;
};

export const encodeIndexValues = (values: readonly PortableScalar[]): string => {
  const encoded = values.map(encodeScalar).join(".");
  if (utf8Bytes(encoded) > MAX_ENCODED_INDEX_KEY_BYTES) throw new StorageError("limit_exceeded", "Encoded document index key exceeds the portable backend limit", { operation: "validate.index" });
  return encoded;
};

export const encodeCursor = (value: object): string => Buffer.from(canonicalJson(value), "utf8").toString("base64url");

export const decodeCursor = <T extends object>(cursor: string | undefined, operation: string): T | undefined => {
  if (!cursor) return undefined;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    if (raw.length > 4_096) throw new Error("cursor too large");
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error("cursor must be an object");
    return parsed as T;
  } catch (cause) {
    throw new StorageError("invalid_request", "Invalid continuation cursor", { operation, cause });
  }
};

export const positiveInteger = (value: string, field: string, max = Number.MAX_SAFE_INTEGER): number => {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) throw new StorageError("invalid_request", `${field} must be a canonical unsigned integer string`, { operation: "validate.integer" });
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) throw new StorageError("limit_exceeded", `${field} exceeds supported range`, { operation: "validate.integer" });
  if (parsed < 1) throw new StorageError("invalid_request", `${field} must be positive`, { operation: "validate.integer" });
  return parsed;
};

const nonnegativeInteger = (value: string, field: string, max: number): number => {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) throw new StorageError("invalid_request", `${field} must be an unsigned integer string`, { operation: "validate.integer" });
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) throw new StorageError("limit_exceeded", `${field} exceeds supported range`, { operation: "validate.integer" });
  return parsed;
};

const assertUniqueNames = (values: readonly string[], kind: string, limits?: StorageLimits): void => {
  const seen = new Set<string>();
  for (const value of values) {
    assertName(value, kind, limits);
    if (seen.has(value)) throw new StorageError("invalid_request", `Duplicate ${kind}: ${value}`, { operation: "validate.search" });
    seen.add(value);
  }
};

export const validateSearchSchema = (schema: SearchSchema, limits: StorageLimits): void => {
  const raw = requireRecord(schema, "Search schema must be an object", "search_index.create");
  for (const field of ["fields", "filterFields", "facetFields", "locales"] as const) requireArray(raw[field], `Search schema ${field}`, "search_index.create");
  assertName(schema.name, "search index name", limits);
  if (!Number.isSafeInteger(schema.version) || schema.version < 1 || schema.fields.length < 1) {
    throw new StorageError("invalid_request", "Invalid search schema", { operation: "search_index.create" });
  }
  if (schema.fields.length > limits.maxIndexEntriesPerDocument || schema.filterFields.length > limits.maxIndexEntriesPerDocument || schema.facetFields.length > limits.maxIndexEntriesPerDocument || schema.locales.length > limits.maxIndexEntriesPerDocument) {
    throw new StorageError("limit_exceeded", "Search schema exceeds configured limits", { operation: "search_index.create" });
  }
  assertUniqueNames(schema.fields, "search field", limits);
  assertUniqueNames(schema.filterFields, "search filter field", limits);
  assertUniqueNames(schema.facetFields, "search facet field", limits);
  const locales = new Set<string>();
  for (const locale of schema.locales) {
    if (typeof locale !== "string") throw new StorageError("invalid_request", "Search locales must be strings", { operation: "search_index.create" });
    const normalized = locale.toLowerCase();
    if (!LOCALE.test(locale) || locales.has(normalized)) throw new StorageError("invalid_request", `Invalid or duplicate search locale: ${locale}`, { operation: "search_index.create" });
    locales.add(normalized);
  }
  for (const facet of schema.facetFields) if (!schema.filterFields.includes(facet)) throw new StorageError("invalid_request", `Facet field ${facet} must also be filterable`, { operation: "search_index.create" });
};

export const validateSearchDocument = (document: SearchDocument, schema: SearchSchema, limits: StorageLimits): number => {
  const raw = requireRecord(document, "Search document must be an object", "search_index.upsert");
  for (const field of ["fields", "filters", "tags"] as const) requireArray(raw[field], `Search document ${field}`, "search_index.upsert");
  assertNamespace(document.namespace, limits); assertKey(document.documentId, limits);
  const version = positiveInteger(document.version, "search version");
  if (document.fields.length > limits.maxIndexEntriesPerDocument || document.filters.length > limits.maxIndexEntriesPerDocument || document.tags.length > limits.maxIndexEntriesPerDocument || utf8Bytes(canonicalJson(document)) > limits.maxDocumentBytes) {
    throw new StorageError("limit_exceeded", "Search document exceeds configured limits", { operation: "search_index.upsert" });
  }
  for (const field of document.fields) { requireRecord(field, "Search field must be an object", "search_index.upsert"); if (typeof field.text !== "string" || !isPortableString(field.text)) throw new StorageError("invalid_request", "Search field text must be a portable string", { operation: "search_index.upsert" }); if ((field.text.match(/[\p{L}\p{N}_]+/gu) ?? []).some((term) => utf8Bytes(term) > MAX_INDEXED_TERM_BYTES)) throw new StorageError("limit_exceeded", "Search text contains an oversized indexed term", { operation: "search_index.upsert" }); }
  for (const filter of document.filters) { requireRecord(filter, "Search filter must be an object", "search_index.upsert"); if (!isPortableScalar(filter.value) || (typeof filter.value === "string" && !isPortableString(filter.value))) throw new StorageError("invalid_request", "Search filter value must be a portable scalar", { operation: "search_index.upsert" }); if (utf8Bytes(canonicalJson(filter.value)) > MAX_INDEXED_TERM_BYTES) throw new StorageError("limit_exceeded", "Search filter value exceeds the portable indexed-term limit", { operation: "search_index.upsert" }); }
  assertUniqueNames(document.fields.map(({ name }) => name), "search field", limits);
  assertUniqueNames(document.filters.map(({ name }) => name), "search filter field", limits);
  for (const field of document.fields) if (!schema.fields.includes(field.name)) throw new StorageError("invalid_request", `Unknown search field ${field.name}`, { operation: "search_index.upsert" });
  for (const filter of document.filters) if (!schema.filterFields.includes(filter.name)) throw new StorageError("invalid_request", `Unknown search filter ${filter.name}`, { operation: "search_index.upsert" });
  if (!schema.locales.includes(document.locale)) throw new StorageError("invalid_request", `Unsupported search locale ${document.locale}`, { operation: "search_index.upsert" });
  for (const tag of document.tags) if (typeof tag !== "string" || !tag || !isPortableString(tag) || utf8Bytes(tag) > limits.maxNameBytes) throw new StorageError("invalid_request", "Invalid search tag", { operation: "search_index.upsert" });
  return version;
};

export const validateSearchQuery = (request: SearchQuery, schema: SearchSchema, limits: StorageLimits): void => {
  const raw = requireRecord(request, "Search query must be an object", "search.query");
  for (const field of ["fields", "filters", "tags", "facets"] as const) requireArray(raw[field], `Search query ${field}`, "search.query");
  assertNamespace(request.namespace, limits);
  assertName(request.index, "search index name", limits);
  if (typeof request.text !== "string" || !isPortableString(request.text) || typeof request.locale !== "string" || !isPortableString(request.locale) || (request.cursor !== undefined && (typeof request.cursor !== "string" || !isPortableString(request.cursor)))) throw new StorageError("invalid_request", "Invalid search query strings", { operation: "search.query" });
  if (utf8Bytes(canonicalJson(request)) > limits.maxQueryBytes || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > limits.maxResultCount || request.fields.length > limits.maxIndexEntriesPerDocument || request.filters.length > limits.maxIndexEntriesPerDocument || request.tags.length > limits.maxIndexEntriesPerDocument || request.facets.length > limits.maxIndexEntriesPerDocument) {
    throw new StorageError("limit_exceeded", "Search query exceeds configured limits", { operation: "search.query" });
  }
  for (const field of request.fields) { requireRecord(field, "Selected search field must be an object", "search.query"); if (!schema.fields.includes(field.name) || !Number.isFinite(field.boost) || field.boost <= 0 || field.boost > MAX_SEARCH_BOOST) throw new StorageError("invalid_request", "Invalid selected search field", { operation: "search.query" }); }
  for (const filter of request.filters) { requireRecord(filter, "Search filter must be an object", "search.query"); if (!schema.filterFields.includes(filter.name)) throw new StorageError("invalid_request", "Unknown search filter", { operation: "search.query" }); }
  for (const filter of request.filters) { if (!isPortableScalar(filter.value) || (typeof filter.value === "string" && !isPortableString(filter.value)) || (filter.operator !== "eq" && filter.operator !== "neq")) throw new StorageError("invalid_request", "Invalid search filter", { operation: "search.query" }); if (utf8Bytes(canonicalJson(filter.value)) > MAX_INDEXED_TERM_BYTES) throw new StorageError("limit_exceeded", "Search filter value exceeds the portable indexed-term limit", { operation: "search.query" }); }
  for (const facet of request.facets) if (!schema.facetFields.includes(facet)) throw new StorageError("invalid_request", `Unknown search facet ${facet}`, { operation: "search.query" });
  for (const tag of request.tags) if (typeof tag !== "string" || !tag || !isPortableString(tag) || utf8Bytes(tag) > limits.maxNameBytes) throw new StorageError("invalid_request", "Invalid search tag", { operation: "search.query" });
  if (request.locale && !schema.locales.includes(request.locale)) throw new StorageError("invalid_request", `Unsupported search locale ${request.locale}`, { operation: "search.query" });
};

const isPortableScalar = (value: unknown): value is PortableScalar => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

export const validateUploadRequest = (request: UploadRequest, limits: StorageLimits): { bytes: number; requestHash: string } => {
  const raw = requireRecord(request, "Upload request must be an object", "object.initiate_upload");
  requireArray(raw.applicationMetadata, "Upload applicationMetadata", "object.initiate_upload");
  assertNamespace(request.namespace, limits); assertKey(request.key, limits); assertKey(request.idempotencyKey, limits);
  const bytes = nonnegativeInteger(request.byteLength, "byteLength", limits.maxUploadBytes);
  if (typeof request.checksumSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(request.checksumSha256) || typeof request.contentType !== "string" || !request.contentType || !isPortableString(request.contentType) || utf8Bytes(request.contentType) > 256 || !Number.isSafeInteger(request.partCount) || request.partCount < 1 || request.partCount > limits.maxUploadParts || !Number.isSafeInteger(request.expiresInSeconds) || request.expiresInSeconds < 1) throw new StorageError("invalid_request", "Invalid upload request", { operation: "object.initiate_upload" });
  if (request.applicationMetadata.length > limits.maxMetadataEntries || utf8Bytes(canonicalJson(request.applicationMetadata)) > limits.maxMetadataBytes) throw new StorageError("limit_exceeded", "Object metadata exceeds configured limits", { operation: "object.initiate_upload" });
  for (const entry of request.applicationMetadata) { requireRecord(entry, "Metadata entry must be an object", "object.initiate_upload"); if (typeof entry.name !== "string" || typeof entry.value !== "string" || !isPortableString(entry.value)) throw new StorageError("invalid_request", "Metadata names and values must be portable strings", { operation: "object.initiate_upload" }); }
  assertUniqueNames(request.applicationMetadata.map(({ name }) => name), "metadata name", limits);
  const requestHash = definitionHash({ ...request, checksumSha256: request.checksumSha256.toLowerCase() });
  return { bytes, requestHash };
};

export const validateTransactionRequest = (request: TransactionRequest, limits: StorageLimits): void => {
  if (!request || typeof request !== "object" || !Array.isArray(request.operations)) throw new StorageError("invalid_request", "Transaction request must contain an operations array", { operation: "document.transact" });
  if (request.operations.length < 1 || request.operations.length > limits.maxTransactionOperations) throw new StorageError("limit_exceeded", "Transaction operation count exceeds configured limits", { operation: "document.transact" });
  assertNamespace(request.namespace, limits); if (typeof request.idempotencyKey !== "string") throw new StorageError("invalid_request", "Transaction idempotencyKey must be a string", { operation: "document.transact" }); if (request.idempotencyKey) assertKey(request.idempotencyKey, limits);
  for (const mutation of request.operations) {
    if (!mutation || typeof mutation !== "object" || (mutation.kind !== "put" && mutation.kind !== "delete")) throw new StorageError("invalid_request", "Unknown document mutation kind", { operation: "document.transact" });
    assertName(mutation.table, "table name", limits); assertKey(mutation.key, limits);
    const condition = mutation.condition;
    if (!condition || typeof condition !== "object" || !["none", "absent", "present", "version_equals"].includes(condition.kind)) throw new StorageError("invalid_request", "Unknown write condition kind", { operation: "document.transact" });
    if (condition.kind === "version_equals") positiveInteger(condition.version, "document version");
    if (mutation.kind === "put" && typeof mutation.bodyJson !== "string") throw new StorageError("invalid_request", "Put mutation requires bodyJson", { operation: "document.transact" });
  }
};

export const validateIndexQuery = (request: IndexQuery, limits: StorageLimits): void => {
  const raw = requireRecord(request, "Document query must be an object", "document.query");
  for (const field of ["prefix"] as const) requireArray(raw[field], `Document query ${field}`, "document.query");
  if (raw.lower !== undefined) requireArray(raw.lower, "Document query lower", "document.query");
  if (raw.upper !== undefined) requireArray(raw.upper, "Document query upper", "document.query");
  assertNamespace(request.namespace, limits); assertName(request.table, "table name", limits); assertName(request.index, "index name", limits);
  if (request.order !== "asc" && request.order !== "desc") throw new StorageError("invalid_request", "Document query order must be asc or desc", { operation: "document.query" });
  if ((request.cursor !== undefined && typeof request.cursor !== "string") || (request.lowerInclusive !== undefined && typeof request.lowerInclusive !== "boolean") || (request.upperInclusive !== undefined && typeof request.upperInclusive !== "boolean")) throw new StorageError("invalid_request", "Invalid document query options", { operation: "document.query" });
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > limits.maxResultCount) throw new StorageError("limit_exceeded", "Query limit exceeds configured maximum", { operation: "document.query" });
  for (const value of [...request.prefix, ...(request.lower ?? []), ...(request.upper ?? [])]) if (!isPortableScalar(value)) throw new StorageError("invalid_request", "Document query values must be portable scalars", { operation: "document.query" });
  if (utf8Bytes(canonicalJson(request)) > limits.maxQueryBytes) throw new StorageError("limit_exceeded", "Document query exceeds configured size", { operation: "document.query" });
};

export const validateCompletedParts = (parts: readonly import("./contracts.js").CompletedPart[], limits: StorageLimits): void => {
  if (!Array.isArray(parts)) throw new StorageError("invalid_request", "Completed parts must be an array", { operation: "object.complete_upload" });
  if (parts.length > limits.maxUploadParts) throw new StorageError("limit_exceeded", "Completed multipart part count exceeds the configured limit", { operation: "object.complete_upload" });
  for (const part of parts) {
    const raw = requireRecord(part, "Completed part must be an object", "object.complete_upload");
    if (!Number.isSafeInteger(raw.partNumber) || Number(raw.partNumber) < 1 || Number(raw.partNumber) > limits.maxUploadParts || typeof raw.etag !== "string" || !raw.etag || !isPortableString(raw.etag)) throw new StorageError("invalid_request", "Invalid completed part", { operation: "object.complete_upload" });
    if (utf8Bytes(raw.etag) > 1_024) throw new StorageError("limit_exceeded", "Completed part ETag exceeds the portable limit", { operation: "object.complete_upload" });
  }
};

export const withOperationTimeout = async <T>(operation: string, options: OperationOptions | undefined, run: (signal: AbortSignal) => Promise<T>, settleAfterAbort = false): Promise<T> => {
  const controller = new AbortController();
  let timedOut = false;
  const abort = (): void => controller.abort(options?.signal?.reason ?? new Error("cancelled"));
  options?.signal?.addEventListener("abort", abort, { once: true });
  if (options?.signal?.aborted) abort();
  let timer: NodeJS.Timeout | undefined;
  if (options?.timeoutMs !== undefined) {
    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new StorageError("invalid_request", "timeoutMs must be positive", { operation });
    timer = setTimeout(() => { timedOut = true; controller.abort(new Error("timeout")); }, options.timeoutMs);
    timer.unref();
  }
  try {
    if (controller.signal.aborted) throw new StorageError(timedOut ? "timeout" : "cancelled", timedOut ? "Storage operation timed out" : "Operation was cancelled", { operation, retryable: timedOut });
    if (settleAfterAbort) return await run(controller.signal);
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new StorageError(timedOut ? "timeout" : "cancelled", timedOut ? "Storage operation timed out" : "Operation was cancelled", { operation, retryable: timedOut })), { once: true });
    });
    return await Promise.race([run(controller.signal), aborted]);
  } catch (error) {
    if (controller.signal.aborted && !settleAfterAbort) {
      throw new StorageError(timedOut ? "timeout" : "cancelled", timedOut ? "Storage operation timed out" : "Operation was cancelled", { operation, retryable: timedOut, cause: error });
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options?.signal?.removeEventListener("abort", abort);
  }
};

export const safeJsonParse = <T>(value: string, operation: string): T => {
  try {
    return JSON.parse(value) as T;
  } catch (cause) {
    throw new StorageError("internal", "Backend returned invalid stored JSON", { operation, cause });
  }
};
