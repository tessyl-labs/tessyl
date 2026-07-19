import { createHash } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
  type S3ClientConfig,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Client as OpenSearchClient, type ClientOptions as OpenSearchClientOptions } from "@opensearch-project/opensearch";
import pg, { type Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import {
  type CompletedPart,
  type DocumentPage,
  type DocumentStore,
  type DownloadResolution,
  type HealthStatus,
  type IndexDefinition,
  type IndexQuery,
  type MetadataEntry,
  type ObjectMetadata,
  type ObjectStore,
  type ObservabilityHook,
  type OperationOptions,
  type OutboxClaimRequest,
  type OutboxRecord,
  type PortableScalar,
  type SearchDocument,
  type SearchFacet,
  type SearchField,
  type SearchGenerationPage,
  type SearchHighlight,
  type SearchIndexInspection,
  type SearchIndexService,
  type SearchMutationResult,
  type SearchPage,
  type SearchQuery,
  type SearchSchema,
  type SearchService,
  type StorageComposition,
  type StorageLimits,
  type StoredDocument,
  type TableDefinition,
  type TableInspection,
  type TransactionRequest,
  type TransactionResult,
  type UploadRequest,
  type UploadSession,
  type WriteCondition,
} from "../src/contracts.js";
import { StorageError, asStorageError } from "../src/errors.js";
import { attachStorageOwner } from "../src/composition.js";
import {
  assertKey,
  assertLeaseToken,
  assertName,
  assertNamespace,
  assertPortableString,
  assertSessionId,
  canonicalJson,
  compareUtf8,
  decodeCursor,
  definitionHash,
  encodeCursor,
  encodeIndexValues,
  extractIndexValues,
  MAX_OUTBOX_LEASE_SECONDS,
  mergeLimits,
  parsePortableDocument,
  positiveInteger,
  safeJsonParse,
  utf8Bytes,
  validateSearchDocument,
  validateSearchQuery,
  validateSearchSchema,
  validateCompletedParts,
  validateIndexQuery,
  validateTableDefinition,
  validateTransactionRequest,
  validateUploadRequest,
  withOperationTimeout,
} from "../src/validation.js";

export interface HostedStorageOptions {
  postgres: Pool | PoolConfig;
  openSearch: OpenSearchClient | OpenSearchClientOptions;
  s3: S3Client | S3ClientConfig;
  bucket: string;
  keyPrefix?: string;
  limits?: Partial<StorageLimits>;
  observability?: ObservabilityHook;
  maxConcurrency?: number;
  retryAttempts?: number;
  allowBlockingMigrations?: boolean;
}

type PgRow = QueryResultRow & Record<string, unknown>;

class Semaphore {
  #active = 0;
  readonly #waiting: Array<() => void> = [];
  constructor(readonly maximum: number) {}
  async use<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    if (this.#active >= this.maximum) await new Promise<void>((resolve, reject) => {
      const wake = (): void => { signal.removeEventListener("abort", onAbort); resolve(); };
      const onAbort = (): void => { const index = this.#waiting.indexOf(wake); if (index >= 0) this.#waiting.splice(index, 1); reject(this.abortError(signal)); };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#waiting.push(wake);
    });
    if (signal.aborted) { this.#waiting.shift()?.(); throw this.abortError(signal); }
    this.#active += 1;
    try { return await run(); }
    finally { this.#active -= 1; this.#waiting.shift()?.(); }
  }

  private abortError(signal: AbortSignal): StorageError {
    const timedOut = signal.reason instanceof Error && signal.reason.message === "timeout";
    return new StorageError(timedOut ? "timeout" : "cancelled", timedOut ? "Storage operation timed out" : "Operation was cancelled", { operation: "hosted.concurrency", retryable: timedOut, cause: signal.reason });
  }
}

const MUTATING_OPERATIONS = new Set([
  "document.migrate_table", "document.transact", "document.claim_outbox", "document.complete_outbox", "document.retry_outbox",
  "search_index.create", "search_index.begin_rebuild", "search_index.cutover", "search_index.delete_generation", "search_index.upsert", "search_index.delete",
  "object.initiate_upload", "object.complete_upload", "object.delete", "object.cleanup_abandoned",
]);

abstract class HostedService {
  constructor(
    protected readonly limits: Readonly<StorageLimits>,
    private readonly capability: HealthStatus["capability"],
    private readonly semaphore: Semaphore,
    protected readonly observe?: ObservabilityHook,
  ) {}

  protected async operation<T>(name: string, options: OperationOptions | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      const mutating = MUTATING_OPERATIONS.has(name);
      const value = await withOperationTimeout(name, options, (signal) => this.semaphore.use(signal, () => run(mutating ? new AbortController().signal : signal)), mutating);
      try { this.observe?.({ operation: name, backend: "hosted", startedAt, durationMs: Date.now() - startedAt, success: true }); } catch { /* telemetry cannot alter storage outcomes */ }
      return value;
    } catch (error) {
      const mapped = mapHostedError(error, name);
      try { this.observe?.({ operation: name, backend: "hosted", startedAt, durationMs: Date.now() - startedAt, success: false, errorCode: mapped.code }); } catch { /* preserve the storage error */ }
      throw mapped;
    }
  }

  abstract health(options?: OperationOptions): Promise<HealthStatus>;
  abstract close(): Promise<void>;
}

const mapHostedError = (error: unknown, operation: string): StorageError => {
  if (error instanceof StorageError) return error;
  const candidate = error as { code?: string; statusCode?: number; name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  const statusCode = candidate.statusCode ?? candidate.$metadata?.httpStatusCode;
  if (candidate.code === "23505" || statusCode === 409) return new StorageError("conflict", "Storage constraint conflict", { operation, cause: error, retryable: false });
  if (/^08/.test(candidate.code ?? "") || ["40001", "40P01", "53300", "57P01", "57P02", "57P03", "ECONNREFUSED", "ECONNRESET", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "SlowDown", "ServiceUnavailable", "Throttling", "ThrottlingException"].includes(candidate.code ?? candidate.name ?? "") || candidate.name === "NetworkingError" || candidate.name === "ConnectionError" || statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504) return new StorageError("unavailable", "Storage backend is temporarily unavailable", { operation, cause: error, retryable: true });
  if (["57014", "ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(candidate.code ?? "") || candidate.name === "TimeoutError") return new StorageError("timeout", "Storage backend timed out", { operation, cause: error, retryable: true });
  if (candidate.name === "AbortError") return new StorageError("cancelled", "Storage operation was cancelled", { operation, cause: error, retryable: false });
  return asStorageError(error, operation);
};
type AbortableRequest<T> = Promise<T> & { abort(): void };
const openSearchRequest = async <T>(signal: AbortSignal, request: AbortableRequest<T>): Promise<T> => { const abort = (): void => request.abort(); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); try { return await request; } finally { signal.removeEventListener("abort", abort); } };

const asStoredDocument = (row: PgRow): StoredDocument => ({
  namespace: String(row.namespace), table: String(row.table_name), key: String(row.document_key), version: String(row.version), bodyJson: typeof row.body_json === "string" ? row.body_json : JSON.stringify(row.body_json), createdAt: new Date(row.created_at as string).toISOString(), updatedAt: new Date(row.updated_at as string).toISOString(),
});
const configurePgTimeout = async (client: PoolClient, options?: OperationOptions): Promise<void> => {
  if (options?.timeoutMs !== undefined) await client.query("SELECT set_config('statement_timeout',$1,true)", [String(Math.max(1, Math.floor(options.timeoutMs)))]);
};
const acquirePgClient = async (pool: Pool, signal: AbortSignal): Promise<PoolClient> => {
  if (signal.aborted) throw signal.reason;
  return new Promise<PoolClient>((resolve, reject) => {
    let settled = false;
    const abort = (): void => { if (!settled) { settled = true; reject(signal.reason); } };
    signal.addEventListener("abort", abort, { once: true });
    void pool.connect().then((client) => {
      signal.removeEventListener("abort", abort);
      if (settled || signal.aborted) client.release();
      else { settled = true; resolve(client); }
    }, (error: unknown) => {
      signal.removeEventListener("abort", abort);
      if (!settled) { settled = true; reject(error); }
    });
  });
};
const bindPgAbort = (client: PoolClient, signal: AbortSignal): (() => void) => {
  let destroyed = false;
  const abort = (): void => { if (!destroyed) { destroyed = true; client.release(true); } };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return () => { signal.removeEventListener("abort", abort); if (!destroyed) { destroyed = true; client.release(); } };
};

const pgMigrations = `
  CREATE TABLE IF NOT EXISTS tessyl_storage_table_definitions (
    namespace text NOT NULL, table_name text NOT NULL, schema_version integer NOT NULL,
    definition_hash text NOT NULL, definition_json jsonb NOT NULL,
    PRIMARY KEY(namespace, table_name)
  );
  CREATE TABLE IF NOT EXISTS tessyl_storage_documents (
    namespace text NOT NULL, table_name text NOT NULL, document_key text NOT NULL,
    version bigint NOT NULL, body_json jsonb NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
    PRIMARY KEY(namespace, table_name, document_key),
    FOREIGN KEY(namespace, table_name) REFERENCES tessyl_storage_table_definitions(namespace, table_name)
  );
  CREATE TABLE IF NOT EXISTS tessyl_storage_document_versions (
    namespace text NOT NULL, table_name text NOT NULL, document_key text NOT NULL, version bigint NOT NULL,
    PRIMARY KEY(namespace, table_name, document_key)
  );
  INSERT INTO tessyl_storage_document_versions(namespace,table_name,document_key,version)
    SELECT namespace,table_name,document_key,version FROM tessyl_storage_documents ON CONFLICT DO NOTHING;
  CREATE TABLE IF NOT EXISTS tessyl_storage_index_entries (
    namespace text NOT NULL, table_name text NOT NULL, index_name text NOT NULL,
    sort_key text COLLATE "C" NOT NULL, values_json jsonb NOT NULL, document_key text NOT NULL,
    PRIMARY KEY(namespace, table_name, index_name, document_key),
    FOREIGN KEY(namespace, table_name, document_key) REFERENCES tessyl_storage_documents(namespace, table_name, document_key) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS tessyl_storage_index_lookup ON tessyl_storage_index_entries(namespace, table_name, index_name, sort_key, document_key);
  CREATE TABLE IF NOT EXISTS tessyl_storage_search_generation_counters (
    namespace text NOT NULL, logical_name text NOT NULL, generation integer NOT NULL,
    PRIMARY KEY(namespace, logical_name)
  );
  CREATE TABLE IF NOT EXISTS tessyl_storage_idempotency (
    namespace text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
    response_json jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(namespace, idempotency_key)
  );
  CREATE TABLE IF NOT EXISTS tessyl_storage_upload_sessions (
    session_id text PRIMARY KEY, namespace text NOT NULL, object_key text NOT NULL,
    content_type text NOT NULL, byte_length bigint NOT NULL, checksum_sha256 text NOT NULL,
    metadata_json jsonb NOT NULL, idempotency_key text NOT NULL, backend_upload_id text NOT NULL,
    backend_key text NOT NULL, expires_at timestamptz NOT NULL, completed boolean NOT NULL DEFAULT false,
    version text, backend_version_id text, request_hash text NOT NULL, part_count integer NOT NULL, operation_state text, operation_token text, operation_started_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(namespace, idempotency_key)
  );
  ALTER TABLE tessyl_storage_upload_sessions ADD COLUMN IF NOT EXISTS request_hash text NOT NULL DEFAULT '';
  ALTER TABLE tessyl_storage_upload_sessions ADD COLUMN IF NOT EXISTS part_count integer NOT NULL DEFAULT 1;
  ALTER TABLE tessyl_storage_upload_sessions ADD COLUMN IF NOT EXISTS operation_state text;
  ALTER TABLE tessyl_storage_upload_sessions ADD COLUMN IF NOT EXISTS operation_token text;
  ALTER TABLE tessyl_storage_upload_sessions ADD COLUMN IF NOT EXISTS operation_started_at timestamptz;
  ALTER TABLE tessyl_storage_upload_sessions ADD COLUMN IF NOT EXISTS backend_version_id text;
  CREATE TABLE IF NOT EXISTS tessyl_storage_object_keys (
    namespace text NOT NULL, object_key text NOT NULL, session_id text NOT NULL,
    PRIMARY KEY(namespace, object_key), UNIQUE(session_id)
  );
`;
const PG_MIGRATION_ID = 5;
const PG_MIGRATION_CHECKSUM = createHash("sha256").update(pgMigrations).digest("hex");

const assertCondition = (condition: WriteCondition, current: PgRow | undefined, operation: string): void => {
  if (condition.kind === "absent" && current) throw new StorageError("failed_condition", "Document already exists", { operation });
  if (condition.kind === "present" && !current) throw new StorageError("failed_condition", "Document does not exist", { operation });
  if (condition.kind === "version_equals" && (!current || String(current.version) !== condition.version)) throw new StorageError("failed_condition", "Document version does not match", { operation, details: { expectedVersion: condition.version, actualVersion: current ? String(current.version) : null } });
};

export class HostedDocumentStore extends HostedService implements DocumentStore {
  constructor(readonly pool: Pool, limits: Readonly<StorageLimits>, semaphore: Semaphore, observe?: ObservabilityHook, private readonly retryAttempts = 3, private readonly ownsPool = false, private readonly allowBlockingMigrations = false) { super(limits, "document", semaphore, observe); }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('tessyl_storage_schema'))");
      await client.query("CREATE TABLE IF NOT EXISTS tessyl_storage_migrations(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
      const newest = Number((await client.query<PgRow>("SELECT COALESCE(MAX(version),0) AS version FROM tessyl_storage_migrations")).rows[0]!.version);
      if (newest > PG_MIGRATION_ID) throw new StorageError("conflict", "Hosted storage database is newer than this binary", { operation: "hosted.initialize" });
      const applied = (await client.query<PgRow>("SELECT checksum FROM tessyl_storage_migrations WHERE version=$1", [PG_MIGRATION_ID])).rows[0];
      if (applied && String(applied.checksum) !== PG_MIGRATION_CHECKSUM) throw new StorageError("conflict", "Hosted storage migration checksum mismatch", { operation: "hosted.initialize" });
      if (!applied) { await client.query(pgMigrations); await client.query("INSERT INTO tessyl_storage_migrations(version,checksum) VALUES($1,$2)", [PG_MIGRATION_ID, PG_MIGRATION_CHECKSUM]); }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async migrateTable(namespace: string, definition: TableDefinition, options?: OperationOptions): Promise<TableInspection> {
    return this.operation("document.migrate_table", options, async (signal) => {
      assertNamespace(namespace, this.limits); validateTableDefinition(definition, this.limits); const hash = definitionHash(definition);
      const client = await acquirePgClient(this.pool, signal); const release = bindPgAbort(client, signal);
      try {
        await client.query("BEGIN"); await configurePgTimeout(client, options); await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [namespace, definition.name]);
        const existing = (await client.query<PgRow>("SELECT * FROM tessyl_storage_table_definitions WHERE namespace=$1 AND table_name=$2 FOR UPDATE", [namespace, definition.name])).rows[0];
        if (existing && String(existing.definition_hash) === hash) { await client.query("COMMIT"); return await this.inspectTableInternal(namespace, definition.name, client); }
        if (existing && Number(existing.schema_version) >= definition.schemaVersion) throw new StorageError("conflict", "Index definition changed without a higher schemaVersion", { operation: "document.migrate_table" });
        if (existing && !this.allowBlockingMigrations) {
          const count = Number((await client.query<PgRow>("SELECT COUNT(*) AS count FROM tessyl_storage_documents WHERE namespace=$1 AND table_name=$2", [namespace, definition.name])).rows[0]!.count);
          if (count > 0) throw new StorageError("failed_condition", "Populated hosted table migrations require explicit maintenance mode", { operation: "document.migrate_table", details: { documentCount: count } });
        }
        await client.query(`INSERT INTO tessyl_storage_table_definitions(namespace,table_name,schema_version,definition_hash,definition_json) VALUES($1,$2,$3,$4,$5::jsonb)
          ON CONFLICT(namespace,table_name) DO UPDATE SET schema_version=excluded.schema_version,definition_hash=excluded.definition_hash,definition_json=excluded.definition_json`, [namespace, definition.name, definition.schemaVersion, hash, canonicalJson(definition)]);
        if (existing) {
          await client.query("DELETE FROM tessyl_storage_index_entries WHERE namespace=$1 AND table_name=$2", [namespace, definition.name]);
          let after = "";
          for (;;) {
            const documents = (await client.query<PgRow>("SELECT * FROM tessyl_storage_documents WHERE namespace=$1 AND table_name=$2 AND document_key>$3 ORDER BY document_key LIMIT 500", [namespace, definition.name, after])).rows;
            for (const document of documents) await this.writeIndexEntries(client, namespace, definition, String(document.document_key), parsePortableDocument(JSON.stringify(document.body_json), this.limits));
            if (documents.length < 500) break;
            after = String(documents.at(-1)!.document_key);
          }
        }
        await client.query("COMMIT");
        return await this.inspectTableInternal(namespace, definition.name, client);
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { release(); }
    });
  }

  async inspectTable(namespace: string, table: string, options?: OperationOptions): Promise<TableInspection> {
    return this.operation("document.inspect_table", options, async (signal) => {
      assertNamespace(namespace, this.limits); assertName(table, "table name", this.limits);
      const client = await acquirePgClient(this.pool, signal); const release = bindPgAbort(client, signal);
      try { await client.query("BEGIN"); await configurePgTimeout(client, options); const result = await this.inspectTableInternal(namespace, table, client); await client.query("COMMIT"); return result; }
      catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { release(); }
    });
  }

  private async inspectTableInternal(namespace: string, table: string, queryable: Pick<Pool, "query"> | PoolClient): Promise<TableInspection> {
    const row = (await queryable.query<PgRow>(`SELECT d.*, (SELECT COUNT(*) FROM tessyl_storage_documents x WHERE x.namespace=d.namespace AND x.table_name=d.table_name) AS document_count FROM tessyl_storage_table_definitions d WHERE namespace=$1 AND table_name=$2`, [namespace, table])).rows[0];
    if (!row) throw new StorageError("not_found", `Table ${table} is not declared`, { operation: "document.inspect_table" });
    return { definition: typeof row.definition_json === "string" ? safeJsonParse(String(row.definition_json), "document.inspect_table") : row.definition_json as TableDefinition, definitionHash: String(row.definition_hash), documentCount: Number(row.document_count) };
  }

  async get(namespace: string, table: string, key: string, options?: OperationOptions): Promise<StoredDocument> {
    return this.operation("document.get", options, async (signal) => {
      assertNamespace(namespace, this.limits); assertName(table, "table name", this.limits); assertKey(key, this.limits);
      const client = await acquirePgClient(this.pool, signal); const release = bindPgAbort(client, signal); let row: PgRow | undefined;
      try { await client.query("BEGIN"); await configurePgTimeout(client, options); row = (await client.query<PgRow>("SELECT * FROM tessyl_storage_documents WHERE namespace=$1 AND table_name=$2 AND document_key=$3", [namespace, table, key])).rows[0]; await client.query("COMMIT"); }
      catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { release(); }
      if (!row) throw new StorageError("not_found", "Document was not found", { operation: "document.get" }); return asStoredDocument(row);
    });
  }

  async transact(request: TransactionRequest, options?: OperationOptions): Promise<TransactionResult> {
    return this.operation("document.transact", options, async (signal) => {
      validateTransactionRequest(request, this.limits);
      const requestHash = definitionHash(request);
      for (let attempt = 0; ; attempt += 1) {
        const client = await acquirePgClient(this.pool, signal); const release = bindPgAbort(client, signal);
        try {
          await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); await configurePgTimeout(client, options);
          if (request.idempotencyKey) {
            const replay = (await client.query<PgRow>("SELECT * FROM tessyl_storage_idempotency WHERE namespace=$1 AND idempotency_key=$2 FOR UPDATE", [request.namespace, request.idempotencyKey])).rows[0];
            if (replay) {
              if (String(replay.request_hash) !== requestHash) throw new StorageError("conflict", "Idempotency key was reused with different input", { operation: "document.transact" });
              await client.query("COMMIT"); const response = replay.response_json as TransactionResult; return { ...response, replayed: true };
            }
          }
          const documents: StoredDocument[] = []; const deletedKeys: string[] = [];
          for (const mutation of request.operations) {
            assertName(mutation.table, "table name", this.limits); assertKey(mutation.key, this.limits);
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [request.namespace, mutation.table]);
            const definition = (await this.inspectTableInternal(request.namespace, mutation.table, client)).definition;
            const current = (await client.query<PgRow>("SELECT * FROM tessyl_storage_documents WHERE namespace=$1 AND table_name=$2 AND document_key=$3 FOR UPDATE", [request.namespace, mutation.table, mutation.key])).rows[0];
            const versionState = (await client.query<PgRow>("SELECT version FROM tessyl_storage_document_versions WHERE namespace=$1 AND table_name=$2 AND document_key=$3 FOR UPDATE", [request.namespace, mutation.table, mutation.key])).rows[0];
            assertCondition(mutation.condition, current, "document.transact");
            if (mutation.kind === "delete") { if (current) { const deletedVersion = BigInt(String(versionState?.version ?? current.version)) + 1n; await client.query(`INSERT INTO tessyl_storage_document_versions(namespace,table_name,document_key,version) VALUES($1,$2,$3,$4) ON CONFLICT(namespace,table_name,document_key) DO UPDATE SET version=excluded.version`, [request.namespace, mutation.table, mutation.key, deletedVersion.toString()]); await client.query("DELETE FROM tessyl_storage_documents WHERE namespace=$1 AND table_name=$2 AND document_key=$3", [request.namespace, mutation.table, mutation.key]); } deletedKeys.push(`${mutation.table}:${mutation.key}`); continue; }
            const body = parsePortableDocument(mutation.bodyJson, this.limits); const now = new Date(); const version = BigInt(String(versionState?.version ?? current?.version ?? 0)) + 1n;
            const row = (await client.query<PgRow>(`INSERT INTO tessyl_storage_documents(namespace,table_name,document_key,version,body_json,created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6,$6)
              ON CONFLICT(namespace,table_name,document_key) DO UPDATE SET version=excluded.version,body_json=excluded.body_json,updated_at=excluded.updated_at RETURNING *`, [request.namespace, mutation.table, mutation.key, version.toString(), mutation.bodyJson, now])).rows[0]!;
            await client.query("DELETE FROM tessyl_storage_index_entries WHERE namespace=$1 AND table_name=$2 AND document_key=$3", [request.namespace, mutation.table, mutation.key]);
            await client.query(`INSERT INTO tessyl_storage_document_versions(namespace,table_name,document_key,version) VALUES($1,$2,$3,$4) ON CONFLICT(namespace,table_name,document_key) DO UPDATE SET version=excluded.version`, [request.namespace, mutation.table, mutation.key, version.toString()]);
            await this.writeIndexEntries(client, request.namespace, definition, mutation.key, body); documents.push(asStoredDocument(row));
          }
          const result: TransactionResult = { documents, deletedKeys, replayed: false };
          if (request.idempotencyKey) await client.query("INSERT INTO tessyl_storage_idempotency(namespace,idempotency_key,request_hash,response_json) VALUES($1,$2,$3,$4::jsonb)", [request.namespace, request.idempotencyKey, requestHash, JSON.stringify(result)]);
          await client.query("COMMIT"); return result;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          if ((error as { code?: string }).code === "40001" && attempt + 1 < this.retryAttempts) { await jitter(attempt); continue; }
          if ((error as { code?: string }).code === "23505" && request.idempotencyKey) {
            const winner = (await client.query<PgRow>("SELECT request_hash,response_json FROM tessyl_storage_idempotency WHERE namespace=$1 AND idempotency_key=$2", [request.namespace, request.idempotencyKey])).rows[0];
            if (winner) {
              if (String(winner.request_hash) !== requestHash) throw new StorageError("conflict", "Idempotency key was reused with different input", { operation: "document.transact" });
              const response = typeof winner.response_json === "string" ? safeJsonParse<TransactionResult>(winner.response_json, "document.transact") : winner.response_json as TransactionResult;
              return { ...response, replayed: true };
            }
          }
          throw error;
        } finally { release(); }
      }
    });
  }

  private async writeIndexEntries(client: PoolClient, namespace: string, definition: TableDefinition, key: string, document: Record<string, unknown>): Promise<void> {
    for (const index of definition.indexes) {
      const values = extractIndexValues(document, index); if (!values) continue;
      const valuesJson = canonicalJson(values); const sortKey = encodeIndexValues(values);
      if (index.unique) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [`${namespace}/${definition.name}/${index.name}`, valuesJson]);
        const conflict = (await client.query<PgRow>("SELECT document_key FROM tessyl_storage_index_entries WHERE namespace=$1 AND table_name=$2 AND index_name=$3 AND values_json=$4::jsonb AND document_key<>$5 LIMIT 1", [namespace, definition.name, index.name, valuesJson, key])).rows[0];
        if (conflict) throw new StorageError("conflict", `Unique index ${index.name} conflicts with another document`, { operation: "document.transact", details: { index: index.name, conflictingKey: conflict.document_key } });
      }
      await client.query("INSERT INTO tessyl_storage_index_entries(namespace,table_name,index_name,sort_key,values_json,document_key) VALUES($1,$2,$3,$4,$5::jsonb,$6)", [namespace, definition.name, index.name, sortKey, valuesJson, key]);
    }
  }

  async query(request: IndexQuery, options?: OperationOptions): Promise<DocumentPage> {
    return this.operation("document.query", options, async (signal) => {
      validateIndexQuery(request, this.limits);
      const client = await acquirePgClient(this.pool, signal); const release = bindPgAbort(client, signal);
      try { await client.query("BEGIN"); await configurePgTimeout(client, options);
      const definition = (await this.inspectTableInternal(request.namespace, request.table, client)).definition;
      const index = definition.indexes.find((candidate) => candidate.name === request.index); if (!index) throw new StorageError("not_found", `Index ${request.index} is not declared`, { operation: "document.query" });
      validateQueryValues(index, request.prefix, "prefix"); if (request.lower) validateQueryValues(index, request.lower, "lower"); if (request.upper) validateQueryValues(index, request.upper, "upper");
      if ((request.lower || request.upper || request.order === "desc") && !index.ordered) throw new StorageError("invalid_request", `Index ${index.name} does not support ordered queries`, { operation: "document.query" });
      const { cursor: _cursor, ...queryShape } = request; const queryHash = definitionHash(queryShape);
      const cursor = decodeCursor<{ sortKey: string; documentKey: string; queryHash: string }>(request.cursor, "document.query");
      if (cursor && (typeof cursor.sortKey !== "string" || typeof cursor.documentKey !== "string" || cursor.queryHash !== queryHash)) throw new StorageError("invalid_request", "Cursor does not match query", { operation: "document.query" });
      const clauses = ["e.namespace=$1", "e.table_name=$2", "e.index_name=$3"]; const params: unknown[] = [request.namespace, request.table, request.index];
      const add = (sql: (position: number) => string, value: unknown): void => { params.push(value); clauses.push(sql(params.length)); };
      if (request.prefix.length) { const prefix = encodeIndexValues(request.prefix); params.push(prefix, `${prefix}.%`); clauses.push(`(e.sort_key=$${params.length - 1} OR e.sort_key LIKE $${params.length})`); }
      if (request.lower) add((position) => `e.sort_key ${request.lowerInclusive === false ? ">" : ">="} $${position}`, encodeIndexValues(request.lower));
      if (request.upper) add((position) => `e.sort_key ${request.upperInclusive === false ? "<" : "<="} $${position}`, encodeIndexValues(request.upper));
      if (cursor) { const op = request.order === "asc" ? ">" : "<"; params.push(cursor.sortKey, cursor.documentKey); clauses.push(`(e.sort_key ${op} $${params.length - 1} OR (e.sort_key=$${params.length - 1} AND e.document_key COLLATE "C" ${op} $${params.length}))`); }
      params.push(request.limit + 1); const direction = request.order === "asc" ? "ASC" : "DESC";
      const rows = (await client.query<PgRow>(`SELECT e.sort_key,e.document_key,d.* FROM tessyl_storage_index_entries e JOIN tessyl_storage_documents d USING(namespace,table_name,document_key) WHERE ${clauses.join(" AND ")} ORDER BY e.sort_key ${direction},e.document_key COLLATE "C" ${direction} LIMIT $${params.length}`, params)).rows;
      const page = rows.slice(0, request.limit); const last = page.at(-1);
      const result = { documents: page.map(asStoredDocument), ...(rows.length > request.limit && last ? { cursor: encodeCursor({ sortKey: last.sort_key, documentKey: last.document_key, queryHash }) } : {}) }; await client.query("COMMIT"); return result;
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { release(); }
    });
  }

  async claimOutbox(request: OutboxClaimRequest, options?: OperationOptions): Promise<readonly OutboxRecord[]> {
    return this.operation("document.claim_outbox", options, async (signal) => {
      assertNamespace(request.namespace, this.limits); assertName(request.table, "table name", this.limits); assertKey(request.workerId, this.limits);
      const now = new Date(request.now);
      if (Number.isNaN(now.getTime()) || !Number.isSafeInteger(request.leaseSeconds) || request.leaseSeconds < 1 || request.leaseSeconds > MAX_OUTBOX_LEASE_SECONDS || !Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > this.limits.maxResultCount) throw new StorageError("invalid_request", "Invalid outbox claim request", { operation: "document.claim_outbox" });
      const client = await acquirePgClient(this.pool, signal); const release = bindPgAbort(client, signal);
      try {
        await client.query("BEGIN"); await configurePgTimeout(client, options); const definition = (await this.inspectTableInternal(request.namespace, request.table, client)).definition;
        const rows = (await client.query<PgRow>(`SELECT * FROM tessyl_storage_documents WHERE namespace=$1 AND table_name=$2
          AND (body_json->>'processed_at' IS NULL)
          AND CASE WHEN pg_input_is_valid(body_json->>'available_at','timestamptz') THEN (body_json->>'available_at')::timestamptz ELSE 'infinity'::timestamptz END <= $3
          AND CASE WHEN body_json->>'lease_until' IS NULL THEN 'epoch'::timestamptz WHEN pg_input_is_valid(body_json->>'lease_until','timestamptz') THEN (body_json->>'lease_until')::timestamptz ELSE 'infinity'::timestamptz END <= $3
          ORDER BY CASE WHEN pg_input_is_valid(body_json->>'available_at','timestamptz') THEN (body_json->>'available_at')::timestamptz ELSE 'infinity'::timestamptz END,document_key FOR UPDATE SKIP LOCKED LIMIT $4`, [request.namespace, request.table, request.now, request.limit])).rows;
        const claimed: OutboxRecord[] = [];
        for (const row of rows) {
          const body = row.body_json as Record<string, unknown>; const leaseToken = `${request.workerId}:${crypto.randomUUID()}`; const priorAttempt = body.attempt ?? 0;
          if (!Number.isSafeInteger(priorAttempt) || Number(priorAttempt) < 0 || Number(priorAttempt) >= Number.MAX_SAFE_INTEGER) throw new StorageError("invalid_request", "Outbox attempt must be a nonnegative safe integer", { operation: "document.claim_outbox" });
          const attempt = Number(priorAttempt) + 1;
          body.lease_token = leaseToken; body.lease_until = new Date(new Date(request.now).getTime() + request.leaseSeconds * 1000).toISOString(); body.attempt = attempt;
          const bodyJson = canonicalJson(body); parsePortableDocument(bodyJson, this.limits);
          const updated = (await client.query<PgRow>("UPDATE tessyl_storage_documents SET body_json=$1::jsonb,version=version+1,updated_at=now() WHERE namespace=$2 AND table_name=$3 AND document_key=$4 RETURNING *", [bodyJson, request.namespace, request.table, row.document_key])).rows[0]!;
          await client.query("UPDATE tessyl_storage_document_versions SET version=$1 WHERE namespace=$2 AND table_name=$3 AND document_key=$4", [updated.version, request.namespace, request.table, row.document_key]);
          await client.query("DELETE FROM tessyl_storage_index_entries WHERE namespace=$1 AND table_name=$2 AND document_key=$3", [request.namespace, request.table, row.document_key]); await this.writeIndexEntries(client, request.namespace, definition, String(row.document_key), body);
          claimed.push({ document: asStoredDocument(updated), leaseToken, attempt });
        }
        await client.query("COMMIT"); return claimed;
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { release(); }
    });
  }

  async completeOutbox(namespace: string, table: string, key: string, leaseToken: string, options?: OperationOptions): Promise<void> { return this.updateOutbox(namespace, table, key, leaseToken, (body) => { body.processed_at = new Date().toISOString(); body.lease_token = null; body.lease_until = null; }, "document.complete_outbox", options); }
  async retryOutbox(namespace: string, table: string, key: string, leaseToken: string, availableAt: string, error: string, options?: OperationOptions): Promise<void> { assertPortableString(availableAt, "document.retry_outbox"); assertPortableString(error, "document.retry_outbox"); const parsed = new Date(availableAt); if (Number.isNaN(parsed.getTime())) throw new StorageError("invalid_request", "Outbox retry time is invalid", { operation: "document.retry_outbox" }); return this.updateOutbox(namespace, table, key, leaseToken, (body) => { body.available_at = parsed.toISOString(); body.last_error = [...error].slice(0, 2048).join(""); body.lease_token = null; body.lease_until = null; }, "document.retry_outbox", options); }

  private async updateOutbox(namespace: string, table: string, key: string, leaseToken: string, mutate: (body: Record<string, unknown>) => void, operation: string, options?: OperationOptions): Promise<void> {
    return this.operation(operation, options, async (signal) => {
      assertNamespace(namespace, this.limits); assertName(table, "table name", this.limits); assertKey(key, this.limits); assertLeaseToken(leaseToken, this.limits);
      const client = await acquirePgClient(this.pool, signal); const release = bindPgAbort(client, signal); try {
        await client.query("BEGIN"); await configurePgTimeout(client, options); const definition = (await this.inspectTableInternal(namespace, table, client)).definition;
        const row = (await client.query<PgRow>("SELECT * FROM tessyl_storage_documents WHERE namespace=$1 AND table_name=$2 AND document_key=$3 FOR UPDATE", [namespace, table, key])).rows[0];
        if (!row) throw new StorageError("not_found", "Outbox record was not found", { operation }); const body = row.body_json as Record<string, unknown>;
        if (body.lease_token !== leaseToken) throw new StorageError("failed_condition", "Outbox lease token does not match", { operation }); mutate(body);
        const bodyJson = canonicalJson(body); parsePortableDocument(bodyJson, this.limits);
        await client.query("UPDATE tessyl_storage_documents SET body_json=$1::jsonb,version=version+1,updated_at=now() WHERE namespace=$2 AND table_name=$3 AND document_key=$4", [bodyJson, namespace, table, key]);
        await client.query("UPDATE tessyl_storage_document_versions SET version=(SELECT version FROM tessyl_storage_documents WHERE namespace=$1 AND table_name=$2 AND document_key=$3) WHERE namespace=$1 AND table_name=$2 AND document_key=$3", [namespace, table, key]);
        await client.query("DELETE FROM tessyl_storage_index_entries WHERE namespace=$1 AND table_name=$2 AND document_key=$3", [namespace, table, key]); await this.writeIndexEntries(client, namespace, definition, key, body); await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { release(); }
    });
  }

  async health(options?: OperationOptions): Promise<HealthStatus> { const startedAt = Date.now(); return this.operation("document.health", options, async (signal) => { const client = await acquirePgClient(this.pool, signal); const release = bindPgAbort(client, signal); try { await client.query("BEGIN"); await configurePgTimeout(client, options); await client.query("SELECT 1"); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { release(); } return { capability: "document", ready: true, message: "ready", latencyMs: Date.now() - startedAt }; }); }
  async close(): Promise<void> { /* shared pool lifetime is owned by the composition */ }
}

const validateQueryValues = (index: IndexDefinition, values: readonly PortableScalar[], kind: string): void => {
  if (values.length > index.fields.length) throw new StorageError("invalid_request", `${kind} has too many index values`, { operation: "document.query" });
  values.forEach((value, position) => { const actual = value === null ? "null" : typeof value; if (actual !== index.fields[position]!.type) throw new StorageError("invalid_request", `${kind} value ${position} must be ${index.fields[position]!.type}`, { operation: "document.query" }); });
};

const nsHash = (namespace: string): string => createHash("sha256").update(namespace).digest("hex").slice(0, 20);
const searchBackendId = (documentId: string): string => createHash("sha256").update(documentId).digest("hex");
const aliasName = (namespace: string, logical: string): string => `tessyl-${nsHash(namespace)}-${logical}`;
const physicalName = (namespace: string, schema: SearchSchema, generation: number): string => `${aliasName(namespace, schema.name)}-g${generation}`;
const SEARCH_FORMAT_VERSION = 2;

export class HostedSearchIndexService extends HostedService implements SearchIndexService {
  constructor(readonly client: OpenSearchClient, readonly pool: Pool, limits: Readonly<StorageLimits>, semaphore: Semaphore, observe?: ObservabilityHook, private readonly ownsClient = false) { super(limits, "search_index", semaphore, observe); }

  private async withLifecycleLock<T>(namespace: string, logicalName: string, signal: AbortSignal, options: OperationOptions | undefined, run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await acquirePgClient(this.pool, signal); let locked = false; let destroy = false;
    try {
      if (options?.timeoutMs !== undefined) await client.query("SELECT set_config('statement_timeout',$1,false)", [String(Math.max(1, Math.floor(options.timeoutMs)))]);
      await client.query("SELECT pg_advisory_lock(hashtext($1),hashtext($2))", [namespace, `search:${logicalName}`]);
      locked = true;
      return await run(client);
    } finally {
      try { if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1),hashtext($2))", [namespace, `search:${logicalName}`]); if (options?.timeoutMs !== undefined) await client.query("SELECT set_config('statement_timeout','0',false)"); }
      catch { destroy = true; }
      client.release(destroy);
    }
  }

  private async ensureGenerationCounter(client: PoolClient, namespace: string, logicalName: string, generation: number): Promise<void> {
    await client.query(`INSERT INTO tessyl_storage_search_generation_counters(namespace,logical_name,generation) VALUES($1,$2,$3)
      ON CONFLICT(namespace,logical_name) DO UPDATE SET generation=GREATEST(tessyl_storage_search_generation_counters.generation,excluded.generation)`, [namespace, logicalName, generation]);
  }

  private async nextGeneration(client: PoolClient, namespace: string, logicalName: string, observedGeneration = 0): Promise<number> {
    if (observedGeneration > 0) await this.ensureGenerationCounter(client, namespace, logicalName, observedGeneration);
    const row = (await client.query<PgRow>(`INSERT INTO tessyl_storage_search_generation_counters(namespace,logical_name,generation) VALUES($1,$2,1)
      ON CONFLICT(namespace,logical_name) DO UPDATE SET generation=tessyl_storage_search_generation_counters.generation+1 RETURNING generation`, [namespace, logicalName])).rows[0]!;
    return Number(row.generation);
  }

  async create(namespace: string, schema: SearchSchema, options?: OperationOptions): Promise<SearchIndexInspection> { return this.operation("search_index.create", options, async (signal) => {
    assertNamespace(namespace, this.limits); validateSearchSchema(schema, this.limits);
    return this.withLifecycleLock(namespace, schema.name, signal, options, async (client) => {
      try {
        const existing = await this.inspectInternal(namespace, schema.name, signal, options);
        if (canonicalJson(existing.schema) !== canonicalJson(schema)) throw new StorageError("conflict", "Search schema changed; begin an explicit rebuild", { operation: "search_index.create" });
        await client.query(`INSERT INTO tessyl_storage_search_generation_counters(namespace,logical_name,generation) VALUES($1,$2,$3)
          ON CONFLICT(namespace,logical_name) DO UPDATE SET generation=GREATEST(tessyl_storage_search_generation_counters.generation,excluded.generation)`, [namespace, schema.name, existing.generation]);
        return existing;
      } catch (error) { if (!(error instanceof StorageError) || error.code !== "not_found") throw error; }
      const observed = Math.max(0, ...(await this.discoverGenerations(namespace, schema.name, signal, options)).map(({ generation }) => generation));
      const generation = await this.nextGeneration(client, namespace, schema.name, observed); const physical = physicalName(namespace, schema, generation);
      await this.createPhysical(namespace, schema, physical, generation, signal, options);
      await openSearchRequest(signal, this.client.indices.putAlias({ index: physical, name: aliasName(namespace, schema.name) }, { requestTimeout: options?.timeoutMs }));
      const result = await this.inspectInternal(namespace, schema.name, signal, options);
      if (result.physicalName !== physical || canonicalJson(result.schema) !== canonicalJson(schema)) throw new StorageError("conflict", "Search alias was created with a different schema", { operation: "search_index.create" });
      return result;
    });
  }); }
  async inspect(namespace: string, logicalName: string, options?: OperationOptions): Promise<SearchIndexInspection> { return this.operation("search_index.inspect", options, (signal) => this.inspectInternal(namespace, logicalName, signal, options)); }
  private async inspectInternal(namespace: string, logicalName: string, signal: AbortSignal, options?: OperationOptions): Promise<SearchIndexInspection> {
    assertNamespace(namespace, this.limits); assertName(logicalName, "search index name", this.limits);
    try {
      const response = await openSearchRequest(signal, this.client.indices.getAlias({ name: aliasName(namespace, logicalName) }, { requestTimeout: options?.timeoutMs })); const body = response.body as Record<string, unknown>; const physical = Object.keys(body)[0]; if (!physical) throw new Error("empty alias");
      const settings = await openSearchRequest(signal, this.client.indices.get({ index: physical }, { requestTimeout: options?.timeoutMs })); const indexBody = (settings.body as Record<string, { mappings?: { _meta?: { tessyl_schema?: SearchSchema; generation?: number; storage_format_version?: number } } }>)[physical]; const schema = indexBody?.mappings?._meta?.tessyl_schema;
      if (!schema) throw new StorageError("internal", "OpenSearch index is missing Tessyl schema metadata", { operation: "search_index.inspect" });
      if (indexBody?.mappings?._meta?.storage_format_version !== SEARCH_FORMAT_VERSION) throw new StorageError("failed_condition", "Search generation uses a legacy storage format; begin and cut over to a rebuilt generation", { operation: "search_index.inspect" });
      return { namespace, logicalName, physicalName: physical, schema, generation: Number(indexBody?.mappings?._meta?.generation ?? 1), active: true };
    } catch (error) { if ((error as { statusCode?: number }).statusCode === 404) throw new StorageError("not_found", `Search index ${logicalName} was not found`, { operation: "search_index.inspect" }); throw error; }
  }
  private async activePhysicalName(namespace: string, logicalName: string, signal: AbortSignal, options?: OperationOptions): Promise<string | undefined> {
    try { const aliases = await openSearchRequest(signal, this.client.indices.getAlias({ name: aliasName(namespace, logicalName) }, { requestTimeout: options?.timeoutMs })); return Object.keys(aliases.body as object)[0]; }
    catch (error) { if ((error as { statusCode?: number }).statusCode === 404) return undefined; throw error; }
  }
  private async discoverGenerations(namespace: string, logicalName: string, signal: AbortSignal, options?: OperationOptions): Promise<SearchIndexInspection[]> {
    const active = await this.activePhysicalName(namespace, logicalName, signal, options);
    try {
      const response = await openSearchRequest(signal, this.client.indices.get({ index: `${aliasName(namespace, logicalName)}-*`, allow_no_indices: true, ignore_unavailable: true }, { requestTimeout: options?.timeoutMs }));
      const inspections: SearchIndexInspection[] = [];
      for (const [name, value] of Object.entries(response.body as Record<string, { mappings?: { _meta?: { generation?: number; namespace_hash?: string; tessyl_schema?: SearchSchema } } }>)) {
        const metadata = value.mappings?._meta; if (metadata?.namespace_hash !== nsHash(namespace) || metadata.tessyl_schema?.name !== logicalName || !Number.isSafeInteger(metadata.generation)) continue;
        inspections.push({ namespace, logicalName, physicalName: name, schema: metadata.tessyl_schema, generation: Number(metadata.generation), active: name === active });
      }
      return inspections.sort((left, right) => left.generation - right.generation || compareUtf8(left.physicalName, right.physicalName));
    } catch (error) { if ((error as { statusCode?: number }).statusCode === 404) return []; throw error; }
  }
  async listGenerations(namespace: string, logicalName: string, limit: number, cursorText?: string, options?: OperationOptions): Promise<SearchGenerationPage> { return this.operation("search_index.list_generations", options, async (signal) => {
    assertNamespace(namespace, this.limits); assertName(logicalName, "search index name", this.limits);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.limits.maxResultCount) throw new StorageError("limit_exceeded", "Generation page limit exceeds the configured maximum", { operation: "search_index.list_generations" });
    const queryHash = definitionHash({ namespace, logicalName }); const cursor = decodeCursor<{ generation: number; physicalName: string; queryHash: string }>(cursorText, "search_index.list_generations");
    if (cursor && (!Number.isSafeInteger(cursor.generation) || typeof cursor.physicalName !== "string" || cursor.queryHash !== queryHash)) throw new StorageError("invalid_request", "Generation cursor does not match the request", { operation: "search_index.list_generations" });
    const generations = (await this.discoverGenerations(namespace, logicalName, signal, options)).filter((generation) => !cursor || generation.generation > cursor.generation || (generation.generation === cursor.generation && compareUtf8(generation.physicalName, cursor.physicalName) > 0));
    const page = generations.slice(0, limit); const last = page.at(-1);
    return { generations: page, ...(generations.length > limit && last ? { cursor: encodeCursor({ generation: last.generation, physicalName: last.physicalName, queryHash }) } : {}) };
  }); }
  async beginRebuild(namespace: string, schema: SearchSchema, options?: OperationOptions): Promise<SearchIndexInspection> { return this.operation("search_index.begin_rebuild", options, async (signal) => { assertNamespace(namespace, this.limits); validateSearchSchema(schema, this.limits); return this.withLifecycleLock(namespace, schema.name, signal, options, async (client) => { const observed = Math.max(0, ...(await this.discoverGenerations(namespace, schema.name, signal, options)).map(({ generation }) => generation)); const generation = await this.nextGeneration(client, namespace, schema.name, observed); const physical = physicalName(namespace, schema, generation); await this.createPhysical(namespace, schema, physical, generation, signal, options); return { namespace, logicalName: schema.name, physicalName: physical, schema, generation, active: false }; }); }); }
  async cutover(namespace: string, logicalName: string, target: string, options?: OperationOptions): Promise<SearchIndexInspection> { return this.operation("search_index.cutover", options, async (signal) => { assertNamespace(namespace, this.limits); assertName(logicalName, "search index name", this.limits); if (!target.startsWith(`${aliasName(namespace, logicalName)}-`)) throw new StorageError("invalid_request", "Physical index does not belong to this namespace and alias", { operation: "search_index.cutover" }); return this.withLifecycleLock(namespace, logicalName, signal, options, async (client) => { const owned = await this.mutationTarget(namespace, target, options, signal); if (owned.schema.name !== logicalName) throw new StorageError("invalid_request", "Physical index schema does not match this alias", { operation: "search_index.cutover" }); await this.ensureGenerationCounter(client, namespace, logicalName, owned.generation); const current = await this.activePhysicalName(namespace, logicalName, signal, options); const actions: object[] = []; if (current && current !== target) actions.push({ remove: { index: current, alias: aliasName(namespace, logicalName) } }); if (current !== target) actions.push({ add: { index: target, alias: aliasName(namespace, logicalName) } }); if (actions.length) await openSearchRequest(signal, this.client.indices.updateAliases({ body: { actions } }, { requestTimeout: options?.timeoutMs })); return this.inspectInternal(namespace, logicalName, signal, options); }); }); }
  async deleteGeneration(namespace: string, target: string, options?: OperationOptions): Promise<void> { return this.operation("search_index.delete_generation", options, async (signal) => { assertNamespace(namespace, this.limits); if (!target.startsWith(`tessyl-${nsHash(namespace)}-`)) throw new StorageError("invalid_request", "Physical index does not belong to this namespace", { operation: "search_index.delete_generation" }); const initial = await this.readPhysicalMetadata(namespace, target, signal, options); return this.withLifecycleLock(namespace, initial.schema.name, signal, options, async (client) => { const owned = await this.readPhysicalMetadata(namespace, target, signal, options); await this.ensureGenerationCounter(client, namespace, owned.schema.name, owned.generation); try { await openSearchRequest(signal, this.client.indices.getAlias({ index: target, name: aliasName(namespace, owned.schema.name) }, { requestTimeout: options?.timeoutMs })); throw new StorageError("failed_condition", "The active search generation cannot be deleted", { operation: "search_index.delete_generation" }); } catch (error) { if (error instanceof StorageError) throw error; if ((error as { statusCode?: number }).statusCode !== 404) throw error; } await openSearchRequest(signal, this.client.indices.delete({ index: target }, { requestTimeout: options?.timeoutMs })); }); }); }
  private async createPhysical(namespace: string, schema: SearchSchema, name: string, generation: number, signal: AbortSignal, options?: OperationOptions): Promise<void> {
    const properties: Record<string, object> = { namespace: { type: "keyword" }, locale: { type: "keyword" }, version: { type: "long" }, tags: { type: "keyword" }, tessyl_deleted: { type: "boolean" }, tessyl_document_id: { type: "keyword" } };
    for (const field of schema.fields) properties[`field_${field}`] = { type: "text" };
    for (const field of schema.filterFields) properties[`filter_${field}`] = { type: "keyword" };
    try { await openSearchRequest(signal, this.client.indices.create({ index: name, body: { settings: { number_of_shards: 3, number_of_replicas: 1 }, mappings: { dynamic: "strict", _meta: { tessyl_schema: schema, generation, namespace_hash: nsHash(namespace), storage_format_version: SEARCH_FORMAT_VERSION }, properties } } }, { requestTimeout: options?.timeoutMs })); }
    catch (error) {
      if (!([400, 409].includes((error as { statusCode?: number }).statusCode ?? 0))) throw error;
      const response = await openSearchRequest(signal, this.client.indices.get({ index: name }, { requestTimeout: options?.timeoutMs }));
      const metadata = (response.body as Record<string, { mappings?: { _meta?: { tessyl_schema?: SearchSchema; generation?: number; namespace_hash?: string; storage_format_version?: number } } }>)[name]?.mappings?._meta;
      if (metadata?.namespace_hash !== nsHash(namespace) || metadata.generation !== generation || metadata.storage_format_version !== SEARCH_FORMAT_VERSION || canonicalJson(metadata.tessyl_schema) !== canonicalJson(schema)) throw new StorageError("conflict", "Physical search generation already exists with a different schema or storage format", { operation: "search_index.create" });
    }
  }
  private async readPhysicalMetadata(namespace: string, name: string, signal: AbortSignal, options?: OperationOptions): Promise<{ schema: SearchSchema; generation: number; formatVersion?: number }> {
    try {
      const response = await openSearchRequest(signal, this.client.indices.get({ index: name }, { requestTimeout: options?.timeoutMs }));
      const metadata = (response.body as Record<string, { mappings?: { _meta?: { tessyl_schema?: SearchSchema; namespace_hash?: string; generation?: number; storage_format_version?: number } } }>)[name]?.mappings?._meta;
      if (!metadata?.tessyl_schema || metadata.namespace_hash !== nsHash(namespace) || !Number.isSafeInteger(metadata.generation)) throw new StorageError("invalid_request", "Physical index is not a Tessyl index for this namespace", { operation: "search_index.mutate" });
      return { schema: metadata.tessyl_schema, generation: Number(metadata.generation), formatVersion: metadata.storage_format_version };
    } catch (error) { if ((error as { statusCode?: number }).statusCode === 404) throw new StorageError("not_found", "Physical search index was not found", { operation: "search_index.mutate" }); throw error; }
  }
  private async mutationTarget(namespace: string, name: string, options?: OperationOptions, signal = new AbortController().signal): Promise<{ index: string; schema: SearchSchema; generation: number }> {
    assertNamespace(namespace, this.limits);
    if (!name.startsWith("tessyl-")) { assertName(name, "search index name", this.limits); const active = await this.inspectInternal(namespace, name, signal, options); return { index: aliasName(namespace, name), schema: active.schema, generation: active.generation }; }
    if (!name.startsWith(`tessyl-${nsHash(namespace)}-`)) throw new StorageError("invalid_request", "Physical index does not belong to this namespace", { operation: "search_index.mutate" });
    const metadata = await this.readPhysicalMetadata(namespace, name, signal, options);
    if (metadata.formatVersion !== SEARCH_FORMAT_VERSION) throw new StorageError("failed_condition", "Search generation uses a legacy storage format; rebuild it before mutation", { operation: "search_index.mutate" });
    return { index: name, schema: metadata.schema, generation: metadata.generation };
  }
  async upsert(document: SearchDocument, options?: OperationOptions): Promise<SearchMutationResult> { return this.operation("search_index.upsert", options, async (signal) => { if (typeof document?.index !== "string") throw new StorageError("invalid_request", "Search document index must be a string", { operation: "search_index.upsert" }); const target = await this.mutationTarget(document.namespace, document.index, options, signal); const version = validateSearchDocument(document, target.schema, this.limits); const backendId = searchBackendId(document.documentId); const body: Record<string, unknown> = { namespace: document.namespace, locale: document.locale, version, tags: document.tags, tessyl_deleted: false, tessyl_document_id: document.documentId }; for (const field of document.fields) body[`field_${field.name}`] = field.text; for (const filter of document.filters) body[`filter_${filter.name}`] = canonicalJson(filter.value); try { await openSearchRequest(signal, this.client.index({ index: target.index, id: backendId, routing: document.namespace, version, version_type: "external", body, refresh: "wait_for" }, { requestTimeout: options?.timeoutMs })); return { applied: true, currentVersion: String(version) }; } catch (error) { if ((error as { statusCode?: number }).statusCode !== 409) throw error; const current = await openSearchRequest(signal, this.client.get({ index: target.index, id: backendId, routing: document.namespace }, { requestTimeout: options?.timeoutMs })); return { applied: false, currentVersion: String((current.body as { _version?: number })._version ?? version) }; } }); }
  async delete(namespace: string, indexName: string, documentId: string, versionText: string, options?: OperationOptions): Promise<SearchMutationResult> { return this.operation("search_index.delete", options, async (signal) => { assertKey(documentId, this.limits); const target = await this.mutationTarget(namespace, indexName, options, signal); const version = positiveInteger(versionText, "search version"); const backendId = searchBackendId(documentId); try { await openSearchRequest(signal, this.client.index({ index: target.index, id: backendId, routing: namespace, version, version_type: "external", body: { namespace, version, tessyl_deleted: true, tessyl_document_id: documentId }, refresh: "wait_for" }, { requestTimeout: options?.timeoutMs })); return { applied: true, currentVersion: String(version) }; } catch (error) { if ((error as { statusCode?: number }).statusCode !== 409) throw error; const current = await openSearchRequest(signal, this.client.get({ index: target.index, id: backendId, routing: namespace }, { requestTimeout: options?.timeoutMs })); return { applied: false, currentVersion: String((current.body as { _version?: number })._version ?? version) }; } }); }
  async health(options?: OperationOptions): Promise<HealthStatus> { const startedAt = Date.now(); return this.operation("search_index.health", options, async (signal) => { const response = await openSearchRequest(signal, this.client.cluster.health({}, { requestTimeout: options?.timeoutMs })); const status = String((response.body as { status?: string }).status); return { capability: "search_index", ready: status !== "red", message: status, latencyMs: Date.now() - startedAt }; }); }
  async close(): Promise<void> { /* shared client lifetime is owned by the composition */ }
}

export class HostedSearchService extends HostedService implements SearchService {
  constructor(readonly client: OpenSearchClient, limits: Readonly<StorageLimits>, semaphore: Semaphore, observe?: ObservabilityHook) { super(limits, "search", semaphore, observe); }
  async query(request: SearchQuery, options?: OperationOptions): Promise<SearchPage> { return this.operation("search.query", options, async (signal) => {
    assertNamespace(request.namespace, this.limits); assertName(request.index, "search index name", this.limits);
    let schemaResponse;
    try { schemaResponse = await openSearchRequest(signal, this.client.indices.get({ index: aliasName(request.namespace, request.index) }, { requestTimeout: options?.timeoutMs })); }
    catch (error) { if ((error as { statusCode?: number }).statusCode === 404) throw new StorageError("not_found", "Search index was not found", { operation: "search.query" }); throw error; }
    const physical = Object.keys(schemaResponse.body as object)[0]!; const metadata = (schemaResponse.body as Record<string, { mappings?: { _meta?: { tessyl_schema?: SearchSchema; storage_format_version?: number } } }>)[physical]?.mappings?._meta; const schema = metadata?.tessyl_schema; if (!schema) throw new StorageError("internal", "OpenSearch index is missing Tessyl schema metadata", { operation: "search.query" }); if (metadata?.storage_format_version !== SEARCH_FORMAT_VERSION) throw new StorageError("failed_condition", "Active search generation uses a legacy storage format; rebuild and cut over before querying", { operation: "search.query" }); validateSearchQuery(request, schema, this.limits);
    const { cursor: _cursor, ...queryShape } = request; const queryHash = definitionHash(queryShape);
    const cursor = decodeCursor<{ searchAfter: readonly unknown[]; physical: string; queryHash: string }>(request.cursor, "search.query"); if (cursor && (!Array.isArray(cursor.searchAfter) || cursor.searchAfter.length !== 2 || !Number.isFinite(cursor.searchAfter[0]) || typeof cursor.searchAfter[1] !== "string" || cursor.physical !== physical || cursor.queryHash !== queryHash)) throw new StorageError("invalid_request", "Search cursor does not match query", { operation: "search.query" });
    const must: object[] = [{ term: { namespace: request.namespace } }];
    const mustNot: object[] = [{ term: { tessyl_deleted: true } }];
    if (request.text) must.push({ multi_match: { query: request.text, fields: request.fields.map((field) => `field_${field.name}^${field.boost}`).length ? request.fields.map((field) => `field_${field.name}^${field.boost}`) : ["field_*"], type: "cross_fields", operator: "and" } });
    if (request.locale) must.push({ term: { locale: request.locale } }); for (const tag of request.tags) must.push({ term: { tags: tag } });
    for (const filter of request.filters) { const field = `filter_${filter.name}`; const value = canonicalJson(filter.value); must.push(filter.operator === "eq" ? { term: { [field]: value } } : { bool: { must: [{ exists: { field } }], must_not: [{ term: { [field]: value } }] } }); }
    const aggs = Object.fromEntries(request.facets.map((facet) => [facet, { terms: { field: `filter_${facet}`, size: this.limits.maxResultCount } }]));
    const searchBody = { size: request.limit + 1, query: { bool: { must, must_not: mustNot } }, sort: [{ _score: "desc" }, { tessyl_document_id: "asc" }], ...(cursor ? { search_after: [...cursor.searchAfter] } : {}), aggs };
    const response = await openSearchRequest(signal, this.client.search({ index: physical, routing: request.namespace, body: searchBody as never }, { requestTimeout: options?.timeoutMs }));
    const body = response.body as unknown as { hits: { hits: Array<{ _id: string; _score: number; _source: Record<string, unknown>; sort: readonly unknown[] }> }; aggregations?: Record<string, { buckets?: Array<{ key: string; doc_count: number }> }> };
    const rawHits = body.hits.hits; const page = rawHits.slice(0, request.limit); const terms = tokenize(request.text); const selectedFields = new Set(request.fields.length ? request.fields.map(({ name }) => name) : schema.fields);
    const hits = page.map((hit) => { const fields: SearchField[] = Object.entries(hit._source).filter(([name]) => name.startsWith("field_")).map(([name, text]) => ({ name: name.slice(6), text: String(text) })); const highlights: SearchHighlight[] = fields.filter((field) => selectedFields.has(field.name)).map((field) => ({ field: field.name, text: field.text, ranges: highlightRanges(field.text, terms) })).filter((highlight) => highlight.ranges.length); return { documentId: String(hit._source.tessyl_document_id), version: String(hit._source.version), score: hit._score ?? 0, fields, highlights }; });
    const facets: SearchFacet[] = request.facets.map((name) => ({ name, buckets: (body.aggregations?.[name]?.buckets ?? []).map((bucket) => ({ value: String(JSON.parse(String(bucket.key)) as PortableScalar), count: bucket.doc_count })) })); const last = page.at(-1);
    return { hits, facets, ...(rawHits.length > request.limit && last ? { cursor: encodeCursor({ searchAfter: last.sort, physical, queryHash }) } : {}) };
  }); }
  async health(options?: OperationOptions): Promise<HealthStatus> { const startedAt = Date.now(); return this.operation("search.health", options, async (signal) => { const response = await openSearchRequest(signal, this.client.cluster.health({}, { requestTimeout: options?.timeoutMs })); const status = String((response.body as { status?: string }).status); return { capability: "search", ready: status !== "red", message: status, latencyMs: Date.now() - startedAt }; }); }
  async close(): Promise<void> { /* shared client is closed by SearchIndex */ }
}

const tokenize = (text: string): string[] => [...new Set(text.normalize("NFKC").toLocaleLowerCase("und").match(/[\p{L}\p{N}_]+/gu) ?? [])];
const highlightRanges = (text: string, terms: readonly string[]): { start: number; end: number }[] => {
  const wanted = new Set(terms); const ranges: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}_]+/gu)) { if (ranges.length >= 32) break; if (wanted.has(match[0].normalize("NFKC").toLocaleLowerCase("und"))) ranges.push({ start: match.index, end: match.index + match[0].length }); }
  return ranges;
};

