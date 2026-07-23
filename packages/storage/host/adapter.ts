import { defineVoydPackageAdapter, type VoydPackageAdapterInvocationContext } from "@voyd-lang/package-adapter";
import { contract } from "../generated/contract.js";
import type { AdapterImplementation } from "../generated/voyd-adapter.js";
import type {
  CompletedPart,
  DocumentMutation,
  DocumentStore,
  IndexQuery,
  ObjectMetadata,
  ObjectStore,
  PortableScalar,
  SearchDocument,
  SearchIndexInspection,
  SearchIndexService,
  SearchPage,
  SearchQuery,
  SearchSchema,
  SearchService,
  StorageComposition,
  StoredDocument,
  TableDefinition,
  TransactionResult,
  UploadRequest,
} from "../src/contracts.js";
import { StorageError, asStorageError } from "../src/errors.js";
import {
  decodeVoydValue,
  parseStoredVoydValue,
  serializeVoydValue,
  type VoydValue,
} from "../src/wire.js";

type DocumentApi = AdapterImplementation["tessyl:storage/document@1"];
type SearchApi = AdapterImplementation["tessyl:storage/search@1"];
type SearchIndexApi = AdapterImplementation["tessyl:storage/search-index@1"];
type ObjectApi = AdapterImplementation["tessyl:storage/object@1"];
type Option<T> = { readonly tag: "None" } | { readonly tag: "Some"; readonly value: T };
type ErrorResult = Extract<Awaited<ReturnType<DocumentApi["get"]>>, { tag: "Err" }>;
type WireError = ErrorResult["error"];
type WireScalar = Parameters<DocumentApi["query_documents"]>[1]["prefix"][number]["value"];
type WireCondition = Parameters<DocumentApi["put"]>[1]["condition"];
type WireTableDefinition = Parameters<DocumentApi["migrate_table"]>[1];
type WireDocument = Extract<Awaited<ReturnType<DocumentApi["put"]>>, { tag: "Ok" }>["value"];

const none = <T>(): Option<T> => ({ tag: "None" });
const some = <T>(value: T): Option<T> => ({ tag: "Some", value });
const optional = <T>(value: T | undefined): Option<T> => value === undefined ? none<T>() : some(value);
const fromOptional = <T>(value: Option<T>): T | undefined => value.tag === "Some" ? value.value : undefined;
const unit = () => ({});

const errorCodeTags: Record<string, WireError["code"]["tag"]> = {
  not_found: "NotFound",
  conflict: "Conflict",
  failed_condition: "FailedCondition",
  invalid_request: "InvalidRequest",
  invalid_data: "InvalidData",
  unavailable: "Unavailable",
  quota_exceeded: "QuotaExceeded",
  limit_exceeded: "LimitExceeded",
  timeout: "Timeout",
  cancelled: "Cancelled",
  internal: "Internal",
};

const wireError = (error: unknown, operation: string): WireError => {
  const storageError = asStorageError(error, operation);
  return {
    code: { tag: errorCodeTags[storageError.code] ?? "Internal" },
    message: storageError.message,
    retryable: storageError.retryable,
    operation: storageError.operation,
    details: Object.entries(storageError.details).map(([name, value]) => ({
      name,
      value: typeof value === "string" ? value : JSON.stringify(value),
    })),
  };
};

const respond = async <T>(operation: string, run: () => Promise<T>) => {
  try {
    return { tag: "Ok" as const, value: await run() };
  } catch (error) {
    return { tag: "Err" as const, error: wireError(error, operation) };
  }
};

const respondOptional = async <T>(operation: string, run: () => Promise<T>) => {
  try {
    return { tag: "Ok" as const, value: some(await run()) };
  } catch (error) {
    const storageError = asStorageError(error, operation);
    if (storageError.code === "not_found") return { tag: "Ok" as const, value: none<T>() };
    return { tag: "Err" as const, error: wireError(storageError, operation) };
  }
};

const operationOptions = (context: VoydPackageAdapterInvocationContext) =>
  context.signal ? { signal: context.signal } : undefined;

