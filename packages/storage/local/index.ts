import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import { copyFile, mkdir, readdir, realpath, rm, stat as fileStat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  type CompletedPart,
  type DocumentPage,
  type DocumentStore,
  type DownloadResolution,
  type FacetBucket,
  type HealthStatus,
  type IndexDefinition,
  type IndexQuery,
  type ObjectMetadata,
  type ObjectStore,
  type ObservabilityHook,
  type OperationOptions,
  type OutboxClaimRequest,
  type OutboxRecord,
  type PortableScalar,
  type SearchDocument,
  type SearchFacet,
  type SearchHighlight,
  type SearchHit,
  type SearchGenerationPage,
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

export interface LocalStorageOptions {
  dataDirectory: string;
  limits?: Partial<StorageLimits>;
  observability?: ObservabilityHook;
  busyTimeoutMs?: number;
}

type Row = Record<string, SQLInputValue>;

class LocalDatabase {
  readonly db: DatabaseSync;
  #closed = false;

  constructor(readonly dataDirectory: string, busyTimeoutMs: number) {
    this.db = new DatabaseSync(path.join(dataDirectory, "storage.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = ${Math.max(1, Math.floor(busyTimeoutMs))};
    `);
    try { this.migrate(); }
    catch (error) { this.db.close(); this.#closed = true; throw error; }
  }

  private migrate(): void {
    this.db.exec("BEGIN EXCLUSIVE");
    try {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS storage_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      INSERT OR IGNORE INTO storage_meta(key, value) VALUES ('schema_version', '1');
      CREATE TABLE IF NOT EXISTS storage_table_definitions (
        namespace TEXT NOT NULL,
        table_name TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        definition_hash TEXT NOT NULL,
        definition_json TEXT NOT NULL,
        PRIMARY KEY(namespace, table_name)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS storage_documents (
        namespace TEXT NOT NULL,
        table_name TEXT NOT NULL,
        document_key TEXT NOT NULL,
        version INTEGER NOT NULL,
        body_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(namespace, table_name, document_key),
        FOREIGN KEY(namespace, table_name) REFERENCES storage_table_definitions(namespace, table_name)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS storage_document_versions (
        namespace TEXT NOT NULL,
        table_name TEXT NOT NULL,
        document_key TEXT NOT NULL,
        version INTEGER NOT NULL,
        PRIMARY KEY(namespace, table_name, document_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS storage_index_entries (
        namespace TEXT NOT NULL,
        table_name TEXT NOT NULL,
        index_name TEXT NOT NULL,
        sort_key TEXT NOT NULL,
        values_json TEXT NOT NULL,
        document_key TEXT NOT NULL,
        PRIMARY KEY(namespace, table_name, index_name, document_key),
        FOREIGN KEY(namespace, table_name, document_key) REFERENCES storage_documents(namespace, table_name, document_key) ON DELETE CASCADE
      ) STRICT;
      CREATE INDEX IF NOT EXISTS storage_index_lookup
        ON storage_index_entries(namespace, table_name, index_name, sort_key, document_key);
      CREATE TABLE IF NOT EXISTS storage_idempotency (
        namespace TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(namespace, idempotency_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS storage_search_indices (
        namespace TEXT NOT NULL,
        logical_name TEXT NOT NULL,
        physical_name TEXT NOT NULL,
        schema_json TEXT NOT NULL,
        generation INTEGER NOT NULL,
        active INTEGER NOT NULL,
        PRIMARY KEY(namespace, physical_name)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS storage_search_active_alias
        ON storage_search_indices(namespace, logical_name) WHERE active = 1;
      CREATE TABLE IF NOT EXISTS storage_search_generation_counters (
        namespace TEXT NOT NULL,
        logical_name TEXT NOT NULL,
        generation INTEGER NOT NULL,
        PRIMARY KEY(namespace, logical_name)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS storage_search_documents (
        namespace TEXT NOT NULL,
        physical_name TEXT NOT NULL,
        document_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        fields_json TEXT NOT NULL,
        filters_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        locale TEXT NOT NULL,
        PRIMARY KEY(namespace, physical_name, document_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS storage_search_versions (
        namespace TEXT NOT NULL,
        physical_name TEXT NOT NULL,
        document_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        deleted INTEGER NOT NULL,
        PRIMARY KEY(namespace, physical_name, document_id)
      ) STRICT;
      CREATE VIRTUAL TABLE IF NOT EXISTS storage_search_fts USING fts5(
        namespace UNINDEXED,
        physical_name UNINDEXED,
        document_id UNINDEXED,
        content,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS storage_objects (
        namespace TEXT NOT NULL,
        object_key TEXT NOT NULL,
        content_type TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        version TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(namespace, object_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS storage_upload_sessions (
        session_id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        object_key TEXT NOT NULL,
        content_type TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        checksum_sha256 TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        temp_path TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        part_count INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        operation_state TEXT,
        operation_token TEXT,
        operation_started_at TEXT,
        UNIQUE(namespace, idempotency_key)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS storage_object_keys (
        namespace TEXT NOT NULL,
        object_key TEXT NOT NULL,
        session_id TEXT NOT NULL,
        PRIMARY KEY(namespace, object_key),
        UNIQUE(session_id)
      ) STRICT;
      `);
      const version = Number((this.db.prepare("SELECT value FROM storage_meta WHERE key='schema_version'").get() as Row).value);
      if (!Number.isSafeInteger(version) || version < 1) throw new StorageError("internal", "Local storage schema version is invalid", { operation: "local.migrate" });
      if (version > 4) throw new StorageError("conflict", "Local storage database is newer than this binary", { operation: "local.migrate" });
      if (version < 2) {
        const uploadColumns = new Set((this.db.prepare("PRAGMA table_info(storage_upload_sessions)").all() as Row[]).map((row) => String(row.name)));
        if (!uploadColumns.has("request_hash")) this.db.exec("ALTER TABLE storage_upload_sessions ADD COLUMN request_hash TEXT NOT NULL DEFAULT ''");
        if (!uploadColumns.has("part_count")) this.db.exec("ALTER TABLE storage_upload_sessions ADD COLUMN part_count INTEGER NOT NULL DEFAULT 1");
        this.db.exec(`
          INSERT OR IGNORE INTO storage_search_versions(namespace,physical_name,document_id,version,deleted)
            SELECT namespace,physical_name,document_id,version,0 FROM storage_search_documents;
          INSERT OR IGNORE INTO storage_document_versions(namespace,table_name,document_key,version)
            SELECT namespace,table_name,document_key,version FROM storage_documents;
          INSERT OR IGNORE INTO storage_object_keys(namespace,object_key,session_id)
            SELECT s.namespace,s.object_key,MIN(s.session_id) FROM storage_upload_sessions s
              JOIN storage_objects o ON o.namespace=s.namespace AND o.object_key=s.object_key
                AND o.content_type=s.content_type AND o.byte_length=s.byte_length
                AND o.checksum_sha256=s.checksum_sha256 AND o.metadata_json=s.metadata_json
              WHERE s.completed=1 GROUP BY s.namespace,s.object_key HAVING COUNT(*)=1;
          INSERT INTO storage_upload_sessions(session_id,namespace,object_key,content_type,byte_length,checksum_sha256,metadata_json,idempotency_key,temp_path,expires_at,request_hash,part_count,completed)
            SELECT 'legacy-object:' || hex(randomblob(16)),o.namespace,o.object_key,o.content_type,o.byte_length,o.checksum_sha256,o.metadata_json,
              'legacy:' || hex(randomblob(16)),o.file_path,o.created_at,'',1,1
            FROM storage_objects o WHERE NOT EXISTS (
              SELECT 1 FROM storage_object_keys k WHERE k.namespace=o.namespace AND k.object_key=o.object_key
            );
          INSERT OR IGNORE INTO storage_object_keys(namespace,object_key,session_id)
            SELECT o.namespace,o.object_key,s.session_id FROM storage_objects o
              JOIN storage_upload_sessions s ON s.namespace=o.namespace AND s.object_key=o.object_key AND s.completed=1
              WHERE s.session_id LIKE 'legacy-object:%';
        `);
        this.db.prepare("UPDATE storage_meta SET value='2' WHERE key='schema_version'").run();
      }
      if (version < 3) {
        const uploadColumns = new Set((this.db.prepare("PRAGMA table_info(storage_upload_sessions)").all() as Row[]).map((row) => String(row.name)));
        if (!uploadColumns.has("operation_state")) this.db.exec("ALTER TABLE storage_upload_sessions ADD COLUMN operation_state TEXT");
        if (!uploadColumns.has("operation_token")) this.db.exec("ALTER TABLE storage_upload_sessions ADD COLUMN operation_token TEXT");
        if (!uploadColumns.has("operation_started_at")) this.db.exec("ALTER TABLE storage_upload_sessions ADD COLUMN operation_started_at TEXT");
        this.db.prepare("UPDATE storage_meta SET value='3' WHERE key='schema_version'").run();
      }
      if (version < 4) {
        this.db.exec(`INSERT INTO storage_search_generation_counters(namespace,logical_name,generation)
          SELECT namespace,logical_name,MAX(generation) FROM storage_search_indices GROUP BY namespace,logical_name
          ON CONFLICT(namespace,logical_name) DO UPDATE SET generation=MAX(generation,excluded.generation)`);
        this.db.prepare("UPDATE storage_meta SET value='4' WHERE key='schema_version'").run();
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve migration failure */ }
      throw error;
    }
  }

  transaction<T>(run: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = run();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve original error */ }
      throw error;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.db.close();
  }
}

