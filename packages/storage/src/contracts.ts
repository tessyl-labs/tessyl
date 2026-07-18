export const STORAGE_INTERFACE_IDS = {
  document: "tessyl:storage/document@1",
  search: "tessyl:storage/search@1",
  searchIndex: "tessyl:storage/search-index@1",
  object: "tessyl:storage/object@1",
} as const;

export type StorageErrorCode =
  | "not_found"
  | "conflict"
  | "failed_condition"
  | "invalid_request"
  | "unavailable"
  | "quota_exceeded"
  | "limit_exceeded"
  | "timeout"
  | "cancelled"
  | "internal";

export interface StorageErrorDto {
  code: StorageErrorCode;
  message: string;
  retryable: boolean;
  operation: string;
  detailsJson: string;
}

export type StorageResult<T> =
  | { ok: true; value: T; error: StorageErrorDto }
  | { ok: false; value: T; error: StorageErrorDto };

export type PortableScalar = null | boolean | number | string;
export type IndexScalarType = "null" | "boolean" | "number" | "string";

export interface IndexFieldDefinition {
  path: string;
  type: IndexScalarType;
}

export interface IndexDefinition {
  name: string;
  fields: readonly IndexFieldDefinition[];
  unique: boolean;
  ordered: boolean;
  sparse: boolean;
}

export interface TableDefinition {
  name: string;
  schemaVersion: number;
  indexes: readonly IndexDefinition[];
}

export interface StoredDocument {
  namespace: string;
  table: string;
  key: string;
  version: string;
  bodyJson: string;
  createdAt: string;
  updatedAt: string;
}

export type WriteCondition =
  | { kind: "none" }
  | { kind: "absent" }
  | { kind: "present" }
  | { kind: "version_equals"; version: string };

export type DocumentMutation =
  | { kind: "put"; table: string; key: string; bodyJson: string; condition: WriteCondition }
  | { kind: "delete"; table: string; key: string; condition: WriteCondition };

export interface TransactionRequest {
  namespace: string;
  idempotencyKey: string;
  operations: readonly DocumentMutation[];
}

export interface TransactionResult {
  documents: readonly StoredDocument[];
  deletedKeys: readonly string[];
  replayed: boolean;
}

export interface IndexQuery {
  namespace: string;
  table: string;
  index: string;
  prefix: readonly PortableScalar[];
  lower?: readonly PortableScalar[];
  lowerInclusive?: boolean;
  upper?: readonly PortableScalar[];
  upperInclusive?: boolean;
  order: "asc" | "desc";
  limit: number;
  cursor?: string;
}

export interface DocumentPage {
  documents: readonly StoredDocument[];
  cursor?: string;
}

export interface TableInspection {
  definition: TableDefinition;
  definitionHash: string;
  documentCount: number;
}

export interface OutboxClaimRequest {
  namespace: string;
  table: string;
  workerId: string;
  now: string;
  leaseSeconds: number;
  limit: number;
}

export interface OutboxRecord {
  document: StoredDocument;
  leaseToken: string;
  attempt: number;
}

export interface DocumentStore {
  migrateTable(namespace: string, definition: TableDefinition, options?: OperationOptions): Promise<TableInspection>;
  inspectTable(namespace: string, table: string, options?: OperationOptions): Promise<TableInspection>;
  get(namespace: string, table: string, key: string, options?: OperationOptions): Promise<StoredDocument>;
  transact(request: TransactionRequest, options?: OperationOptions): Promise<TransactionResult>;
  query(request: IndexQuery, options?: OperationOptions): Promise<DocumentPage>;
  claimOutbox(request: OutboxClaimRequest, options?: OperationOptions): Promise<readonly OutboxRecord[]>;
  completeOutbox(namespace: string, table: string, key: string, leaseToken: string, options?: OperationOptions): Promise<void>;
  retryOutbox(namespace: string, table: string, key: string, leaseToken: string, availableAt: string, error: string, options?: OperationOptions): Promise<void>;
  health(options?: OperationOptions): Promise<HealthStatus>;
  close(): Promise<void>;
}

export interface SearchField {
  name: string;
  text: string;
}

export interface SearchFilterValue {
  name: string;
  value: PortableScalar;
}

export interface SearchDocument {
  namespace: string;
  index: string;
  documentId: string;
  version: string;
  fields: readonly SearchField[];
  filters: readonly SearchFilterValue[];
  tags: readonly string[];
  locale: string;
}

export interface SearchSchema {
  name: string;
  version: number;
  fields: readonly string[];
  filterFields: readonly string[];
  facetFields: readonly string[];
  locales: readonly string[];
}

export interface SearchFieldSelection {
  name: string;
  boost: number;
}

export interface SearchFilter {
  name: string;
  operator: "eq" | "neq";
  value: PortableScalar;
}

export interface SearchQuery {
  namespace: string;
  index: string;
  text: string;
  fields: readonly SearchFieldSelection[];
  filters: readonly SearchFilter[];
  tags: readonly string[];
  facets: readonly string[];
  locale: string;
  limit: number;
  cursor?: string;
}

export interface HighlightRange {
  start: number;
  end: number;
}

export interface SearchHighlight {
  field: string;
  text: string;
  ranges: readonly HighlightRange[];
}

export interface SearchHit {
  documentId: string;
  version: string;
  score: number;
  fields: readonly SearchField[];
  highlights: readonly SearchHighlight[];
}

export interface FacetBucket {
  value: string;
  count: number;
}

export interface SearchFacet {
  name: string;
  buckets: readonly FacetBucket[];
}