const scalarFromWire = (value: WireScalar): PortableScalar => {
  switch (value.tag) {
    case "Null": return null;
    case "Boolean": return value.value;
    case "I32":
    case "F32":
    case "F64": return value.value;
    case "I64": return typeof value.value === "bigint" ? value.value : BigInt(value.value);
    case "Text": return value.value;
  }
};

const conditionFromWire = (condition: WireCondition) => {
  switch (condition.tag) {
    case "Any": return { kind: "none" as const };
    case "Absent": return { kind: "absent" as const };
    case "Present": return { kind: "present" as const };
    case "Version": return { kind: "version_equals" as const, version: condition.value };
  }
};

const indexTypeFromWire = (value: WireTableDefinition["indexes"][number]["fields"][number]["value_type"]): "null" | "boolean" | "number" | "string" => {
  switch (value.tag) {
    case "Null": return "null";
    case "Boolean": return "boolean";
    case "Number": return "number";
    case "Text": return "string";
  }
};

const indexTypeToWire = (value: "null" | "boolean" | "number" | "string") => ({
  tag: value === "null" ? "Null" : value === "boolean" ? "Boolean" : value === "number" ? "Number" : "Text",
} as const);

const tableDefinitionFromWire = (definition: WireTableDefinition): TableDefinition => ({
  name: definition.name,
  schemaVersion: definition.schema_version,
  indexes: definition.indexes.map((index) => ({
    name: index.name,
    fields: index.fields.map((field) => ({ path: field.path, type: indexTypeFromWire(field.value_type) })),
    unique: index.unique,
    ordered: index.ordered,
    sparse: index.sparse,
  })),
});

const tableDefinitionToWire = (definition: TableDefinition) => ({
  name: definition.name,
  schema_version: definition.schemaVersion,
  indexes: definition.indexes.map((index) => ({
    name: index.name,
    fields: index.fields.map((field) => ({ path: field.path, value_type: indexTypeToWire(field.type) })),
    unique: index.unique,
    ordered: index.ordered,
    sparse: index.sparse,
  })),
});

const documentToWire = (document: StoredDocument): WireDocument => ({
  namespace: document.namespace,
  table: document.table,
  key: document.key,
  version: document.version,
  value: parseStoredVoydValue(document.bodyJson),
  created_at: document.createdAt,
  updated_at: document.updatedAt,
});

const mutationFromWire = (mutation: Parameters<DocumentApi["transact"]>[1]["mutations"][number]): DocumentMutation => {
  const value = mutation.value;
  if (value.tag === "Delete") {
    return { kind: "delete", table: value.table, key: value.key, condition: conditionFromWire(value.condition) };
  }
  return {
    kind: "put",
    table: value.table,
    key: value.key,
    bodyJson: serializeVoydValue(value.value as unknown as VoydValue),
    condition: conditionFromWire(value.condition),
  };
};

const transactionToWire = (result: TransactionResult) => ({
  writes: result.documents.map((document) => ({ table: document.table, key: document.key, version: document.version })),
  deletes: result.deletedKeys,
  replayed: result.replayed,
});