const MUTATING_OPERATIONS = new Set([
  "document.migrate_table", "document.transact", "document.claim_outbox", "document.complete_outbox", "document.retry_outbox",
  "search_index.create", "search_index.begin_rebuild", "search_index.cutover", "search_index.delete_generation", "search_index.upsert", "search_index.delete",
  "object.initiate_upload", "object.complete_upload", "object.delete", "object.cleanup_abandoned",
]);

abstract class LocalService {
  constructor(
    protected readonly backend: LocalDatabase,
    protected readonly limits: Readonly<StorageLimits>,
    private readonly capability: HealthStatus["capability"],
    protected readonly observe?: ObservabilityHook,
  ) {}

  protected async operation<T>(name: string, options: OperationOptions | undefined, run: () => T | Promise<T>): Promise<T> {
    const startedAt = Date.now();
    try {
      const value = await withOperationTimeout(name, options, async (signal) => {
        if (signal.aborted) throw new StorageError("cancelled", "Operation was cancelled", { operation: name, retryable: false });
        return run();
      }, MUTATING_OPERATIONS.has(name));
      try { this.observe?.({ operation: name, backend: "local", startedAt, durationMs: Date.now() - startedAt, success: true }); } catch { /* telemetry cannot alter storage outcomes */ }
      return value;
    } catch (error) {
      const candidate = error as { code?: string; errcode?: number; message?: string };
      const mapped = candidate.code === "ERR_SQLITE_ERROR" && (candidate.errcode === 5 || /database (?:is )?(?:locked|busy)/i.test(candidate.message ?? ""))
        ? new StorageError("unavailable", "Local storage database is busy", { operation: name, cause: error, retryable: true })
        : asStorageError(error, name);
      try { this.observe?.({ operation: name, backend: "local", startedAt, durationMs: Date.now() - startedAt, success: false, errorCode: mapped.code }); } catch { /* preserve the storage error */ }
      throw mapped;
    }
  }

  async health(options?: OperationOptions): Promise<HealthStatus> {
    const startedAt = Date.now();
    return this.operation(`${this.capability}.health`, options, () => {
      this.backend.db.prepare("SELECT 1 AS ok").get();
      return { capability: this.capability, ready: true, message: "ready", latencyMs: Date.now() - startedAt };
    });
  }

  async close(): Promise<void> {
    // Shared backend lifetime is owned by the composition.
  }
}