export class HostedObjectStore extends HostedService implements ObjectStore {
  constructor(readonly s3: S3Client, readonly pool: Pool, readonly bucket: string, readonly prefix: string, limits: Readonly<StorageLimits>, semaphore: Semaphore, observe?: ObservabilityHook, private readonly ownsS3 = false) { super(limits, "object", semaphore, observe); }
  private backendKey(namespace: string, key: string, sessionId: string): string { return `${this.prefix}${nsHash(namespace)}/${createHash("sha256").update(key).digest("hex")}/${createHash("sha256").update(sessionId).digest("hex")}`; }
  private async abortUpload(key: string, uploadId: string): Promise<void> { await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }), { abortSignal: AbortSignal.timeout(5_000) }).catch(() => undefined); }
  private async deleteBackendObject(key: string, signal: AbortSignal, knownVersionId?: string): Promise<void> {
    let versionId = knownVersionId;
    if (!versionId) {
      try {
        const head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal });
        versionId = head.VersionId;
      } catch (error) {
        if (isS3NotFound(error)) return;
        throw error;
      }
    }
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key, ...(versionId ? { VersionId: versionId } : {}) }), { abortSignal: signal });
  }
  private async renewSessionOperation(namespace: string, sessionId: string, state: string, token: string, signal: AbortSignal, options?: OperationOptions): Promise<void> {
    const client = await acquirePgClient(this.pool, signal); const release = bindPgAbort(client, signal);
    try { await client.query("BEGIN"); await configurePgTimeout(client, options); const renewed = await client.query("UPDATE tessyl_storage_upload_sessions SET operation_started_at=now() WHERE namespace=$1 AND session_id=$2 AND operation_state=$3 AND operation_token=$4", [namespace, sessionId, state, token]); if (renewed.rowCount !== 1) throw new StorageError("unavailable", "Object operation lease was lost", { operation: "object.complete_upload", retryable: true }); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { release(); }
  }
  private async releaseSessionOperation(namespace: string, sessionId: string, state: string, token: string): Promise<void> {
    const signal = AbortSignal.timeout(5_000); let client: PoolClient | undefined; let release: (() => void) | undefined;
    try { client = await acquirePgClient(this.pool, signal); release = bindPgAbort(client, signal); await client.query("BEGIN"); await client.query("UPDATE tessyl_storage_upload_sessions SET operation_state=NULL,operation_token=NULL,operation_started_at=NULL WHERE namespace=$1 AND session_id=$2 AND operation_state=$3 AND operation_token=$4", [namespace, sessionId, state, token]); await client.query("COMMIT"); }
    catch { await client?.query("ROLLBACK").catch(() => undefined); }
    finally { release?.(); }
  }
  async initiateUpload(request: UploadRequest, options?: OperationOptions): Promise<UploadSession> { return this.operation("object.initiate_upload", options, async (signal) => {
    const { bytes, requestHash } = validateUploadRequest(request, this.limits);
    const minimumMultipartBytes = (request.partCount - 1) * 5 * 1024 * 1024;
    if (bytes < minimumMultipartBytes) throw new StorageError("invalid_request", "Every non-final S3 multipart part must contain at least 5 MiB", { operation: "object.initiate_upload" });
    const sessionId = crypto.randomUUID(); const expiresAt = new Date(Date.now() + Math.min(Math.max(request.expiresInSeconds, 60), 86_400) * 1000).toISOString();
    const key = this.backendKey(request.namespace, request.key, sessionId);
    const readExisting = async (): Promise<PgRow | undefined> => {
      const client = await acquirePgClient(this.pool, signal); const release = bindPgAbort(client, signal);
      try { await client.query("BEGIN"); await configurePgTimeout(client, options); const row = (await client.query<PgRow>("SELECT s.* FROM tessyl_storage_upload_sessions s JOIN tessyl_storage_object_keys k ON k.namespace=s.namespace AND k.session_id=s.session_id WHERE s.namespace=$1 AND s.idempotency_key=$2", [request.namespace, request.idempotencyKey])).rows[0]; await client.query("COMMIT"); return row; }
      catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { release(); }
    };
    const existing = await readExisting();
    if (existing) { if (String(existing.request_hash) !== requestHash) throw new StorageError("conflict", "Upload idempotency key was reused with different input", { operation: "object.initiate_upload" }); return this.sessionFromRow(existing, Number(existing.part_count), request.expiresInSeconds); }
    try { await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal }); throw new StorageError("conflict", "Object keys are immutable", { operation: "object.initiate_upload" }); }
    catch (error) { if (error instanceof StorageError) throw error; if (!isS3NotFound(error)) throw error; }
    const created = await this.s3.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: request.contentType, Metadata: { "tessyl-namespace": nsHash(request.namespace), "tessyl-sha256": request.checksumSha256.toLowerCase() } }), { abortSignal: signal });
    if (!created.UploadId) throw new StorageError("internal", "S3 did not return a multipart upload ID", { operation: "object.initiate_upload" });
    let database: PoolClient;
    try { database = await acquirePgClient(this.pool, signal); }
    catch (error) { await this.abortUpload(key, created.UploadId); throw error; }
    const release = bindPgAbort(database, signal); let conflict: unknown;
    try {
      await database.query("BEGIN"); await configurePgTimeout(database, options);
      await database.query("INSERT INTO tessyl_storage_object_keys(namespace,object_key,session_id) VALUES($1,$2,$3)", [request.namespace, request.key, sessionId]);
      await database.query("INSERT INTO tessyl_storage_upload_sessions(session_id,namespace,object_key,content_type,byte_length,checksum_sha256,metadata_json,idempotency_key,backend_upload_id,backend_key,expires_at,request_hash,part_count) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13)", [sessionId, request.namespace, request.key, request.contentType, bytes, request.checksumSha256.toLowerCase(), canonicalJson(request.applicationMetadata), request.idempotencyKey, created.UploadId, key, expiresAt, requestHash, request.partCount]);
      await database.query("COMMIT");
    } catch (error) {
      await database.query("ROLLBACK").catch(() => undefined);
      conflict = error;
    } finally { release(); }
    if (conflict) {
      await this.abortUpload(key, created.UploadId);
      if ((conflict as { code?: string }).code === "23505") { const winner = await readExisting(); if (winner && String(winner.request_hash) === requestHash) return this.sessionFromRow(winner, Number(winner.part_count), request.expiresInSeconds); }
      throw conflict;
    }
    return this.sessionFromRow({ session_id: sessionId, namespace: request.namespace, object_key: request.key, backend_key: key, backend_upload_id: created.UploadId, expires_at: expiresAt, part_count: request.partCount }, request.partCount, request.expiresInSeconds);
  }); }
  private async sessionFromRow(row: PgRow, partCount: number, expiresInSeconds: number): Promise<UploadSession> { const parts = await Promise.all(Array.from({ length: partCount }, async (_, index) => ({ partNumber: index + 1, url: await getSignedUrl(this.s3, new UploadPartCommand({ Bucket: this.bucket, Key: String(row.backend_key), UploadId: String(row.backend_upload_id), PartNumber: index + 1 }), { expiresIn: Math.min(Math.max(expiresInSeconds, 60), 86_400) }) }))); return { sessionId: String(row.session_id), namespace: String(row.namespace), key: String(row.object_key), expiresAt: new Date(row.expires_at as string).toISOString(), uploadHandle: String(row.backend_upload_id), parts }; }
  async completeUpload(namespace: string, sessionId: string, parts: readonly CompletedPart[] = [], options?: OperationOptions): Promise<ObjectMetadata> { return this.operation("object.complete_upload", options, async (signal) => {
    assertNamespace(namespace, this.limits); assertSessionId(sessionId); validateCompletedParts(parts, this.limits);
    const operationToken = crypto.randomUUID();
    const claim = async (): Promise<PgRow | undefined> => {
      for (;;) {
      const client = await acquirePgClient(this.pool, signal); const release = bindPgAbort(client, signal);
      let row: PgRow | undefined; let wait = false;
      try {
        await client.query("BEGIN"); await configurePgTimeout(client, options);
        row = (await client.query<PgRow>("SELECT s.* FROM tessyl_storage_upload_sessions s JOIN tessyl_storage_object_keys k ON k.namespace=s.namespace AND k.session_id=s.session_id WHERE s.namespace=$1 AND s.session_id=$2 FOR UPDATE OF s", [namespace, sessionId])).rows[0];
        if (row && !row.completed) {
          if (new Date(row.expires_at as string) < new Date()) throw new StorageError("failed_condition", "Upload session expired", { operation: "object.complete_upload" });
          const expectedParts = Number(row.part_count); const partNumbers = parts.map(({ partNumber }) => partNumber);
          if (parts.length !== expectedParts || new Set(partNumbers).size !== expectedParts || partNumbers.some((part, index) => part !== index + 1)) throw new StorageError("invalid_request", "Completed multipart parts must be unique, ordered, and complete", { operation: "object.complete_upload" });
          const active = row.operation_state && row.operation_started_at && Date.now() - new Date(row.operation_started_at as string).getTime() < 15 * 60_000;
          if (active) wait = true;
          else await client.query("UPDATE tessyl_storage_upload_sessions SET operation_state='completing',operation_token=$3,operation_started_at=now() WHERE namespace=$1 AND session_id=$2", [namespace, sessionId, operationToken]);
        }
        await client.query("COMMIT");
      }
      catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { release(); }
      if (!wait) return row;
      await abortableDelay(signal, 25);
      }
    };
    const row = await claim(); if (!row) throw new StorageError("not_found", "Upload session was not found", { operation: "object.complete_upload" });
    const objectKey = String(row.object_key); if (row.completed) return this.statInternal(namespace, objectKey, signal, options);
    let completed: { VersionId?: string; ETag?: string } = {}; let head; let actualChecksum: string;
    let heartbeatFailure: unknown; let renewal: Promise<void> | undefined;
    const renewLease = (): Promise<void> => {
      if (heartbeatFailure) return Promise.reject(heartbeatFailure);
      if (!renewal) renewal = this.renewSessionOperation(namespace, sessionId, "completing", operationToken, signal, options)
        .catch((error) => { heartbeatFailure = error; throw error; })
        .finally(() => { renewal = undefined; });
      return renewal;
    };
    const leaseTimer = setInterval(() => { void renewLease().catch(() => undefined); }, 30_000); leaseTimer.unref();
    try {
      await renewLease();
      try { head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: String(row.backend_key) }), { abortSignal: signal }); }
      catch (error) {
        if (!isS3NotFound(error)) throw error;
        try { completed = await this.s3.send(new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key: String(row.backend_key), UploadId: String(row.backend_upload_id), MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) } }), { abortSignal: signal }); }
        catch (completeError) { if (!isS3Absent(completeError)) throw completeError; }
        head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: String(row.backend_key) }), { abortSignal: signal });
      }
      await renewLease();
      if (Number(head.ContentLength) !== Number(row.byte_length)) { await this.deleteBackendObject(String(row.backend_key), signal, head.VersionId).catch(() => undefined); throw new StorageError("failed_condition", "Uploaded byte length does not match", { operation: "object.complete_upload" }); }
      actualChecksum = await this.hashObject(String(row.backend_key), signal, renewLease);
      await renewLease();
      if (actualChecksum !== String(row.checksum_sha256)) { await this.deleteBackendObject(String(row.backend_key), signal, head.VersionId).catch(() => undefined); throw new StorageError("failed_condition", "Uploaded checksum does not match", { operation: "object.complete_upload" }); }
    } catch (error) { clearInterval(leaseTimer); await renewal?.catch(() => undefined); await this.releaseSessionOperation(namespace, sessionId, "completing", operationToken); throw error; }
    clearInterval(leaseTimer); await renewal;
    const backendVersionId = completed.VersionId ?? head.VersionId;
    const version = backendVersionId ?? completed.ETag ?? head.ETag ?? actualChecksum;
    let client: PoolClient;
    try { client = await acquirePgClient(this.pool, signal); }
    catch (error) { await this.releaseSessionOperation(namespace, sessionId, "completing", operationToken); throw error; }
    const release = bindPgAbort(client, signal);
    try { await client.query("BEGIN"); await configurePgTimeout(client, options); const finalized = await client.query("UPDATE tessyl_storage_upload_sessions SET completed=true,version=$3,backend_version_id=$4,created_at=now(),operation_state=NULL,operation_token=NULL,operation_started_at=NULL WHERE namespace=$1 AND session_id=$2 AND completed=false AND operation_state='completing' AND operation_token=$5", [namespace, sessionId, version, backendVersionId ?? null, operationToken]); if (finalized.rowCount !== 1) throw new StorageError("unavailable", "Object completion lease was lost", { operation: "object.complete_upload", retryable: true }); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK").catch(() => undefined); release(); await this.releaseSessionOperation(namespace, sessionId, "completing", operationToken); throw error; }
    finally { release(); }
    return this.statInternal(namespace, objectKey, signal, options);
  }); }
  private async hashObject(key: string, signal: AbortSignal, heartbeat?: () => Promise<void>): Promise<string> { const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: signal }); if (!response.Body) throw new StorageError("internal", "S3 returned an empty body", { operation: "object.complete_upload" }); const hash = createHash("sha256"); let heartbeatAt = Date.now() + 30_000; for await (const chunk of response.Body as AsyncIterable<Uint8Array>) { if (signal.aborted) throw signal.reason; hash.update(chunk); if (heartbeat && Date.now() >= heartbeatAt) { await heartbeat(); heartbeatAt = Date.now() + 30_000; } } return hash.digest("hex"); }
  private async completedObjectRow(namespace: string, key: string, signal: AbortSignal, options?: OperationOptions): Promise<PgRow> {
    assertNamespace(namespace, this.limits); assertKey(key, this.limits);
    const client = await acquirePgClient(this.pool, signal); const release = bindPgAbort(client, signal); let row: PgRow | undefined;
    try { await client.query("BEGIN"); await configurePgTimeout(client, options); row = (await client.query<PgRow>("SELECT s.* FROM tessyl_storage_object_keys k JOIN tessyl_storage_upload_sessions s ON s.namespace=k.namespace AND s.session_id=k.session_id WHERE k.namespace=$1 AND k.object_key=$2 AND s.completed=true", [namespace, key])).rows[0]; await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { release(); }
    if (!row) throw new StorageError("not_found", "Object was not found", { operation: "object.stat" });
    return row;
  }
  private metadataFromRow(namespace: string, key: string, row: PgRow): ObjectMetadata { return { namespace, key, contentType: String(row.content_type), byteLength: String(row.byte_length), checksumSha256: String(row.checksum_sha256), applicationMetadata: typeof row.metadata_json === "string" ? safeJsonParse<MetadataEntry[]>(row.metadata_json, "object.stat") : row.metadata_json as MetadataEntry[], version: String(row.version), createdAt: new Date(row.created_at as string).toISOString() }; }
  private async statInternal(namespace: string, key: string, signal: AbortSignal, options?: OperationOptions): Promise<ObjectMetadata> {
    const row = await this.completedObjectRow(namespace, key, signal, options);
    try { await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: String(row.backend_key) }), { abortSignal: signal }); return this.metadataFromRow(namespace, key, row); }
    catch (error) { if (isS3NotFound(error)) throw new StorageError("not_found", "Object was not found", { operation: "object.stat" }); throw error; }
  }
  async stat(namespace: string, key: string, options?: OperationOptions): Promise<ObjectMetadata> { return this.operation("object.stat", options, (signal) => this.statInternal(namespace, key, signal, options)); }
  async resolveDownload(namespace: string, key: string, expiresInSeconds: number, options?: OperationOptions): Promise<DownloadResolution> { return this.operation("object.resolve_download", options, async (signal) => { if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 1) throw new StorageError("invalid_request", "Download expiry must be a positive integer", { operation: "object.resolve_download" }); const row = await this.completedObjectRow(namespace, key, signal, options); try { await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: String(row.backend_key) }), { abortSignal: signal }); } catch (error) { if (isS3NotFound(error)) throw new StorageError("not_found", "Object was not found", { operation: "object.resolve_download" }); throw error; } const seconds = Math.min(expiresInSeconds, 86_400); const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: String(row.backend_key) }), { expiresIn: seconds }); return { metadata: this.metadataFromRow(namespace, key, row), url, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() }; }); }
  async delete(namespace: string, key: string, expectedVersion?: string, options?: OperationOptions): Promise<void> { return this.operation("object.delete", options, async (signal) => {
    assertNamespace(namespace, this.limits); assertKey(key, this.limits);
    const operationToken = crypto.randomUUID(); let session: PgRow | undefined; let client: PoolClient; let release: () => void;
    for (;;) {
      client = await acquirePgClient(this.pool, signal); release = bindPgAbort(client, signal); let wait = false;
      try {
        await client.query("BEGIN"); await configurePgTimeout(client, options); session = (await client.query<PgRow>("SELECT s.* FROM tessyl_storage_object_keys k JOIN tessyl_storage_upload_sessions s ON s.namespace=k.namespace AND s.session_id=k.session_id WHERE k.namespace=$1 AND k.object_key=$2 AND s.completed=true FOR UPDATE OF s", [namespace, key])).rows[0];
        if (session) {
          if (expectedVersion && String(session.version) !== expectedVersion) throw new StorageError("failed_condition", "Object version does not match", { operation: "object.delete" });
          const active = session.operation_state && session.operation_started_at && Date.now() - new Date(session.operation_started_at as string).getTime() < 15 * 60_000;
          if (active) wait = true; else await client.query("UPDATE tessyl_storage_upload_sessions SET operation_state='deleting',operation_token=$3,operation_started_at=now() WHERE namespace=$1 AND session_id=$2", [namespace, session.session_id, operationToken]);
        }
        await client.query("COMMIT");
      }
      catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { release(); }
      if (!wait) break;
      await abortableDelay(signal, 25);
    }
    if (!session) return;
    try { await this.deleteBackendObject(String(session.backend_key), signal, typeof session.backend_version_id === "string" ? session.backend_version_id : undefined); }
    catch (error) { await this.releaseSessionOperation(namespace, String(session.session_id), "deleting", operationToken); throw error; }
    try { client = await acquirePgClient(this.pool, signal); }
    catch (error) { await this.releaseSessionOperation(namespace, String(session.session_id), "deleting", operationToken); throw error; }
    release = bindPgAbort(client, signal);
    try {
      await client.query("BEGIN"); await configurePgTimeout(client, options);
      const deletion = await client.query("DELETE FROM tessyl_storage_upload_sessions WHERE namespace=$1 AND session_id=$2 AND completed=true AND operation_state='deleting' AND operation_token=$3", [namespace, session.session_id, operationToken]);
      if (deletion.rowCount !== 1) throw new StorageError("unavailable", "Object deletion lease was lost", { operation: "object.delete", retryable: true });
      await client.query("DELETE FROM tessyl_storage_object_keys WHERE namespace=$1 AND session_id=$2", [namespace, session.session_id]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); release(); await this.releaseSessionOperation(namespace, String(session.session_id), "deleting", operationToken); throw error; }
    finally { release(); }
  }); }
  async cleanupAbandoned(namespace: string, before: string, limit: number, options?: OperationOptions): Promise<number> { return this.operation("object.cleanup_abandoned", options, async (signal) => {
    assertNamespace(namespace, this.limits); const requested = new Date(before);
    if (Number.isNaN(requested.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > this.limits.maxResultCount) throw new StorageError("invalid_request", "Invalid cleanup request", { operation: "object.cleanup_abandoned" });
    const cutoff = new Date(Math.min(requested.getTime(), Date.now())).toISOString(); let client = await acquirePgClient(this.pool, signal); let release = bindPgAbort(client, signal); let rows: PgRow[];
    try {
      await client.query("BEGIN"); await configurePgTimeout(client, options);
      rows = (await client.query<PgRow>("SELECT * FROM tessyl_storage_upload_sessions WHERE namespace=$1 AND completed=false AND expires_at<$2 AND (operation_state IS NULL OR operation_started_at < now() - interval '15 minutes') ORDER BY expires_at LIMIT $3 FOR UPDATE SKIP LOCKED", [namespace, cutoff, limit])).rows;
      for (const row of rows) { const token = crypto.randomUUID(); await client.query("UPDATE tessyl_storage_upload_sessions SET operation_state='cleaning',operation_token=$3,operation_started_at=now() WHERE namespace=$1 AND session_id=$2", [namespace, row.session_id, token]); row.operation_token = token; }
      await client.query("COMMIT");
    }
    catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { release(); }
    let removed = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      try {
        try { await this.s3.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: String(row.backend_key), UploadId: String(row.backend_upload_id) }), { abortSignal: signal }); }
        catch (error) { if (!isS3Absent(error)) throw error; }
        await this.deleteBackendObject(String(row.backend_key), signal, typeof row.backend_version_id === "string" ? row.backend_version_id : undefined);
        client = await acquirePgClient(this.pool, signal); release = bindPgAbort(client, signal);
        try { await client.query("BEGIN"); await configurePgTimeout(client, options); const deletion = await client.query("DELETE FROM tessyl_storage_upload_sessions WHERE namespace=$1 AND session_id=$2 AND completed=false AND operation_state='cleaning' AND operation_token=$3", [namespace, row.session_id, row.operation_token]); if (deletion.rowCount) { await client.query("DELETE FROM tessyl_storage_object_keys WHERE namespace=$1 AND session_id=$2", [namespace, row.session_id]); removed += 1; } await client.query("COMMIT"); }
        catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
        finally { release(); }
      } catch (error) { await Promise.all(rows.slice(index).map((claimed) => this.releaseSessionOperation(namespace, String(claimed.session_id), "cleaning", String(claimed.operation_token)))); throw error; }
    }
    return removed;
  }); }
  async health(options?: OperationOptions): Promise<HealthStatus> { const startedAt = Date.now(); return this.operation("object.health", options, async (signal) => { await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }), { abortSignal: signal }); return { capability: "object", ready: true, message: "ready", latencyMs: Date.now() - startedAt }; }); }
  async close(): Promise<void> { /* shared client lifetime is owned by the composition */ }
}