const documentImplementation = (document: DocumentStore): DocumentApi => ({
  migrate_table(namespace, definition) {
    return respond("document.migrate_table", async () => {
      const inspection = await document.migrateTable(namespace, tableDefinitionFromWire(definition), operationOptions(this));
      return {
        definition: tableDefinitionToWire(inspection.definition),
        definition_hash: inspection.definitionHash,
        document_count: BigInt(inspection.documentCount),
      };
    });
  },
  inspect_table(namespace, table) {
    return respond("document.inspect_table", async () => {
      const inspection = await document.inspectTable(namespace, table, operationOptions(this));
      return {
        definition: tableDefinitionToWire(inspection.definition),
        definition_hash: inspection.definitionHash,
        document_count: BigInt(inspection.documentCount),
      };
    });
  },
  get(namespace, table, key) {
    return respondOptional("document.get", async () => documentToWire(await document.get(namespace, table, key, operationOptions(this))));
  },
  put(namespace, request) {
    return respond("document.put", async () => {
      const result = await document.transact({
        namespace,
        idempotencyKey: request.idempotency_key,
        operations: [{
          kind: "put",
          table: request.table,
          key: request.key,
          bodyJson: serializeVoydValue(request.value as unknown as VoydValue),
          condition: conditionFromWire(request.condition),
        }],
      }, operationOptions(this));
      const stored = result.documents[0];
      if (!stored) throw new StorageError("internal", "Put transaction returned no document", { operation: "document.put" });
      return documentToWire(stored);
    });
  },
  delete(namespace, request) {
    return respond("document.delete", async () => {
      await document.transact({
        namespace,
        idempotencyKey: request.idempotency_key,
        operations: [{ kind: "delete", table: request.table, key: request.key, condition: conditionFromWire(request.condition) }],
      }, operationOptions(this));
      return unit();
    });
  },
  transact(namespace, request) {
    return respond("document.transact", async () => {
      const operations = request.mutations.map(mutationFromWire);
      const result = await document.transact({ namespace, idempotencyKey: request.idempotency_key, operations }, operationOptions(this));
      return transactionToWire(result);
    });
  },
  query_documents(namespace, request) {
    return respond("document.query", async () => {
      const lower = fromOptional(request.lower);
      const upper = fromOptional(request.upper);
      const query: IndexQuery = {
        namespace,
        table: request.table,
        index: request.index,
        prefix: request.prefix.map((entry) => scalarFromWire(entry.value)),
        ...(lower ? { lower: lower.values.map((entry) => scalarFromWire(entry.value)), lowerInclusive: lower.inclusive } : {}),
        ...(upper ? { upper: upper.values.map((entry) => scalarFromWire(entry.value)), upperInclusive: upper.inclusive } : {}),
        order: request.order.tag === "Ascending" ? "asc" : "desc",
        limit: request.limit,
        ...(fromOptional(request.cursor) ? { cursor: fromOptional(request.cursor) } : {}),
      };
      const page = await document.query(query, operationOptions(this));
      return { documents: page.documents.map(documentToWire), cursor: optional(page.cursor) };
    });
  },
  claim_outbox(namespace, request) {
    return respond("document.claim_outbox", async () => {
      const records = await document.claimOutbox({
        namespace,
        table: request.table,
        workerId: request.worker_id,
        now: request.now,
        leaseSeconds: request.lease_seconds,
        limit: request.limit,
      }, operationOptions(this));
      return records.map((record) => ({
        document: documentToWire(record.document),
        lease_token: record.leaseToken,
        attempt: record.attempt,
      }));
    });
  },
  complete_outbox(namespace, request) {
    return respond("document.complete_outbox", async () => {
      await document.completeOutbox(namespace, request.table, request.key, request.lease_token, operationOptions(this));
      return unit();
    });
  },
  retry_outbox(namespace, request) {
    return respond("document.retry_outbox", async () => {
      await document.retryOutbox(namespace, request.table, request.key, request.lease_token, request.available_at, request.error, operationOptions(this));
      return unit();
    });
  },
});

const searchSchemaFromWire = (schema: Parameters<SearchIndexApi["create"]>[1]): SearchSchema => ({
  name: schema.name,
  version: schema.version,
  fields: schema.fields,
  filterFields: schema.filter_fields,
  facetFields: schema.facet_fields,
  locales: schema.locales,
});

const searchSchemaToWire = (schema: SearchSchema) => ({
  name: schema.name,
  version: schema.version,
  fields: schema.fields,
  filter_fields: schema.filterFields,
  facet_fields: schema.facetFields,
  locales: schema.locales,
});

const searchInspectionToWire = (inspection: SearchIndexInspection) => ({
  namespace: inspection.namespace,
  logical_name: inspection.logicalName,
  physical_name: inspection.physicalName,
  schema: searchSchemaToWire(inspection.schema),
  generation: inspection.generation,
  active: inspection.active,
});