const asStoredDocument = (row: Row): StoredDocument => ({
  namespace: String(row.namespace),
  table: String(row.table_name),
  key: String(row.document_key),
  version: String(row.version),
  bodyJson: String(row.body_json),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const assertCondition = (condition: WriteCondition, current: Row | undefined, operation: string): void => {
  const exists = current !== undefined;
  if (condition.kind === "absent" && exists) throw new StorageError("failed_condition", "Document already exists", { operation });
  if (condition.kind === "present" && !exists) throw new StorageError("failed_condition", "Document does not exist", { operation });
  if (condition.kind === "version_equals" && (!exists || String(current.version) !== condition.version)) {
    throw new StorageError("failed_condition", "Document version does not match", { operation, details: { expectedVersion: condition.version, actualVersion: current ? String(current.version) : null } });
  }
};

export class LocalDocumentStore extends LocalService implements DocumentStore {
  constructor(backend: LocalDatabase, limits: Readonly<StorageLimits>, observe?: ObservabilityHook) {
    super(backend, limits, "document", observe);
  }

  async migrateTable(namespace: string, definition: TableDefinition, options?: OperationOptions): Promise<TableInspection> {
    return this.operation("document.migrate_table", options, () => {
      assertNamespace(namespace, this.limits);
      validateTableDefinition(definition, this.limits);
      const hash = definitionHash(definition);
      this.backend.transaction(() => {
        const existing = this.backend.db.prepare("SELECT * FROM storage_table_definitions WHERE namespace = ? AND table_name = ?").get(namespace, definition.name) as Row | undefined;
        if (existing && String(existing.definition_hash) === hash) return;
        if (existing && Number(existing.schema_version) >= definition.schemaVersion) {
          throw new StorageError("conflict", "Index definition changed without a higher schemaVersion", { operation: "document.migrate_table", details: { currentHash: existing.definition_hash, requestedHash: hash } });
        }
        if (existing) {
          this.backend.db.prepare("UPDATE storage_table_definitions SET schema_version = ?, definition_hash = ?, definition_json = ? WHERE namespace = ? AND table_name = ?")
            .run(definition.schemaVersion, hash, canonicalJson(definition), namespace, definition.name);
          this.backend.db.prepare("DELETE FROM storage_index_entries WHERE namespace = ? AND table_name = ?").run(namespace, definition.name);
          const rows = this.backend.db.prepare("SELECT * FROM storage_documents WHERE namespace = ? AND table_name = ? ORDER BY document_key").iterate(namespace, definition.name) as Iterable<Row>;
          for (const row of rows) this.writeIndexEntries(namespace, definition, String(row.document_key), parsePortableDocument(String(row.body_json), this.limits));
        } else {
          this.backend.db.prepare("INSERT INTO storage_table_definitions(namespace, table_name, schema_version, definition_hash, definition_json) VALUES (?, ?, ?, ?, ?)")
            .run(namespace, definition.name, definition.schemaVersion, hash, canonicalJson(definition));
        }
      });
      return this.inspectTableSync(namespace, definition.name);
    });
  }

  async inspectTable(namespace: string, table: string, options?: OperationOptions): Promise<TableInspection> {
    return this.operation("document.inspect_table", options, () => {
      assertNamespace(namespace, this.limits);
      assertName(table, "table name", this.limits);
      return this.inspectTableSync(namespace, table);
    });
  }

  private inspectTableSync(namespace: string, table: string): TableInspection {
    const row = this.backend.db.prepare(`SELECT d.*, (SELECT COUNT(*) FROM storage_documents x WHERE x.namespace = d.namespace AND x.table_name = d.table_name) AS document_count FROM storage_table_definitions d WHERE namespace = ? AND table_name = ?`).get(namespace, table) as Row | undefined;
    if (!row) throw new StorageError("not_found", `Table ${table} is not declared`, { operation: "document.inspect_table" });
    return { definition: safeJsonParse<TableDefinition>(String(row.definition_json), "document.inspect_table"), definitionHash: String(row.definition_hash), documentCount: Number(row.document_count) };
  }

  async get(namespace: string, table: string, key: string, options?: OperationOptions): Promise<StoredDocument> {
    return this.operation("document.get", options, () => {
      assertNamespace(namespace, this.limits);
      assertName(table, "table name", this.limits);
      assertKey(key, this.limits);
      const row = this.backend.db.prepare("SELECT * FROM storage_documents WHERE namespace = ? AND table_name = ? AND document_key = ?").get(namespace, table, key) as Row | undefined;
      if (!row) throw new StorageError("not_found", "Document was not found", { operation: "document.get" });
      return asStoredDocument(row);
    });
  }

  async transact(request: TransactionRequest, options?: OperationOptions): Promise<TransactionResult> {
    return this.operation("document.transact", options, () => {
      validateTransactionRequest(request, this.limits);
      const requestHash = definitionHash(request);
      return this.backend.transaction(() => {
        if (request.idempotencyKey) {
          const replay = this.backend.db.prepare("SELECT request_hash, response_json FROM storage_idempotency WHERE namespace = ? AND idempotency_key = ?").get(request.namespace, request.idempotencyKey) as Row | undefined;
          if (replay) {
            if (String(replay.request_hash) !== requestHash) throw new StorageError("conflict", "Idempotency key was reused with a different transaction", { operation: "document.transact" });
            return { ...safeJsonParse<TransactionResult>(String(replay.response_json), "document.transact"), replayed: true };
          }
        }
        const documents: StoredDocument[] = [];
        const deletedKeys: string[] = [];
        for (const mutation of request.operations) {
          assertName(mutation.table, "table name", this.limits);
          assertKey(mutation.key, this.limits);
          const definition = this.inspectTableSync(request.namespace, mutation.table).definition;
          const current = this.backend.db.prepare("SELECT * FROM storage_documents WHERE namespace = ? AND table_name = ? AND document_key = ?").get(request.namespace, mutation.table, mutation.key) as Row | undefined;
          const versionState = this.backend.db.prepare("SELECT version FROM storage_document_versions WHERE namespace=? AND table_name=? AND document_key=?").get(request.namespace, mutation.table, mutation.key) as Row | undefined;
          assertCondition(mutation.condition, current, "document.transact");
          if (mutation.kind === "delete") {
            if (current) { const deletedVersion = Number(versionState?.version ?? current.version) + 1; this.backend.db.prepare(`INSERT INTO storage_document_versions(namespace,table_name,document_key,version) VALUES(?,?,?,?) ON CONFLICT(namespace,table_name,document_key) DO UPDATE SET version=excluded.version`).run(request.namespace, mutation.table, mutation.key, deletedVersion); this.backend.db.prepare("DELETE FROM storage_documents WHERE namespace = ? AND table_name = ? AND document_key = ?").run(request.namespace, mutation.table, mutation.key); }
            deletedKeys.push(`${mutation.table}:${mutation.key}`);
            continue;
          }
          const body = parsePortableDocument(mutation.bodyJson, this.limits);
          const now = new Date().toISOString();
          const version = Number(versionState?.version ?? current?.version ?? 0) + 1;
          this.backend.db.prepare(`INSERT INTO storage_documents(namespace, table_name, document_key, version, body_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(namespace, table_name, document_key) DO UPDATE SET version = excluded.version, body_json = excluded.body_json, updated_at = excluded.updated_at`)
            .run(request.namespace, mutation.table, mutation.key, version, mutation.bodyJson, current ? String(current.created_at) : now, now);
          this.backend.db.prepare("DELETE FROM storage_index_entries WHERE namespace = ? AND table_name = ? AND document_key = ?").run(request.namespace, mutation.table, mutation.key);
          this.backend.db.prepare(`INSERT INTO storage_document_versions(namespace,table_name,document_key,version) VALUES(?,?,?,?) ON CONFLICT(namespace,table_name,document_key) DO UPDATE SET version=excluded.version`).run(request.namespace, mutation.table, mutation.key, version);
          this.writeIndexEntries(request.namespace, definition, mutation.key, body);
          const stored = this.backend.db.prepare("SELECT * FROM storage_documents WHERE namespace = ? AND table_name = ? AND document_key = ?").get(request.namespace, mutation.table, mutation.key) as Row;
          documents.push(asStoredDocument(stored));
        }
        const result: TransactionResult = { documents, deletedKeys, replayed: false };
        if (request.idempotencyKey) this.backend.db.prepare("INSERT INTO storage_idempotency(namespace, idempotency_key, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)").run(request.namespace, request.idempotencyKey, requestHash, JSON.stringify(result), new Date().toISOString());
        return result;
      });
    });
  }

  private writeIndexEntries(namespace: string, definition: TableDefinition, key: string, document: Record<string, unknown>): void {
    if (definition.indexes.length > this.limits.maxIndexEntriesPerDocument) throw new StorageError("limit_exceeded", "Document index entry count exceeds configured limit", { operation: "document.transact" });
    for (const index of definition.indexes) {
      const values = extractIndexValues(document, index);
      if (!values) continue;
      const valuesJson = canonicalJson(values);
      const sortKey = encodeIndexValues(values);
      if (index.unique) {
        const conflict = this.backend.db.prepare("SELECT document_key FROM storage_index_entries WHERE namespace = ? AND table_name = ? AND index_name = ? AND values_json = ? AND document_key <> ? LIMIT 1").get(namespace, definition.name, index.name, valuesJson, key) as Row | undefined;
        if (conflict) throw new StorageError("conflict", `Unique index ${index.name} conflicts with another document`, { operation: "document.transact", details: { index: index.name, conflictingKey: conflict.document_key } });
      }
      this.backend.db.prepare("INSERT INTO storage_index_entries(namespace, table_name, index_name, sort_key, values_json, document_key) VALUES (?, ?, ?, ?, ?, ?)").run(namespace, definition.name, index.name, sortKey, valuesJson, key);
    }
  }

  async query(request: IndexQuery, options?: OperationOptions): Promise<DocumentPage> {
    return this.operation("document.query", options, () => {
      validateIndexQuery(request, this.limits);
      const definition = this.inspectTableSync(request.namespace, request.table).definition;
      const index = definition.indexes.find((candidate) => candidate.name === request.index);
      if (!index) throw new StorageError("not_found", `Index ${request.index} is not declared`, { operation: "document.query" });
      validateQueryValues(index, request.prefix, "prefix");
      if (request.lower) validateQueryValues(index, request.lower, "lower");
      if (request.upper) validateQueryValues(index, request.upper, "upper");
      if ((request.lower || request.upper || request.order === "desc") && !index.ordered) throw new StorageError("invalid_request", `Index ${index.name} does not support ordered queries`, { operation: "document.query" });
      const { cursor: _cursor, ...queryShape } = request; const queryHash = definitionHash(queryShape);
      const cursor = decodeCursor<{ sortKey: string; documentKey: string; queryHash: string }>(request.cursor, "document.query");
      if (cursor && (typeof cursor.sortKey !== "string" || typeof cursor.documentKey !== "string" || cursor.queryHash !== queryHash)) throw new StorageError("invalid_request", "Cursor does not match query", { operation: "document.query" });
      const clauses = ["e.namespace = ?", "e.table_name = ?", "e.index_name = ?"];
      const params: SQLInputValue[] = [request.namespace, request.table, request.index];
      if (request.prefix.length > 0) {
        const prefix = encodeIndexValues(request.prefix);
        clauses.push("(e.sort_key = ? OR e.sort_key LIKE ? ESCAPE '\\')");
        params.push(prefix, `${prefix}.%`);
      }
      if (request.lower) { clauses.push(`e.sort_key ${request.lowerInclusive === false ? ">" : ">="} ?`); params.push(encodeIndexValues(request.lower)); }
      if (request.upper) { clauses.push(`e.sort_key ${request.upperInclusive === false ? "<" : "<="} ?`); params.push(encodeIndexValues(request.upper)); }
      const direction = request.order === "asc" ? "ASC" : "DESC";
      if (cursor) {
        const operator = request.order === "asc" ? ">" : "<";
        clauses.push(`(e.sort_key ${operator} ? OR (e.sort_key = ? AND e.document_key ${operator} ?))`);
        params.push(cursor.sortKey, cursor.sortKey, cursor.documentKey);
      }
      params.push(request.limit + 1);
      const rows = this.backend.db.prepare(`SELECT e.sort_key, e.document_key, d.* FROM storage_index_entries e JOIN storage_documents d ON d.namespace=e.namespace AND d.table_name=e.table_name AND d.document_key=e.document_key WHERE ${clauses.join(" AND ")} ORDER BY e.sort_key ${direction}, e.document_key ${direction} LIMIT ?`).all(...params) as Row[];
      const pageRows = rows.slice(0, request.limit);
      const next = rows.length > request.limit && pageRows.length > 0 ? pageRows.at(-1) : undefined;
      return {
        documents: pageRows.map(asStoredDocument),
        ...(next ? { cursor: encodeCursor({ sortKey: String(next.sort_key), documentKey: String(next.document_key), queryHash }) } : {}),
      };
    });
  }

  async claimOutbox(request: OutboxClaimRequest, options?: OperationOptions): Promise<readonly OutboxRecord[]> {
    return this.operation("document.claim_outbox", options, () => {
      assertNamespace(request.namespace, this.limits);
      assertName(request.table, "table name", this.limits);
      assertKey(request.workerId, this.limits);
      if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > this.limits.maxResultCount) throw new StorageError("limit_exceeded", "Outbox claim limit is invalid", { operation: "document.claim_outbox" });
      const now = new Date(request.now);
      if (Number.isNaN(now.getTime()) || !Number.isSafeInteger(request.leaseSeconds) || request.leaseSeconds < 1 || request.leaseSeconds > MAX_OUTBOX_LEASE_SECONDS) throw new StorageError("invalid_request", "Invalid outbox lease", { operation: "document.claim_outbox" });
      return this.backend.transaction(() => {
        const definition = this.inspectTableSync(request.namespace, request.table).definition;
        const candidates = this.backend.db.prepare(`SELECT * FROM storage_documents
          WHERE namespace=? AND table_name=?
            AND json_extract(body_json, '$.processed_at') IS NULL
            AND julianday(json_extract(body_json, '$.available_at')) <= julianday(?)
            AND (json_extract(body_json, '$.lease_until') IS NULL OR julianday(json_extract(body_json, '$.lease_until')) <= julianday(?))
          ORDER BY json_extract(body_json, '$.available_at'), document_key LIMIT ?`).all(request.namespace, request.table, now.toISOString(), now.toISOString(), request.limit) as Row[];
        const claimed: OutboxRecord[] = [];
        for (const row of candidates) {
          if (claimed.length >= request.limit) break;
          const body = parsePortableDocument(String(row.body_json), this.limits);
          if (body.processed_at !== null && body.processed_at !== undefined) continue;
          const availableAt = new Date(String(body.available_at ?? ""));
          const leaseUntil = body.lease_until ? new Date(String(body.lease_until)) : undefined;
          if (Number.isNaN(availableAt.getTime()) || availableAt > now || (leaseUntil && !Number.isNaN(leaseUntil.getTime()) && leaseUntil > now)) continue;
          const leaseToken = `${request.workerId}:${randomUUID()}`;
          const priorAttempt = body.attempt ?? 0;
          if (!Number.isSafeInteger(priorAttempt) || Number(priorAttempt) < 0 || Number(priorAttempt) >= Number.MAX_SAFE_INTEGER) throw new StorageError("invalid_request", "Outbox attempt must be a nonnegative safe integer", { operation: "document.claim_outbox" });
          const attempt = Number(priorAttempt) + 1;
          body.lease_token = leaseToken;
          body.lease_until = new Date(now.getTime() + request.leaseSeconds * 1000).toISOString();
          body.attempt = attempt;
          const version = Number(row.version) + 1;
          const updatedAt = new Date().toISOString();
          const bodyJson = canonicalJson(body);
          parsePortableDocument(bodyJson, this.limits);
          this.backend.db.prepare("UPDATE storage_documents SET body_json = ?, version = ?, updated_at = ? WHERE namespace = ? AND table_name = ? AND document_key = ? AND version = ?").run(bodyJson, version, updatedAt, request.namespace, request.table, row.document_key, row.version);
          this.backend.db.prepare("UPDATE storage_document_versions SET version=? WHERE namespace=? AND table_name=? AND document_key=?").run(version, request.namespace, request.table, row.document_key);
          this.backend.db.prepare("DELETE FROM storage_index_entries WHERE namespace = ? AND table_name = ? AND document_key = ?").run(request.namespace, request.table, row.document_key);
          this.writeIndexEntries(request.namespace, definition, String(row.document_key), body);
          claimed.push({ document: { ...asStoredDocument(row), version: String(version), bodyJson, updatedAt }, leaseToken, attempt });
        }
        return claimed;
      });
    });
  }

  async completeOutbox(namespace: string, table: string, key: string, leaseToken: string, options?: OperationOptions): Promise<void> {
    return this.updateOutbox(namespace, table, key, leaseToken, (body) => { body.processed_at = new Date().toISOString(); body.lease_token = null; body.lease_until = null; }, "document.complete_outbox", options);
  }

  async retryOutbox(namespace: string, table: string, key: string, leaseToken: string, availableAt: string, error: string, options?: OperationOptions): Promise<void> {
    assertPortableString(availableAt, "document.retry_outbox"); assertPortableString(error, "document.retry_outbox");
    const parsed = new Date(availableAt); if (Number.isNaN(parsed.getTime())) throw new StorageError("invalid_request", "Outbox retry time is invalid", { operation: "document.retry_outbox" });
    return this.updateOutbox(namespace, table, key, leaseToken, (body) => { body.available_at = parsed.toISOString(); body.last_error = [...error].slice(0, 2048).join(""); body.lease_token = null; body.lease_until = null; }, "document.retry_outbox", options);
  }

  private async updateOutbox(namespace: string, table: string, key: string, leaseToken: string, mutate: (body: Record<string, unknown>) => void, operation: string, options?: OperationOptions): Promise<void> {
    return this.operation(operation, options, () => this.backend.transaction(() => {
      assertNamespace(namespace, this.limits); assertName(table, "table name", this.limits); assertKey(key, this.limits); assertLeaseToken(leaseToken, this.limits);
      const definition = this.inspectTableSync(namespace, table).definition;
      const row = this.backend.db.prepare("SELECT * FROM storage_documents WHERE namespace=? AND table_name=? AND document_key=?").get(namespace, table, key) as Row | undefined;
      if (!row) throw new StorageError("not_found", "Outbox record was not found", { operation });
      const body = parsePortableDocument(String(row.body_json), this.limits);
      if (body.lease_token !== leaseToken) throw new StorageError("failed_condition", "Outbox lease token does not match", { operation });
      mutate(body);
      const bodyJson = canonicalJson(body);
      parsePortableDocument(bodyJson, this.limits);
      const version = Number(row.version) + 1;
      this.backend.db.prepare("UPDATE storage_documents SET body_json=?, version=?, updated_at=? WHERE namespace=? AND table_name=? AND document_key=?").run(bodyJson, version, new Date().toISOString(), namespace, table, key);
      this.backend.db.prepare("UPDATE storage_document_versions SET version=? WHERE namespace=? AND table_name=? AND document_key=?").run(version, namespace, table, key);
      this.backend.db.prepare("DELETE FROM storage_index_entries WHERE namespace=? AND table_name=? AND document_key=?").run(namespace, table, key);
      this.writeIndexEntries(namespace, definition, key, body);
    }));
  }
}

const validateQueryValues = (index: IndexDefinition, values: readonly PortableScalar[], kind: string): void => {
  if (values.length > index.fields.length) throw new StorageError("invalid_request", `${kind} has too many index values`, { operation: "document.query" });
  values.forEach((value, position) => {
    const actual = value === null ? "null" : typeof value;
    if (actual !== index.fields[position]!.type) throw new StorageError("invalid_request", `${kind} value ${position} must be ${index.fields[position]!.type}`, { operation: "document.query" });
  });
};

const localPhysicalPrefix = (namespace: string): string => `p:${createHash("sha256").update(namespace).digest("hex").slice(0, 20)}:`;
const resolveSearchIndex = (db: DatabaseSync, namespace: string, name: string): Row => {
  const physical = db.prepare("SELECT * FROM storage_search_indices WHERE namespace=? AND physical_name=?").get(namespace, name) as Row | undefined;
  const logical = name.startsWith("p:") ? undefined : db.prepare("SELECT * FROM storage_search_indices WHERE namespace=? AND logical_name=? AND active=1").get(namespace, name) as Row | undefined;
  if (physical && logical && String(physical.physical_name) !== String(logical.physical_name)) throw new StorageError("conflict", `Search target ${name} is ambiguous after a legacy upgrade`, { operation: "search_index.inspect" });
  const row = physical ?? logical;
  if (!row) throw new StorageError("not_found", `Search index ${name} was not found`, { operation: "search_index.inspect" });
  return row;
};
const localPhysicalName = (namespace: string, schema: SearchSchema, generation: number): string => `${localPhysicalPrefix(namespace)}${schema.name}:g${generation}`;
const assertLocalSearchTarget = (namespace: string, name: string, limits: Readonly<StorageLimits>): void => {
  if (!name.startsWith("p:")) {
    if (/^[a-z][a-z0-9_]{0,127}_v[1-9][0-9]*_g[1-9][0-9]*$/.test(name) && utf8Bytes(name) <= limits.maxNameBytes + 48) return;
    assertName(name, "search index name", limits); return;
  }
  if (!name.startsWith(localPhysicalPrefix(namespace)) || !/^p:[0-9a-f]{20}:[a-z][a-z0-9_]{0,127}:g[1-9][0-9]*$/.test(name) || utf8Bytes(name) > limits.maxNameBytes + 64) throw new StorageError("invalid_request", "Invalid physical search index", { operation: "search_index.mutate" });
};

const asSearchInspection = (row: Row): SearchIndexInspection => ({
  namespace: String(row.namespace), logicalName: String(row.logical_name), physicalName: String(row.physical_name), schema: safeJsonParse<SearchSchema>(String(row.schema_json), "search_index.inspect"), generation: Number(row.generation), active: Number(row.active) === 1,
});

export class LocalSearchIndexService extends LocalService implements SearchIndexService {
  constructor(backend: LocalDatabase, limits: Readonly<StorageLimits>, observe?: ObservabilityHook) { super(backend, limits, "search_index", observe); }

  async create(namespace: string, schema: SearchSchema, options?: OperationOptions): Promise<SearchIndexInspection> {
    return this.operation("search_index.create", options, () => {
      assertNamespace(namespace, this.limits); validateSearchSchema(schema, this.limits);
      return this.backend.transaction(() => {
        const existing = this.backend.db.prepare("SELECT * FROM storage_search_indices WHERE namespace=? AND logical_name=? AND active=1").get(namespace, schema.name) as Row | undefined;
        if (existing) {
          const current = asSearchInspection(existing);
          if (canonicalJson(current.schema) !== canonicalJson(schema)) throw new StorageError("conflict", "Search schema changed; begin an explicit rebuild", { operation: "search_index.create" });
          this.backend.db.prepare("INSERT INTO storage_search_generation_counters(namespace,logical_name,generation) VALUES(?,?,?) ON CONFLICT(namespace,logical_name) DO UPDATE SET generation=MAX(generation,excluded.generation)").run(namespace, schema.name, current.generation);
          return current;
        }
        const counter = this.backend.db.prepare(`INSERT INTO storage_search_generation_counters(namespace,logical_name,generation) VALUES(?,?,1)
          ON CONFLICT(namespace,logical_name) DO UPDATE SET generation=generation+1 RETURNING generation`).get(namespace, schema.name) as Row;
        const generation = Number(counter.generation); const physical = localPhysicalName(namespace, schema, generation);
        this.backend.db.prepare("INSERT INTO storage_search_indices(namespace,logical_name,physical_name,schema_json,generation,active) VALUES(?,?,?,?,?,1)").run(namespace, schema.name, physical, canonicalJson(schema), generation);
        return asSearchInspection(resolveSearchIndex(this.backend.db, namespace, physical));
      });
    });
  }

  async inspect(namespace: string, logicalName: string, options?: OperationOptions): Promise<SearchIndexInspection> {
    return this.operation("search_index.inspect", options, () => { assertNamespace(namespace, this.limits); assertName(logicalName, "search index name", this.limits); return asSearchInspection(resolveSearchIndex(this.backend.db, namespace, logicalName)); });
  }

  async listGenerations(namespace: string, logicalName: string, limit: number, cursorText?: string, options?: OperationOptions): Promise<SearchGenerationPage> {
    return this.operation("search_index.list_generations", options, () => {
      assertNamespace(namespace, this.limits); assertName(logicalName, "search index name", this.limits);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.limits.maxResultCount) throw new StorageError("limit_exceeded", "Generation page limit exceeds the configured maximum", { operation: "search_index.list_generations" });
      const queryHash = definitionHash({ namespace, logicalName }); const cursor = decodeCursor<{ generation: number; physicalName: string; queryHash: string }>(cursorText, "search_index.list_generations");
      if (cursor && (!Number.isSafeInteger(cursor.generation) || typeof cursor.physicalName !== "string" || cursor.queryHash !== queryHash)) throw new StorageError("invalid_request", "Generation cursor does not match the request", { operation: "search_index.list_generations" });
      const rows = (cursor
        ? this.backend.db.prepare("SELECT * FROM storage_search_indices WHERE namespace=? AND logical_name=? AND (generation>? OR (generation=? AND physical_name>?)) ORDER BY generation,physical_name LIMIT ?").all(namespace, logicalName, cursor.generation, cursor.generation, cursor.physicalName, limit + 1)
        : this.backend.db.prepare("SELECT * FROM storage_search_indices WHERE namespace=? AND logical_name=? ORDER BY generation,physical_name LIMIT ?").all(namespace, logicalName, limit + 1)) as Row[];
      const page = rows.slice(0, limit).map(asSearchInspection); const last = page.at(-1);
      return { generations: page, ...(rows.length > limit && last ? { cursor: encodeCursor({ generation: last.generation, physicalName: last.physicalName, queryHash }) } : {}) };
    });
  }

  async beginRebuild(namespace: string, schema: SearchSchema, options?: OperationOptions): Promise<SearchIndexInspection> {
    return this.operation("search_index.begin_rebuild", options, () => {
      assertNamespace(namespace, this.limits); validateSearchSchema(schema, this.limits);
      return this.backend.transaction(() => {
        const row = this.backend.db.prepare(`INSERT INTO storage_search_generation_counters(namespace,logical_name,generation) VALUES(?,?,1)
          ON CONFLICT(namespace,logical_name) DO UPDATE SET generation=generation+1 RETURNING generation`).get(namespace, schema.name) as Row;
        const generation = Number(row.generation);
        const physical = localPhysicalName(namespace, schema, generation);
        this.backend.db.prepare("INSERT INTO storage_search_indices(namespace,logical_name,physical_name,schema_json,generation,active) VALUES(?,?,?,?,?,0)").run(namespace, schema.name, physical, canonicalJson(schema), generation);
        return asSearchInspection(resolveSearchIndex(this.backend.db, namespace, physical));
      });
    });
  }

  async cutover(namespace: string, logicalName: string, physicalName: string, options?: OperationOptions): Promise<SearchIndexInspection> {
    return this.operation("search_index.cutover", options, () => {
      assertNamespace(namespace, this.limits); assertName(logicalName, "search index name", this.limits); assertLocalSearchTarget(namespace, physicalName, this.limits);
      return this.backend.transaction(() => {
        const target = this.backend.db.prepare("SELECT * FROM storage_search_indices WHERE namespace=? AND physical_name=?").get(namespace, physicalName) as Row | undefined;
        if (!target) throw new StorageError("not_found", "Physical search generation was not found", { operation: "search_index.cutover" });
        if (String(target.logical_name) !== logicalName) throw new StorageError("invalid_request", "Physical index does not belong to the logical alias", { operation: "search_index.cutover" });
        this.backend.db.prepare("UPDATE storage_search_indices SET active=0 WHERE namespace=? AND logical_name=?").run(namespace, logicalName);
        this.backend.db.prepare("UPDATE storage_search_indices SET active=1 WHERE namespace=? AND physical_name=?").run(namespace, physicalName);
        return asSearchInspection(resolveSearchIndex(this.backend.db, namespace, physicalName));
      });
    });
  }

  async deleteGeneration(namespace: string, physicalName: string, options?: OperationOptions): Promise<void> {
    return this.operation("search_index.delete_generation", options, () => {
      assertNamespace(namespace, this.limits); assertLocalSearchTarget(namespace, physicalName, this.limits);
      return this.backend.transaction(() => {
        const target = this.backend.db.prepare("SELECT * FROM storage_search_indices WHERE namespace=? AND physical_name=?").get(namespace, physicalName) as Row | undefined;
        if (!target) throw new StorageError("not_found", "Physical search generation was not found", { operation: "search_index.delete_generation" });
        if (Number(target.active) === 1) throw new StorageError("failed_condition", "The active search generation cannot be deleted", { operation: "search_index.delete_generation" });
        this.backend.db.prepare("DELETE FROM storage_search_fts WHERE namespace=? AND physical_name=?").run(namespace, physicalName);
        this.backend.db.prepare("DELETE FROM storage_search_documents WHERE namespace=? AND physical_name=?").run(namespace, physicalName);
        this.backend.db.prepare("DELETE FROM storage_search_versions WHERE namespace=? AND physical_name=?").run(namespace, physicalName);
        this.backend.db.prepare("DELETE FROM storage_search_indices WHERE namespace=? AND physical_name=? AND active=0").run(namespace, physicalName);
      });
    });
  }

  async upsert(document: SearchDocument, options?: OperationOptions): Promise<SearchMutationResult> {
    return this.operation("search_index.upsert", options, () => {
      if (typeof document?.index !== "string") throw new StorageError("invalid_request", "Search document index must be a string", { operation: "search_index.upsert" });
      assertNamespace(document.namespace, this.limits); assertLocalSearchTarget(document.namespace, document.index, this.limits);
      return this.backend.transaction(() => {
        const index = resolveSearchIndex(this.backend.db, document.namespace, document.index);
        const schema = safeJsonParse<SearchSchema>(String(index.schema_json), "search_index.upsert");
        const version = validateSearchDocument(document, schema, this.limits);
        const current = this.backend.db.prepare("SELECT version FROM storage_search_versions WHERE namespace=? AND physical_name=? AND document_id=?").get(document.namespace, index.physical_name, document.documentId) as Row | undefined;
        if (current && Number(current.version) >= version) return { applied: false, currentVersion: String(current.version) };
        this.backend.db.prepare("DELETE FROM storage_search_fts WHERE namespace=? AND physical_name=? AND document_id=?").run(document.namespace, index.physical_name, document.documentId);
        this.backend.db.prepare(`INSERT INTO storage_search_documents(namespace,physical_name,document_id,version,fields_json,filters_json,tags_json,locale) VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(namespace,physical_name,document_id) DO UPDATE SET version=excluded.version,fields_json=excluded.fields_json,filters_json=excluded.filters_json,tags_json=excluded.tags_json,locale=excluded.locale`)
          .run(document.namespace, index.physical_name, document.documentId, version, canonicalJson(document.fields), canonicalJson(document.filters), canonicalJson(document.tags), document.locale);
        const content = document.fields.map((field) => field.text).join("\n");
        this.backend.db.prepare("INSERT INTO storage_search_fts(namespace,physical_name,document_id,content) VALUES(?,?,?,?)").run(document.namespace, index.physical_name, document.documentId, content);
        this.backend.db.prepare(`INSERT INTO storage_search_versions(namespace,physical_name,document_id,version,deleted) VALUES(?,?,?,?,0)
          ON CONFLICT(namespace,physical_name,document_id) DO UPDATE SET version=excluded.version,deleted=0`).run(document.namespace, index.physical_name, document.documentId, version);
        return { applied: true, currentVersion: String(version) };
      });
    });
  }

  async delete(namespace: string, indexName: string, documentId: string, versionText: string, options?: OperationOptions): Promise<SearchMutationResult> {
    return this.operation("search_index.delete", options, () => {
      assertNamespace(namespace, this.limits); assertLocalSearchTarget(namespace, indexName, this.limits); assertKey(documentId, this.limits); const version = positiveInteger(versionText, "search version");
      return this.backend.transaction(() => {
        const index = resolveSearchIndex(this.backend.db, namespace, indexName);
        const current = this.backend.db.prepare("SELECT version FROM storage_search_versions WHERE namespace=? AND physical_name=? AND document_id=?").get(namespace, index.physical_name, documentId) as Row | undefined;
        if (current && Number(current.version) >= version) return { applied: false, currentVersion: String(current.version) };
        this.backend.db.prepare("DELETE FROM storage_search_documents WHERE namespace=? AND physical_name=? AND document_id=?").run(namespace, index.physical_name, documentId);
        this.backend.db.prepare("DELETE FROM storage_search_fts WHERE namespace=? AND physical_name=? AND document_id=?").run(namespace, index.physical_name, documentId);
        this.backend.db.prepare(`INSERT INTO storage_search_versions(namespace,physical_name,document_id,version,deleted) VALUES(?,?,?,?,1)
          ON CONFLICT(namespace,physical_name,document_id) DO UPDATE SET version=excluded.version,deleted=1`).run(namespace, index.physical_name, documentId, version);
        return { applied: true, currentVersion: String(version) };
      });
    });
  }
}