const isS3NotFound = (error: unknown): boolean => (error as { $metadata?: { httpStatusCode?: number }; name?: string }).$metadata?.httpStatusCode === 404 || (error as { name?: string }).name === "NotFound";
const isS3Absent = (error: unknown): boolean => isS3NotFound(error) || (error as { name?: string }).name === "NoSuchUpload";
const abortableDelay = async (signal: AbortSignal, milliseconds: number): Promise<void> => new Promise((resolve, reject) => { const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds); const abort = (): void => { clearTimeout(timer); reject(signal.reason); }; signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); });
const jitter = async (attempt: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * Math.min(1_000, 25 * 2 ** attempt))));

export const createHostedStorage = async (options: HostedStorageOptions): Promise<StorageComposition> => {
  if (!options.bucket) throw new StorageError("invalid_request", "Hosted storage requires an S3 bucket", { operation: "hosted.create" });
  if (options.maxConcurrency !== undefined && (!Number.isSafeInteger(options.maxConcurrency) || options.maxConcurrency < 1)) throw new StorageError("invalid_request", "maxConcurrency must be a positive integer", { operation: "hosted.create" });
  if (options.retryAttempts !== undefined && (!Number.isSafeInteger(options.retryAttempts) || options.retryAttempts < 1)) throw new StorageError("invalid_request", "retryAttempts must be a positive integer", { operation: "hosted.create" });
  if (options.allowBlockingMigrations !== undefined && typeof options.allowBlockingMigrations !== "boolean") throw new StorageError("invalid_request", "allowBlockingMigrations must be a boolean", { operation: "hosted.create" });
  const limits = mergeLimits(options.limits); const semaphore = new Semaphore(options.maxConcurrency ?? 64);
  let pool: Pool | undefined; let openSearch: OpenSearchClient | undefined; let s3: S3Client | undefined;
  let ownsPool = false; let ownsSearch = false; let ownsS3 = false; let closed = false;
  const owner = { async close(): Promise<void> { if (closed) return; closed = true; await Promise.allSettled([ownsSearch && openSearch ? openSearch.close() : Promise.resolve(), Promise.resolve(ownsS3 && s3 ? s3.destroy() : undefined), ownsPool && pool ? pool.end() : Promise.resolve()]); } };
  try {
    ownsPool = !("query" in options.postgres); pool = ownsPool ? new pg.Pool(options.postgres as PoolConfig) : options.postgres as Pool;
    ownsSearch = !(options.openSearch instanceof OpenSearchClient); openSearch = ownsSearch ? new OpenSearchClient(options.openSearch as OpenSearchClientOptions) : options.openSearch as OpenSearchClient;
    ownsS3 = !(options.s3 instanceof S3Client); s3 = ownsS3 ? new S3Client(options.s3 as S3ClientConfig) : options.s3 as S3Client;
    const document = new HostedDocumentStore(pool, limits, semaphore, options.observability, options.retryAttempts, ownsPool, options.allowBlockingMigrations); await document.initialize();
    const searchIndex = new HostedSearchIndexService(openSearch, pool, limits, semaphore, options.observability, ownsSearch); const search = new HostedSearchService(openSearch, limits, semaphore, options.observability);
    const object = new HostedObjectStore(s3, pool, options.bucket, options.keyPrefix ? `${options.keyPrefix.replace(/^\/+|\/+$/g, "")}/` : "tessyl/", limits, semaphore, options.observability, ownsS3);
    for (const provider of [document, search, searchIndex, object]) attachStorageOwner(provider, owner);
    return Object.freeze({ document, search, searchIndex, object, async health(operationOptions: OperationOptions | undefined) { return Promise.all([document.health(operationOptions), search.health(operationOptions), searchIndex.health(operationOptions), object.health(operationOptions)]); }, async close() { await owner.close(); } });
  } catch (error) { await owner.close(); throw error; }
};
