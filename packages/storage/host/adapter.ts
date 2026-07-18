import { defineVoydPackageAdapter, type VoydPackageAdapterInvocationContext } from "@voyd-lang/package-adapter";
import { contract } from "../generated/contract.js";
import type {
  CompletedPart,
  IndexQuery,
  OutboxClaimRequest,
  SearchDocument,
  SearchQuery,
  SearchSchema,
  DocumentStore,
  ObjectStore,
  SearchIndexService,
  SearchService,
  StorageComposition,
  TableDefinition,
  TransactionRequest,
  UploadRequest,
} from "../src/contracts.js";
import { StorageError, asStorageError, emptyErrorDto } from "../src/errors.js";
import { DEFAULT_STORAGE_LIMITS } from "../src/contracts.js";

type AdapterResponse = {
  ok: boolean;
  valueJson: string;
  error: ReturnType<StorageError["toDto"]>;
};

const MAX_ADAPTER_RESPONSE_BYTES = 3 * 1024 * 1024;

const parseRequest = <T>(value: string, operation: string, array = false): T => {
  if (new TextEncoder().encode(value).byteLength > DEFAULT_STORAGE_LIMITS.maxDocumentBytes * 2) throw new StorageError("limit_exceeded", "Adapter request exceeds the portable boundary limit", { operation });
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) !== array) throw new StorageError("invalid_request", `Adapter request must be a JSON ${array ? "array" : "object"}`, { operation });
    return parsed as T;
  } catch (cause) {
    throw new StorageError("invalid_request", "Adapter request is not valid JSON", { operation, cause });
  }
};

const respond = async <T>(operation: string, run: () => Promise<T>): Promise<AdapterResponse> => {
  try {
    const value = await run();
    const valueJson = JSON.stringify(value ?? null);
    if (new TextEncoder().encode(valueJson).byteLength > MAX_ADAPTER_RESPONSE_BYTES) throw new StorageError("limit_exceeded", "Storage response exceeds the Voyd adapter transport limit; request a smaller page", { operation });
    return { ok: true, valueJson, error: emptyErrorDto() };
  } catch (error) {
    return { ok: false, valueJson: "null", error: asStorageError(error, operation).toDto() };
  }
};

type Providers = { document?: DocumentStore; search?: SearchService; searchIndex?: SearchIndexService; object?: ObjectStore };
const operationOptions = (context: VoydPackageAdapterInvocationContext) => context.signal ? { signal: context.signal } : undefined;