export class LocalSearchService extends LocalService implements SearchService {
  constructor(backend: LocalDatabase, limits: Readonly<StorageLimits>, observe?: ObservabilityHook) { super(backend, limits, "search", observe); }

  async query(request: SearchQuery, options?: OperationOptions): Promise<SearchPage> {
    return this.operation("search.query", options, () => {
      assertNamespace(request.namespace, this.limits); assertName(request.index, "search index name", this.limits);
      const index = resolveSearchIndex(this.backend.db, request.namespace, request.index);
      const schema = safeJsonParse<SearchSchema>(String(index.schema_json), "search.query");
      validateSearchQuery(request, schema, this.limits);
      const selected = request.fields.length ? request.fields : schema.fields.map((name) => ({ name, boost: 1 }));
      const terms = tokenize(request.text);
      const { cursor: _cursor, ...queryShape } = request; const queryHash = definitionHash(queryShape);
      const cursor = decodeCursor<{ score: number; documentId: string; physicalName: string; queryHash: string }>(request.cursor, "search.query");
      if (cursor && (!Number.isFinite(cursor.score) || typeof cursor.documentId !== "string" || cursor.physicalName !== String(index.physical_name) || cursor.queryHash !== queryHash)) throw new StorageError("invalid_request", "Search cursor does not match query", { operation: "search.query" });
      const rows = terms.length
        ? this.backend.db.prepare(`SELECT d.* FROM storage_search_fts f JOIN storage_search_documents d ON d.namespace=f.namespace AND d.physical_name=f.physical_name AND d.document_id=f.document_id WHERE f.namespace=? AND f.physical_name=? AND storage_search_fts MATCH ? ORDER BY d.document_id`).iterate(request.namespace, index.physical_name, terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" AND ")) as Iterable<Row>
        : this.backend.db.prepare("SELECT * FROM storage_search_documents WHERE namespace=? AND physical_name=? ORDER BY document_id").iterate(request.namespace, index.physical_name) as Iterable<Row>;
      type Scored = SearchHit & { filters: SearchDocument["filters"] };
      const scored: Scored[] = [];
      const facetCounts = new Map<string, Map<string, number>>(request.facets.map((name) => [name, new Map()]));
      for (const row of rows) {
        if (request.locale && String(row.locale) !== request.locale) continue;
        const fields = safeJsonParse<SearchDocument["fields"]>(String(row.fields_json), "search.query");
        const filters = safeJsonParse<SearchDocument["filters"]>(String(row.filters_json), "search.query");
        const tags = safeJsonParse<readonly string[]>(String(row.tags_json), "search.query");
        if (!request.tags.every((tag) => tags.includes(tag))) continue;
        if (!request.filters.every((wanted) => filters.some((actual) => actual.name === wanted.name && (wanted.operator === "eq" ? canonicalJson(actual.value) === canonicalJson(wanted.value) : canonicalJson(actual.value) !== canonicalJson(wanted.value))))) continue;
        const selectedTokens = new Set(selected.flatMap((selection) => tokenize(fields.find((candidate) => candidate.name === selection.name)?.text ?? "")));
        if (terms.length && !terms.every((term) => selectedTokens.has(term))) continue;
        let score = 0;
        const highlights: SearchHighlight[] = [];
        for (const selection of selected) {
          const field = fields.find((candidate) => candidate.name === selection.name);
          if (!field) continue;
          const ranges = highlightRanges(field.text, terms);
          score += ranges.length * selection.boost;
          if (ranges.length) highlights.push({ field: field.name, text: field.text, ranges });
        }
        for (const filter of filters) { const counts = facetCounts.get(filter.name); if (counts) { const value = canonicalJson(filter.value); counts.set(value, (counts.get(value) ?? 0) + 1); } }
        const documentId = String(row.document_id);
        if (cursor && !(score < cursor.score || (score === cursor.score && compareUtf8(documentId, cursor.documentId) > 0))) continue;
        scored.push({ documentId, version: String(row.version), score, fields, highlights, filters });
        scored.sort((a, b) => b.score - a.score || compareUtf8(a.documentId, b.documentId));
        if (scored.length > request.limit + 1) scored.pop();
      }
      const hasNext = scored.length > request.limit;
      const selectedHits = scored.slice(0, request.limit);
      const last = selectedHits.at(-1);
      const facets: SearchFacet[] = request.facets.map((name) => {
        const counts = facetCounts.get(name)!;
        const buckets: FacetBucket[] = [...counts].map(([encoded, count]) => ({ value: String(JSON.parse(encoded) as PortableScalar), count })).sort((a, b) => b.count - a.count || compareUtf8(a.value, b.value)).slice(0, this.limits.maxResultCount);
        return { name, buckets };
      });
      const hits: SearchHit[] = selectedHits.map(({ filters: _filters, ...hit }) => hit);
      return { hits, facets, ...(hasNext && last ? { cursor: encodeCursor({ score: last.score, documentId: last.documentId, physicalName: index.physical_name, queryHash }) } : {}) };
    });
  }
}