export interface SearchPage {
  hits: readonly SearchHit[];
  facets: readonly SearchFacet[];
  cursor?: string;
}

export interface SearchMutationResult {
  applied: boolean;
  currentVersion: string;
}

export interface SearchIndexInspection {
  namespace: string;
  logicalName: string;
  physicalName: string;
  schema: SearchSchema;
  generation: number;
  active: boolean;
}

export interface SearchGenerationPage {
  generations: readonly SearchIndexInspection[];
  cursor?: string;
}

export interface SearchService {
  query(request: SearchQuery, options?: OperationOptions): Promise<SearchPage>;
  health(options?: OperationOptions): Promise<HealthStatus>;
  close(): Promise<void>;
}

export interface SearchIndexService {
  create(namespace: string, schema: SearchSchema, options?: OperationOptions): Promise<SearchIndexInspection>;
  inspect(namespace: string, logicalName: string, options?: OperationOptions): Promise<SearchIndexInspection>;
  listGenerations(namespace: string, logicalName: string, limit: number, cursor?: string, options?: OperationOptions): Promise<SearchGenerationPage>;
  beginRebuild(namespace: string, schema: SearchSchema, options?: OperationOptions): Promise<SearchIndexInspection>;
  cutover(namespace: string, logicalName: string, physicalName: string, options?: OperationOptions): Promise<SearchIndexInspection>;
  deleteGeneration(namespace: string, physicalName: string, options?: OperationOptions): Promise<void>;
  upsert(document: SearchDocument, options?: OperationOptions): Promise<SearchMutationResult>;
  delete(namespace: string, index: string, documentId: string, version: string, options?: OperationOptions): Promise<SearchMutationResult>;
  health(options?: OperationOptions): Promise<HealthStatus>;
  close(): Promise<void>;
}

export interface ObjectMetadata {
  namespace: string;
  key: string;
  contentType: string;
  byteLength: string;
  checksumSha256: string;
  applicationMetadata: readonly MetadataEntry[];
  version: string;
  createdAt: string;
}

export interface MetadataEntry {
  name: string;
  value: string;
}

export interface UploadPart {
  partNumber: number;
  url: string;
}

export interface UploadSession {
  sessionId: string;
  namespace: string;
  key: string;
  expiresAt: string;
  uploadHandle: string;
  parts: readonly UploadPart[];
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface UploadRequest {
  namespace: string;
  key: string;
  contentType: string;
  byteLength: string;
  checksumSha256: string;
  applicationMetadata: readonly MetadataEntry[];
  idempotencyKey: string;
  partCount: number;
  expiresInSeconds: number;
}

export interface DownloadResolution {
  metadata: ObjectMetadata;
  url: string;
  expiresAt: string;
}

export interface ObjectStore {
  initiateUpload(request: UploadRequest, options?: OperationOptions): Promise<UploadSession>;
  completeUpload(namespace: string, sessionId: string, parts?: readonly CompletedPart[], options?: OperationOptions): Promise<ObjectMetadata>;
  stat(namespace: string, key: string, options?: OperationOptions): Promise<ObjectMetadata>;
  resolveDownload(namespace: string, key: string, expiresInSeconds: number, options?: OperationOptions): Promise<DownloadResolution>;
  delete(namespace: string, key: string, expectedVersion?: string, options?: OperationOptions): Promise<void>;
  cleanupAbandoned(namespace: string, before: string, limit: number, options?: OperationOptions): Promise<number>;
  health(options?: OperationOptions): Promise<HealthStatus>;
  close(): Promise<void>;
}

export interface StorageCapabilities {
  document?: DocumentStore;
  search?: SearchService;
  searchIndex?: SearchIndexService;
  object?: ObjectStore;
}

export interface StorageComposition {
  document: DocumentStore;
  search: SearchService;
  searchIndex: SearchIndexService;
  object: ObjectStore;
  health(options?: OperationOptions): Promise<readonly HealthStatus[]>;
  close(): Promise<void>;
}

export interface OperationOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface HealthStatus {
  capability: "document" | "search" | "search_index" | "object";
  ready: boolean;
  message: string;
  latencyMs: number;
}

export interface StorageLimits {
  maxNamespaceBytes: number;
  maxNameBytes: number;
  maxKeyBytes: number;
  maxDocumentBytes: number;
  maxTransactionOperations: number;
  maxIndexFields: number;
  maxIndexEntriesPerDocument: number;
  maxQueryBytes: number;
  maxResultCount: number;
  maxMetadataEntries: number;
  maxMetadataBytes: number;
  maxUploadBytes: number;
  maxUploadParts: number;
}

export const DEFAULT_STORAGE_LIMITS: Readonly<StorageLimits> = Object.freeze({
  maxNamespaceBytes: 256,
  maxNameBytes: 128,
  maxKeyBytes: 1_024,
  maxDocumentBytes: 1_048_576,
  maxTransactionOperations: 100,
  maxIndexFields: 4,
  maxIndexEntriesPerDocument: 32,
  maxQueryBytes: 16_384,
  maxResultCount: 100,
  maxMetadataEntries: 32,
  maxMetadataBytes: 8_192,
  maxUploadBytes: 5 * 1024 * 1024 * 1024,
  maxUploadParts: 10_000,
});

export interface ObservabilityEvent {
  operation: string;
  backend: "local" | "hosted";
  startedAt: number;
  durationMs: number;
  success: boolean;
  errorCode?: StorageErrorCode;
}

export type ObservabilityHook = (event: ObservabilityEvent) => void;