const implementations = (storage: Providers) => ({
  ...(storage.document ? { "tessyl:storage/document@1": {
    migrate_table(this: VoydPackageAdapterInvocationContext, namespace: string, definitionJson: string) { return respond("document.migrate_table", () => storage.document!.migrateTable(namespace, parseRequest<TableDefinition>(definitionJson, "document.migrate_table"), operationOptions(this))); },
    inspect_table(this: VoydPackageAdapterInvocationContext, namespace: string, table: string) { return respond("document.inspect_table", () => storage.document!.inspectTable(namespace, table, operationOptions(this))); },
    get(this: VoydPackageAdapterInvocationContext, namespace: string, table: string, key: string) { return respond("document.get", () => storage.document!.get(namespace, table, key, operationOptions(this))); },
    transact(this: VoydPackageAdapterInvocationContext, namespace: string, requestJson: string) { return respond("document.transact", () => storage.document!.transact({ ...parseRequest<TransactionRequest>(requestJson, "document.transact"), namespace }, operationOptions(this))); },
    query_documents(this: VoydPackageAdapterInvocationContext, namespace: string, requestJson: string) { return respond("document.query", () => storage.document!.query({ ...parseRequest<IndexQuery>(requestJson, "document.query"), namespace }, operationOptions(this))); },
    claim_outbox(this: VoydPackageAdapterInvocationContext, namespace: string, requestJson: string) { return respond("document.claim_outbox", () => storage.document!.claimOutbox({ ...parseRequest<OutboxClaimRequest>(requestJson, "document.claim_outbox"), namespace }, operationOptions(this))); },
    complete_outbox(this: VoydPackageAdapterInvocationContext, namespace: string, table: string, key: string, leaseToken: string) { return respond("document.complete_outbox", () => storage.document!.completeOutbox(namespace, table, key, leaseToken, operationOptions(this))); },
    retry_outbox(this: VoydPackageAdapterInvocationContext, namespace: string, table: string, key: string, leaseToken: string, availableAt: string, error: string) { return respond("document.retry_outbox", () => storage.document!.retryOutbox(namespace, table, key, leaseToken, availableAt, error, operationOptions(this))); },
  } } : {}),
  ...(storage.search ? { "tessyl:storage/search@1": {
    search(this: VoydPackageAdapterInvocationContext, namespace: string, requestJson: string) { return respond("search.query", () => storage.search!.query({ ...parseRequest<SearchQuery>(requestJson, "search.query"), namespace }, operationOptions(this))); },
  } } : {}),
  ...(storage.searchIndex ? { "tessyl:storage/search-index@1": {
    create(this: VoydPackageAdapterInvocationContext, namespace: string, schemaJson: string) { return respond("search_index.create", () => storage.searchIndex!.create(namespace, parseRequest<SearchSchema>(schemaJson, "search_index.create"), operationOptions(this))); },
    inspect(this: VoydPackageAdapterInvocationContext, namespace: string, logicalName: string) { return respond("search_index.inspect", () => storage.searchIndex!.inspect(namespace, logicalName, operationOptions(this))); },
    list_generations(this: VoydPackageAdapterInvocationContext, namespace: string, logicalName: string, limit: number, cursor: string) { return respond("search_index.list_generations", () => storage.searchIndex!.listGenerations(namespace, logicalName, limit, cursor || undefined, operationOptions(this))); },
    begin_rebuild(this: VoydPackageAdapterInvocationContext, namespace: string, schemaJson: string) { return respond("search_index.begin_rebuild", () => storage.searchIndex!.beginRebuild(namespace, parseRequest<SearchSchema>(schemaJson, "search_index.begin_rebuild"), operationOptions(this))); },
    cutover(this: VoydPackageAdapterInvocationContext, namespace: string, logicalName: string, physicalName: string) { return respond("search_index.cutover", () => storage.searchIndex!.cutover(namespace, logicalName, physicalName, operationOptions(this))); },
    delete_generation(this: VoydPackageAdapterInvocationContext, namespace: string, physicalName: string) { return respond("search_index.delete_generation", () => storage.searchIndex!.deleteGeneration(namespace, physicalName, operationOptions(this))); },
    upsert(this: VoydPackageAdapterInvocationContext, namespace: string, documentJson: string) { return respond("search_index.upsert", () => storage.searchIndex!.upsert({ ...parseRequest<SearchDocument>(documentJson, "search_index.upsert"), namespace }, operationOptions(this))); },
    delete_document(this: VoydPackageAdapterInvocationContext, namespace: string, index: string, documentId: string, version: string) { return respond("search_index.delete", () => storage.searchIndex!.delete(namespace, index, documentId, version, operationOptions(this))); },
  } } : {}),
  ...(storage.object ? { "tessyl:storage/object@1": {
    initiate_upload(this: VoydPackageAdapterInvocationContext, namespace: string, requestJson: string) { return respond("object.initiate_upload", () => storage.object!.initiateUpload({ ...parseRequest<UploadRequest>(requestJson, "object.initiate_upload"), namespace }, operationOptions(this))); },
    complete_upload(this: VoydPackageAdapterInvocationContext, namespace: string, sessionId: string, partsJson: string) { return respond("object.complete_upload", () => storage.object!.completeUpload(namespace, sessionId, parseRequest<CompletedPart[]>(partsJson || "[]", "object.complete_upload", true), operationOptions(this))); },
    stat(this: VoydPackageAdapterInvocationContext, namespace: string, key: string) { return respond("object.stat", () => storage.object!.stat(namespace, key, operationOptions(this))); },
    resolve_download(this: VoydPackageAdapterInvocationContext, namespace: string, key: string, expiresInSeconds: number) { return respond("object.resolve_download", () => storage.object!.resolveDownload(namespace, key, expiresInSeconds, operationOptions(this))); },
    delete_object(this: VoydPackageAdapterInvocationContext, namespace: string, key: string, expectedVersion: string) { return respond("object.delete", () => storage.object!.delete(namespace, key, expectedVersion || undefined, operationOptions(this))); },
    cleanup_abandoned(this: VoydPackageAdapterInvocationContext, namespace: string, before: string, limit: number) { return respond("object.cleanup_abandoned", () => storage.object!.cleanupAbandoned(namespace, before, limit, operationOptions(this))); },
  } } : {}),
});

const createCapabilityAdapter = (storage: Providers) => {
  const implementation = implementations(storage);
  const ids = new Set(Object.keys(implementation));
  return defineVoydPackageAdapter({ ...contract, functions: contract.functions.filter(({ interfaceId }) => ids.has(interfaceId)), interfaces: contract.interfaces.filter(({ interfaceId }) => ids.has(interfaceId)) }, implementation);
};

/** Full-composition convenience adapter. Use a capability factory for least authority. */
export const createStorageAdapter = (storage: StorageComposition) => createCapabilityAdapter(storage);
export const createDocumentStorageAdapter = (document: DocumentStore) => createCapabilityAdapter({ document });
export const createSearchStorageAdapter = (search: SearchService) => createCapabilityAdapter({ search });
export const createSearchIndexStorageAdapter = (searchIndex: SearchIndexService) => createCapabilityAdapter({ searchIndex });
export const createObjectStorageAdapter = (object: ObjectStore) => createCapabilityAdapter({ object });

export default createStorageAdapter;