const tokenize = (text: string): string[] => [...new Set(text.normalize("NFKC").toLocaleLowerCase("und").match(/[\p{L}\p{N}_]+/gu) ?? [])];
const highlightRanges = (text: string, terms: readonly string[]): { start: number; end: number }[] => {
  const wanted = new Set(terms);
  const ranges: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}_]+/gu)) {
    if (ranges.length >= 32) break;
    if (wanted.has(match[0].normalize("NFKC").toLocaleLowerCase("und"))) ranges.push({ start: match.index, end: match.index + match[0].length });
  }
  return ranges;
};

const localObjectPath = (objectsDirectory: string, namespace: string, key: string, sessionId: string): string => {
  const namespaceHash = createHash("sha256").update(namespace).digest("hex");
  const keyHash = createHash("sha256").update(key).digest("hex");
  const sessionHash = createHash("sha256").update(sessionId).digest("hex");
  return path.join(objectsDirectory, namespaceHash.slice(0, 2), namespaceHash, `${keyHash}-${sessionHash}`);
};

export class LocalObjectStore extends LocalService implements ObjectStore {
  readonly #objectsDirectory: string;
  readonly #uploadsDirectory: string;
  readonly #sessionLocks = new Map<string, Promise<void>>();
  constructor(backend: LocalDatabase, limits: Readonly<StorageLimits>, observe?: ObservabilityHook) {
    super(backend, limits, "object", observe);
    this.#objectsDirectory = path.join(backend.dataDirectory, "objects");
    this.#uploadsDirectory = path.join(backend.dataDirectory, "uploads");
  }