const searchPageToWire = (page: SearchPage) => ({
  hits: page.hits.map((hit) => ({
    document_id: hit.documentId,
    version: hit.version,
    score: hit.score,
    fields: hit.fields,
    highlights: hit.highlights.map((highlight) => ({ field: highlight.field, text: highlight.text, ranges: highlight.ranges })),
  })),
  facets: page.facets.map((facet) => ({
    name: facet.name,
    buckets: facet.buckets.map((bucket) => ({ value: bucket.value, count: BigInt(bucket.count) })),
  })),
  cursor: optional(page.cursor),
});

const searchImplementation = (search: SearchService): SearchApi => ({
  search(namespace, request) {
    return respond("search.query", async () => {
      const query: SearchQuery = {
        namespace,
        index: request.index,
        text: request.text,
        fields: request.fields,
        filters: request.filters.map(({ value: filter }) => ({
          name: filter.name,
          operator: filter.tag === "Equal" ? "eq" : "neq",
          value: scalarFromWire(filter.value),
        })),
        tags: request.tags,
        facets: request.facets,
        locale: request.locale,
        limit: request.limit,
        ...(fromOptional(request.cursor) ? { cursor: fromOptional(request.cursor) } : {}),
      };
      return searchPageToWire(await search.query(query, operationOptions(this)));
    });
  },
});

const searchIndexImplementation = (searchIndex: SearchIndexService): SearchIndexApi => ({
  create(namespace, schema) {
    return respond("search_index.create", async () => searchInspectionToWire(await searchIndex.create(namespace, searchSchemaFromWire(schema), operationOptions(this))));
  },
  inspect(namespace, logicalName) {
    return respondOptional("search_index.inspect", async () => searchInspectionToWire(await searchIndex.inspect(namespace, logicalName, operationOptions(this))));
  },
  list_generations(namespace, request) {
    return respond("search_index.list_generations", async () => {
      const page = await searchIndex.listGenerations(namespace, request.logical_name, request.limit, fromOptional(request.cursor), operationOptions(this));
      return { generations: page.generations.map(searchInspectionToWire), cursor: optional(page.cursor) };
    });
  },
  begin_rebuild(namespace, schema) {
    return respond("search_index.begin_rebuild", async () => searchInspectionToWire(await searchIndex.beginRebuild(namespace, searchSchemaFromWire(schema), operationOptions(this))));
  },
  cutover(namespace, request) {
    return respond("search_index.cutover", async () => searchInspectionToWire(await searchIndex.cutover(namespace, request.logical_name, request.physical_name, operationOptions(this))));
  },
  delete_generation(namespace, physicalName) {
    return respond("search_index.delete_generation", async () => {
      await searchIndex.deleteGeneration(namespace, physicalName, operationOptions(this));
      return unit();
    });
  },
  upsert(namespace, wireDocument) {
    return respond("search_index.upsert", async () => {
      const document: SearchDocument = {
        namespace,
        index: wireDocument.index,
        documentId: wireDocument.document_id,
        version: wireDocument.version,
        fields: wireDocument.fields,
        filters: wireDocument.filters.map((filter) => ({ name: filter.name, value: scalarFromWire(filter.value) })),
        tags: wireDocument.tags,
        locale: wireDocument.locale,
      };
      const result = await searchIndex.upsert(document, operationOptions(this));
      return { applied: result.applied, current_version: result.currentVersion };
    });
  },
  delete_document(namespace, request) {
    return respond("search_index.delete", async () => {
      const result = await searchIndex.delete(namespace, request.index, request.document_id, request.version, operationOptions(this));
      return { applied: result.applied, current_version: result.currentVersion };
    });
  },
});

const metadataToWire = (metadata: ObjectMetadata) => ({
  namespace: metadata.namespace,
  key: metadata.key,
  content_type: metadata.contentType,
  byte_length: BigInt(metadata.byteLength),
  checksum_sha256: metadata.checksumSha256,
  metadata: metadata.applicationMetadata,
  version: metadata.version,
  created_at: metadata.createdAt,
});

const objectImplementation = (object: ObjectStore): ObjectApi => ({
  initiate_upload(namespace, request) {
    return respond("object.initiate_upload", async () => {
      const upload: UploadRequest = {
        namespace,
        key: request.key,
        contentType: request.content_type,
        byteLength: String(request.byte_length),
        checksumSha256: request.checksum_sha256,
        applicationMetadata: request.metadata,
        idempotencyKey: request.idempotency_key,
        partCount: request.part_count,
        expiresInSeconds: request.expires_in_seconds,
      };
      const session = await object.initiateUpload(upload, operationOptions(this));
      return {
        session_id: session.sessionId,
        namespace: session.namespace,
        key: session.key,
        expires_at: session.expiresAt,
        upload_handle: session.uploadHandle,
        parts: session.parts.map((part) => ({ part_number: part.partNumber, url: part.url })),
      };
    });
  },
  complete_upload(namespace, request) {
    return respond("object.complete_upload", async () => {
      const parts: CompletedPart[] = request.parts.map((part) => ({ partNumber: part.part_number, etag: part.etag }));
      return metadataToWire(await object.completeUpload(namespace, request.session_id, parts, operationOptions(this)));
    });
  },
  stat(namespace, key) {
    return respondOptional("object.stat", async () => metadataToWire(await object.stat(namespace, key, operationOptions(this))));
  },
  resolve_download(namespace, request) {
    return respond("object.resolve_download", async () => {
      const resolution = await object.resolveDownload(namespace, request.key, request.expires_in_seconds, operationOptions(this));
      return { metadata: metadataToWire(resolution.metadata), url: resolution.url, expires_at: resolution.expiresAt };
    });
  },
  delete_object(namespace, request) {
    return respond("object.delete", async () => {
      await object.delete(namespace, request.key, fromOptional(request.expected_version), operationOptions(this));
      return unit();
    });
  },
  cleanup_abandoned(namespace, request) {
    return respond("object.cleanup_abandoned", () => object.cleanupAbandoned(namespace, request.before, request.limit, operationOptions(this)));
  },
});

type Providers = {
  document?: DocumentStore;
  search?: SearchService;
  searchIndex?: SearchIndexService;
  object?: ObjectStore;
};

const implementations = (storage: Providers): Partial<AdapterImplementation> => ({
  ...(storage.document ? { "tessyl:storage/document@1": documentImplementation(storage.document) } : {}),
  ...(storage.search ? { "tessyl:storage/search@1": searchImplementation(storage.search) } : {}),
  ...(storage.searchIndex ? { "tessyl:storage/search-index@1": searchIndexImplementation(storage.searchIndex) } : {}),
  ...(storage.object ? { "tessyl:storage/object@1": objectImplementation(storage.object) } : {}),
});

const createCapabilityAdapter = (storage: Providers) => {
  const implementation = implementations(storage);
  const ids = new Set(Object.keys(implementation));
  return defineVoydPackageAdapter(
    {
      ...contract,
      functions: contract.functions.filter(({ interfaceId }) => ids.has(interfaceId)),
      interfaces: contract.interfaces.filter(({ interfaceId }) => ids.has(interfaceId)),
    },
    implementation as AdapterImplementation,
  );
};

/** Full-composition convenience adapter. Use a capability factory for least authority. */
export const createStorageAdapter = (storage: StorageComposition) => createCapabilityAdapter(storage);
export const createDocumentStorageAdapter = (document: DocumentStore) => createCapabilityAdapter({ document });
export const createSearchStorageAdapter = (search: SearchService) => createCapabilityAdapter({ search });
export const createSearchIndexStorageAdapter = (searchIndex: SearchIndexService) => createCapabilityAdapter({ searchIndex });
export const createObjectStorageAdapter = (object: ObjectStore) => createCapabilityAdapter({ object });

export default createStorageAdapter;