  private async withSessionLock<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.#sessionLocks.get(key) ?? Promise.resolve();
    let unlock!: () => void;
    const gate = new Promise<void>((resolve) => { unlock = resolve; });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.#sessionLocks.set(key, queued);
    await previous.catch(() => undefined);
    try { return await run(); }
    finally { unlock(); if (this.#sessionLocks.get(key) === queued) this.#sessionLocks.delete(key); }
  }

  private releaseSessionOperation(namespace: string, sessionId: string, state: string, token: string): void {
    this.backend.db.prepare("UPDATE storage_upload_sessions SET operation_state=NULL,operation_token=NULL,operation_started_at=NULL WHERE namespace=? AND session_id=? AND operation_state=? AND operation_token=?").run(namespace, sessionId, state, token);
  }

  private authoritativeObjectRow(namespace: string, key: string, sessionId?: string): Row | undefined {
    return this.backend.db.prepare(`
      SELECT o.*,s.session_id,s.temp_path
      FROM storage_object_keys k
      JOIN storage_upload_sessions s ON s.namespace=k.namespace AND s.session_id=k.session_id
      JOIN storage_objects o ON o.namespace=k.namespace AND o.object_key=k.object_key
      WHERE k.namespace=? AND k.object_key=? AND s.completed=1${sessionId ? " AND s.session_id=?" : ""}
    `).get(...(sessionId ? [namespace, key, sessionId] : [namespace, key])) as Row | undefined;
  }

  async initiateUpload(request: UploadRequest, options?: OperationOptions): Promise<UploadSession> {
    return this.operation("object.initiate_upload", options, async () => {
      const { bytes, requestHash } = validateUploadRequest(request, this.limits);
      if (request.partCount !== 1) throw new StorageError("invalid_request", "Local uploads use one host-resolved file handle", { operation: "object.initiate_upload" });
      const existing = this.backend.db.prepare("SELECT s.* FROM storage_upload_sessions s JOIN storage_object_keys k ON k.namespace=s.namespace AND k.session_id=s.session_id WHERE s.namespace=? AND s.idempotency_key=?").get(request.namespace, request.idempotencyKey) as Row | undefined;
      if (existing) {
        if (String(existing.request_hash) !== requestHash) throw new StorageError("conflict", "Upload idempotency key was reused with different input", { operation: "object.initiate_upload" });
        return sessionFromRow(existing);
      }
      await mkdir(this.#uploadsDirectory, { recursive: true, mode: 0o700 });
      const sessionId = randomUUID();
      const tempPath = path.join(this.#uploadsDirectory, `${sessionId}.upload`);
      await writeFile(tempPath, new Uint8Array(), { flag: "wx", mode: 0o600 });
      const expiresAt = new Date(Date.now() + Math.min(Math.max(request.expiresInSeconds, 60), 86_400) * 1000).toISOString();
      try {
        this.backend.transaction(() => {
          this.backend.db.prepare("INSERT INTO storage_object_keys(namespace,object_key,session_id) VALUES(?,?,?)").run(request.namespace, request.key, sessionId);
          this.backend.db.prepare("INSERT INTO storage_upload_sessions(session_id,namespace,object_key,content_type,byte_length,checksum_sha256,metadata_json,idempotency_key,temp_path,expires_at,request_hash,part_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
            .run(sessionId, request.namespace, request.key, request.contentType, bytes, request.checksumSha256.toLowerCase(), canonicalJson(request.applicationMetadata), request.idempotencyKey, tempPath, expiresAt, requestHash, request.partCount);
        });
      } catch (error) {
        await rm(tempPath, { force: true });
        if (String((error as { message?: string }).message).includes("UNIQUE constraint failed")) {
          const winner = this.backend.db.prepare("SELECT s.* FROM storage_upload_sessions s JOIN storage_object_keys k ON k.namespace=s.namespace AND k.session_id=s.session_id WHERE s.namespace=? AND s.idempotency_key=?").get(request.namespace, request.idempotencyKey) as Row | undefined;
          if (winner && String(winner.request_hash) === requestHash) return sessionFromRow(winner);
          throw new StorageError("conflict", "Object key is already reserved", { operation: "object.initiate_upload", cause: error });
        }
        throw error;
      }
      return { sessionId, namespace: request.namespace, key: request.key, expiresAt, uploadHandle: pathToFileURL(tempPath).href, parts: [] };
    });
  }

  async completeUpload(namespace: string, sessionId: string, _parts: readonly CompletedPart[] = [], options?: OperationOptions): Promise<ObjectMetadata> {
    return this.operation("object.complete_upload", options, async () => this.withSessionLock(`${namespace}:${sessionId}`, async () => {
      validateCompletedParts(_parts, this.limits);
      if (_parts.length !== 0) throw new StorageError("invalid_request", "Local upload completion does not accept multipart parts", { operation: "object.complete_upload" });
      assertNamespace(namespace, this.limits); assertSessionId(sessionId);
      const operationToken = randomUUID(); const waitStarted = Date.now(); let row!: Row;
      for (;;) {
        let wait = false;
        const claimed = this.backend.transaction(() => {
          const candidate = this.backend.db.prepare("SELECT s.* FROM storage_upload_sessions s JOIN storage_object_keys k ON k.namespace=s.namespace AND k.session_id=s.session_id WHERE s.namespace=? AND s.session_id=?").get(namespace, sessionId) as Row | undefined;
          if (!candidate) throw new StorageError("not_found", "Upload session was not found", { operation: "object.complete_upload" });
          if (Number(candidate.completed) === 1) return candidate;
          if (new Date(String(candidate.expires_at)) < new Date()) throw new StorageError("failed_condition", "Upload session expired", { operation: "object.complete_upload" });
          const active = candidate.operation_state && candidate.operation_started_at && Date.now() - new Date(String(candidate.operation_started_at)).getTime() < 15 * 60_000;
          if (active) { wait = true; return candidate; }
          this.backend.db.prepare("UPDATE storage_upload_sessions SET operation_state='completing',operation_token=?,operation_started_at=? WHERE namespace=? AND session_id=?").run(operationToken, new Date().toISOString(), namespace, sessionId);
          return candidate;
        });
        row = claimed;
        if (Number(row.completed) === 1 || !wait) break;
        if (options?.signal?.aborted) throw new StorageError("cancelled", "Operation was cancelled", { operation: "object.complete_upload" });
        if (Date.now() - waitStarted >= (options?.timeoutMs ?? 60_000)) throw new StorageError("unavailable", "Object completion is already in progress", { operation: "object.complete_upload", retryable: true });
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (Number(row.completed) === 1) {
        const replay = this.authoritativeObjectRow(namespace, String(row.object_key), sessionId);
        if (!replay) throw new StorageError("not_found", "Upload session was not found", { operation: "object.complete_upload" });
        return objectFromRow(replay);
      }
      let leaseFailure: unknown;
      const heartbeat = (): void => {
        if (leaseFailure) throw leaseFailure;
        const renewed = this.backend.db.prepare("UPDATE storage_upload_sessions SET operation_started_at=? WHERE namespace=? AND session_id=? AND operation_state='completing' AND operation_token=?").run(new Date().toISOString(), namespace, sessionId, operationToken);
        if (renewed.changes !== 1) throw new StorageError("unavailable", "Object completion lease was lost", { operation: "object.complete_upload", retryable: true });
      };
      const leaseTimer = setInterval(() => { try { heartbeat(); } catch (error) { leaseFailure = error; } }, 30_000); leaseTimer.unref();
      try {
      const existing = this.backend.db.prepare("SELECT * FROM storage_objects WHERE namespace=? AND object_key=?").get(row.namespace, row.object_key) as Row | undefined;
      const target = localObjectPath(this.#objectsDirectory, String(row.namespace), String(row.object_key), sessionId);
      const directory = path.dirname(target);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      try { await copyFile(String(row.temp_path), target, fsConstants.COPYFILE_EXCL); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          const upload = await fileStat(String(row.temp_path)).catch(() => undefined);
          if (upload?.isFile()) {
            heartbeat();
            await rm(target, { force: true });
            await copyFile(String(row.temp_path), target, fsConstants.COPYFILE_EXCL);
          }
        }
        else if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        else {
        const replay = this.backend.db.prepare("SELECT * FROM storage_objects WHERE namespace=? AND object_key=?").get(row.namespace, row.object_key) as Row | undefined;
        if (replay) { const finalized = this.backend.db.prepare("UPDATE storage_upload_sessions SET completed=1,operation_state=NULL,operation_token=NULL,operation_started_at=NULL WHERE session_id=? AND operation_token=?").run(sessionId, operationToken); if (finalized.changes !== 1) throw new StorageError("unavailable", "Object completion lease was lost", { operation: "object.complete_upload", retryable: true }); return objectFromRow(replay); }
        throw error;
        }
      }
      heartbeat();
      const info = await fileStat(target);
      if (info.size !== Number(row.byte_length)) { await rm(target, { force: true }); throw new StorageError("failed_condition", "Uploaded byte length does not match", { operation: "object.complete_upload", details: { expected: row.byte_length, actual: info.size } }); }
      let checksum: string;
      checksum = await sha256File(target, heartbeat);
      heartbeat();
      if (checksum !== String(row.checksum_sha256)) { await rm(target, { force: true }); throw new StorageError("failed_condition", "Uploaded checksum does not match", { operation: "object.complete_upload" }); }
      if (existing) {
        if (String(existing.checksum_sha256) !== checksum) throw new StorageError("conflict", "Object keys are immutable", { operation: "object.complete_upload" });
        const finalized = this.backend.db.prepare("UPDATE storage_upload_sessions SET completed=1,operation_state=NULL,operation_token=NULL,operation_started_at=NULL WHERE session_id=? AND operation_token=?").run(sessionId, operationToken);
        if (finalized.changes !== 1) throw new StorageError("unavailable", "Object completion lease was lost", { operation: "object.complete_upload", retryable: true });
        await rm(String(row.temp_path), { force: true }).catch(() => undefined);
        if (String(existing.file_path) !== target) await rm(target, { force: true }).catch(() => undefined);
        return objectFromRow(existing);
      }
      const createdAt = new Date().toISOString();
      const version = randomUUID();
      try {
        this.backend.transaction(() => {
          this.backend.db.prepare("INSERT INTO storage_objects(namespace,object_key,content_type,byte_length,checksum_sha256,metadata_json,version,file_path,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
            .run(row.namespace, row.object_key, row.content_type, row.byte_length, row.checksum_sha256, row.metadata_json, version, target, createdAt);
          const finalized = this.backend.db.prepare("UPDATE storage_upload_sessions SET completed=1,operation_state=NULL,operation_token=NULL,operation_started_at=NULL WHERE session_id=? AND operation_token=?").run(sessionId, operationToken);
          if (finalized.changes !== 1) throw new StorageError("unavailable", "Object completion lease was lost", { operation: "object.complete_upload", retryable: true });
        });
      } catch (error) {
        if (!String((error as { message?: string }).message).includes("UNIQUE constraint failed")) throw error;
        const replay = this.backend.db.prepare("SELECT * FROM storage_objects WHERE namespace=? AND object_key=?").get(row.namespace, row.object_key) as Row | undefined;
        if (!replay || String(replay.checksum_sha256) !== checksum) throw error;
        const finalized = this.backend.db.prepare("UPDATE storage_upload_sessions SET completed=1,operation_state=NULL,operation_token=NULL,operation_started_at=NULL WHERE session_id=? AND operation_token=?").run(sessionId, operationToken);
        if (finalized.changes !== 1) throw new StorageError("unavailable", "Object completion lease was lost", { operation: "object.complete_upload", retryable: true });
        await rm(String(row.temp_path), { force: true }).catch(() => undefined);
        if (String(replay.file_path) !== target) await rm(target, { force: true }).catch(() => undefined);
        return objectFromRow(replay);
      }
      await rm(String(row.temp_path), { force: true }).catch(() => undefined);
      return this.statSync(String(row.namespace), String(row.object_key));
      } catch (error) { this.releaseSessionOperation(namespace, sessionId, "completing", operationToken); throw error; }
      finally { clearInterval(leaseTimer); }
    }));
  }

  async stat(namespace: string, key: string, options?: OperationOptions): Promise<ObjectMetadata> {
    return this.operation("object.stat", options, () => { assertNamespace(namespace, this.limits); assertKey(key, this.limits); return this.statSync(namespace, key); });
  }

  private statSync(namespace: string, key: string): ObjectMetadata {
    const row = this.authoritativeObjectRow(namespace, key);
    if (!row) throw new StorageError("not_found", "Object was not found", { operation: "object.stat" });
    return objectFromRow(row);
  }

  async resolveDownload(namespace: string, key: string, expiresInSeconds: number, options?: OperationOptions): Promise<DownloadResolution> {
    return this.operation("object.resolve_download", options, () => {
      assertNamespace(namespace, this.limits); assertKey(key, this.limits);
      const row = this.authoritativeObjectRow(namespace, key);
      if (!row) throw new StorageError("not_found", "Object was not found", { operation: "object.resolve_download" });
      if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 1) throw new StorageError("invalid_request", "Download expiry must be a positive integer", { operation: "object.resolve_download" });
      const seconds = Math.min(expiresInSeconds, 86_400);
      return { metadata: objectFromRow(row), url: pathToFileURL(String(row.file_path)).href, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() };
    });
  }

  async delete(namespace: string, key: string, expectedVersion?: string, options?: OperationOptions): Promise<void> {
    return this.operation("object.delete", options, async () => {
      assertNamespace(namespace, this.limits); assertKey(key, this.limits);
      const operationToken = randomUUID(); const waitStarted = Date.now(); let row: Row | undefined;
      for (;;) {
        let wait = false;
        row = this.backend.transaction(() => {
          const candidate = this.backend.db.prepare("SELECT s.*,o.file_path,o.version AS object_version FROM storage_object_keys k JOIN storage_upload_sessions s ON s.namespace=k.namespace AND s.session_id=k.session_id JOIN storage_objects o ON o.namespace=k.namespace AND o.object_key=k.object_key WHERE k.namespace=? AND k.object_key=? AND s.completed=1").get(namespace, key) as Row | undefined;
          if (!candidate) return undefined;
          if (expectedVersion && String(candidate.object_version) !== expectedVersion) throw new StorageError("failed_condition", "Object version does not match", { operation: "object.delete" });
          const active = candidate.operation_state && candidate.operation_started_at && Date.now() - new Date(String(candidate.operation_started_at)).getTime() < 15 * 60_000;
          if (active) wait = true;
          else this.backend.db.prepare("UPDATE storage_upload_sessions SET operation_state='deleting',operation_token=?,operation_started_at=? WHERE namespace=? AND session_id=?").run(operationToken, new Date().toISOString(), namespace, candidate.session_id);
          return candidate;
        });
        if (!wait) break;
        if (options?.signal?.aborted) throw new StorageError("cancelled", "Operation was cancelled", { operation: "object.delete" });
        if (Date.now() - waitStarted >= (options?.timeoutMs ?? 60_000)) throw new StorageError("unavailable", "Object deletion is already in progress", { operation: "object.delete", retryable: true });
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!row) return;
      try {
        this.backend.transaction(() => {
          const deletion = this.backend.db.prepare("DELETE FROM storage_upload_sessions WHERE namespace=? AND session_id=? AND completed=1 AND operation_state='deleting' AND operation_token=?").run(namespace, row!.session_id, operationToken);
          if (deletion.changes !== 1) throw new StorageError("unavailable", "Object deletion lease was lost", { operation: "object.delete", retryable: true });
          this.backend.db.prepare("DELETE FROM storage_objects WHERE namespace=? AND object_key=?").run(namespace, key);
          this.backend.db.prepare("DELETE FROM storage_object_keys WHERE namespace=? AND session_id=?").run(namespace, row!.session_id);
        });
      } catch (error) { this.releaseSessionOperation(namespace, String(row.session_id), "deleting", operationToken); throw error; }
      await rm(String(row.file_path), { force: true }).catch(() => undefined);
    });
  }

  async cleanupAbandoned(namespace: string, before: string, limit: number, options?: OperationOptions): Promise<number> {
    return this.operation("object.cleanup_abandoned", options, async () => {
      assertNamespace(namespace, this.limits);
      const requested = new Date(before); if (Number.isNaN(requested.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > this.limits.maxResultCount) throw new StorageError("invalid_request", "Invalid cleanup request", { operation: "object.cleanup_abandoned" });
      const cutoff = new Date(Math.min(requested.getTime(), Date.now()));
      const rows = this.backend.transaction(() => {
        const claimed = this.backend.db.prepare("SELECT * FROM storage_upload_sessions WHERE namespace=? AND completed=0 AND expires_at < ? AND (operation_state IS NULL OR operation_started_at < ?) ORDER BY expires_at LIMIT ?").all(namespace, cutoff.toISOString(), new Date(Date.now() - 15 * 60_000).toISOString(), limit) as Row[];
        for (const row of claimed) { const token = randomUUID(); this.backend.db.prepare("UPDATE storage_upload_sessions SET operation_state='cleaning',operation_token=?,operation_started_at=? WHERE session_id=?").run(token, new Date().toISOString(), row.session_id); row.operation_token = token; }
        return claimed;
      });
      let removed = 0;
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]!;
        try {
          await rm(String(row.temp_path), { force: true });
          this.backend.transaction(() => { const deletion = this.backend.db.prepare("DELETE FROM storage_upload_sessions WHERE session_id=? AND completed=0 AND operation_state='cleaning' AND operation_token=?").run(row.session_id, row.operation_token); if (deletion.changes) { this.backend.db.prepare("DELETE FROM storage_object_keys WHERE session_id=?").run(row.session_id); removed += 1; } });
        } catch (error) { for (const claimed of rows.slice(index)) this.releaseSessionOperation(namespace, String(claimed.session_id), "cleaning", String(claimed.operation_token)); throw error; }
      }
      if (removed < limit) {
        const orphanCutoff = Math.min(cutoff.getTime(), Date.now() - 15 * 60_000);
        for (const entry of await readdir(this.#uploadsDirectory).catch(() => [])) {
          if (removed >= limit) break;
          if (!entry.endsWith(".upload")) continue;
          const filePath = path.join(this.#uploadsDirectory, entry); const info = await fileStat(filePath).catch(() => undefined);
          if (!info || info.mtimeMs >= orphanCutoff) continue;
          const tracked = this.backend.db.prepare("SELECT 1 AS found FROM storage_upload_sessions WHERE temp_path=? AND completed=0").get(filePath);
          if (!tracked) { await rm(filePath, { force: true }); removed += 1; }
        }
      }
      if (removed < limit) {
        const namespaceHash = createHash("sha256").update(namespace).digest("hex");
        const directory = path.join(this.#objectsDirectory, namespaceHash.slice(0, 2), namespaceHash);
        const orphanCutoff = Math.min(cutoff.getTime(), Date.now() - 15 * 60_000);
        const completing = this.backend.db.prepare("SELECT object_key,session_id FROM storage_upload_sessions WHERE namespace=? AND completed=0 AND operation_state='completing' AND operation_started_at>=?").all(namespace, new Date(Date.now() - 15 * 60_000).toISOString()) as Row[];
        const activeTargets = new Set(completing.map((row) => localObjectPath(this.#objectsDirectory, namespace, String(row.object_key), String(row.session_id))));
        for (const entry of await readdir(directory).catch(() => [])) {
          if (removed >= limit) break;
          const filePath = path.join(directory, entry); const info = await fileStat(filePath).catch(() => undefined);
          if (!info?.isFile() || info.mtimeMs >= orphanCutoff || activeTargets.has(filePath)) continue;
          const tracked = this.backend.db.prepare("SELECT 1 AS found FROM storage_objects WHERE namespace=? AND file_path=?").get(namespace, filePath);
          if (!tracked) { await rm(filePath, { force: true }); removed += 1; }
        }
      }
      return removed;
    });
  }
}

const sessionFromRow = (row: Row): UploadSession => ({ sessionId: String(row.session_id), namespace: String(row.namespace), key: String(row.object_key), expiresAt: String(row.expires_at), uploadHandle: pathToFileURL(String(row.temp_path)).href, parts: [] });
const objectFromRow = (row: Row): ObjectMetadata => ({ namespace: String(row.namespace), key: String(row.object_key), contentType: String(row.content_type), byteLength: String(row.byte_length), checksumSha256: String(row.checksum_sha256), applicationMetadata: safeJsonParse(String(row.metadata_json), "object.stat"), version: String(row.version), createdAt: String(row.created_at) });
const sha256File = async (filePath: string, heartbeat?: () => void): Promise<string> => new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  let heartbeatAt = Date.now() + 30_000;
  stream.on("error", reject); stream.on("data", (chunk) => { hash.update(chunk); if (heartbeat && Date.now() >= heartbeatAt) { try { heartbeat(); heartbeatAt = Date.now() + 30_000; } catch (error) { stream.destroy(error as Error); } } }); stream.on("end", () => resolve(hash.digest("hex")));
});

export const createLocalStorage = async (options: LocalStorageOptions): Promise<StorageComposition> => {
  const limits = mergeLimits(options.limits);
  const requestedDirectory = path.resolve(options.dataDirectory);
  if (requestedDirectory === path.parse(requestedDirectory).root) throw new StorageError("invalid_request", "The filesystem root cannot be used as a storage data directory", { operation: "local.create" });
  await mkdir(requestedDirectory, { recursive: true, mode: 0o700 });
  const dataDirectory = await realpath(requestedDirectory);
  if (dataDirectory === path.parse(dataDirectory).root) throw new StorageError("invalid_request", "The filesystem root cannot be used as a storage data directory", { operation: "local.create" });
  const backend = new LocalDatabase(dataDirectory, options.busyTimeoutMs ?? 5_000);
  const document = new LocalDocumentStore(backend, limits, options.observability);
  const search = new LocalSearchService(backend, limits, options.observability);
  const searchIndex = new LocalSearchIndexService(backend, limits, options.observability);
  const object = new LocalObjectStore(backend, limits, options.observability);
  const owner = { async close(): Promise<void> { backend.close(); } };
  for (const provider of [document, search, searchIndex, object]) attachStorageOwner(provider, owner);
  return Object.freeze({
    document, search, searchIndex, object,
    async health(operationOptions: OperationOptions | undefined) { return Promise.all([document.health(operationOptions), search.health(operationOptions), searchIndex.health(operationOptions), object.health(operationOptions)]); },
    async close() { await owner.close(); },
  });
};
