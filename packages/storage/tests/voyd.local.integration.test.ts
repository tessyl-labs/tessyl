import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { createSdk, type CompileResult } from "@voyd-lang/sdk";
import { ARTICLE_TABLE, SEARCH_SCHEMA } from "../conformance/index.js";
import { createDocumentStorageAdapter, createSearchStorageAdapter, createStorageAdapter } from "../host/adapter.js";
import { createLocalStorage } from "../local/index.js";
import { StorageError } from "../src/errors.js";
import type { DocumentStore, StorageComposition } from "../src/contracts.js";

const namespace = "voyd-tenant";
const initialPhysical = `p:${createHash("sha256").update(namespace).digest("hex").slice(0, 20)}:articles:g1`;
const rebuiltPhysical = `p:${createHash("sha256").update(namespace).digest("hex").slice(0, 20)}:articles:g2`;
const voydString = (value: string): string => JSON.stringify(value);
const jsonArgument = (value: unknown): string => voydString(JSON.stringify(value));

describe("Voyd → host → local backend integration", () => {
  let directory: string;
  let storage: StorageComposition;
  let compiled: CompileResult;
  let adapter: ReturnType<typeof createStorageAdapter>;
  let fixtureBase: string;

  const roots = () => ({ src: path.resolve(import.meta.dirname, "fixtures"), pkgDirs: [path.resolve(import.meta.dirname, "../..")] });

  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "tessyl-voyd-storage-"));
    storage = await createLocalStorage({ dataDirectory: directory, busyTimeoutMs: 20 });
    adapter = createStorageAdapter(storage);
    fixtureBase = await readFile(path.resolve(import.meta.dirname, "fixtures/storage.voyd"), "utf8");
    const schema = { ...SEARCH_SCHEMA, fields: [...SEARCH_SCHEMA.fields], filterFields: [...SEARCH_SCHEMA.filterFields], facetFields: [...SEARCH_SCHEMA.facetFields], locales: [...SEARCH_SCHEMA.locales] };
    const articleTransaction = { namespace: "attacker", idempotencyKey: "voyd-create", operations: [{ kind: "put", table: "articles", key: "a1", bodyJson: JSON.stringify({ public_id: "pub-v", private_id: "private-v", status: "draft", updated_at: "2026-07-18T00:00:00.000Z" }), condition: { kind: "absent" } }] };
    const outbox = { name: "outbox", schemaVersion: 1, indexes: [{ name: "available", fields: [{ path: "available_at", type: "string" }], unique: false, ordered: true, sparse: false }] };
    const searchDocument = { namespace: "attacker", index: "articles", documentId: "a1", version: "1", fields: [{ name: "title", text: "Voyd turtle" }], filters: [{ name: "status", value: "draft" }], tags: ["voyd"], locale: "en" };
    const targetSearchDocument = { ...searchDocument, index: rebuiltPhysical, version: "2" };
    const objectBytes = new TextEncoder().encode("Voyd object 🐢");
    const objectRequest = { namespace: "attacker", key: "voyd/object.txt", contentType: "text/plain", byteLength: String(objectBytes.length), checksumSha256: createHash("sha256").update(objectBytes).digest("hex"), applicationMetadata: [{ name: "source", value: "voyd" }], idempotencyKey: "voyd-object", partCount: 1, expiresInSeconds: 300 };
    const source = `${fixtureBase}

pub fn doc_migrate(): Document -> bool
  Document::migrate_table(${voydString(namespace)}, ${jsonArgument(ARTICLE_TABLE)}).ok
pub fn doc_inspect(): Document -> bool
  Document::inspect_table(${voydString(namespace)}, "articles").ok
pub fn doc_missing(): Document -> bool
  Document::get(${voydString(namespace)}, "articles", "missing").error.code == "not_found"
pub fn doc_get(): Document -> bool
  Document::get(${voydString(namespace)}, "articles", "a1").ok
pub fn doc_attacker_get(): Document -> bool
  Document::get("attacker", "articles", "a1").error.code == "not_found"
pub fn doc_transact(): Document -> bool
  Document::transact(${voydString(namespace)}, ${jsonArgument(articleTransaction)}).ok
pub fn doc_query(): Document -> bool
  Document::query_documents(${voydString(namespace)}, ${jsonArgument({ namespace: "attacker", table: "articles", index: "public_id", prefix: ["pub-v"], order: "asc", limit: 10 })}).ok
pub fn doc_query_invalid(): Document -> bool
  Document::query_documents(${voydString(namespace)}, ${jsonArgument({ table: "articles", index: "public_id", prefix: null, order: "sideways", limit: 10 })}).error.code == "invalid_request"
pub fn outbox_migrate(): Document -> bool
  Document::migrate_table(${voydString(namespace)}, ${jsonArgument(outbox)}).ok
pub fn outbox_write(): Document -> bool
  Document::transact(${voydString(namespace)}, ${jsonArgument({ idempotencyKey: "event", operations: [{ kind: "put", table: "outbox", key: "e1", bodyJson: JSON.stringify({ available_at: "2026-01-01T00:00:00.000Z" }), condition: { kind: "absent" } }] })}).ok
pub fn doc_claim(): Document -> bool
  Document::claim_outbox(${voydString(namespace)}, ${jsonArgument({ table: "outbox", workerId: "voyd-worker", now: "2026-07-18T00:00:00.000Z", leaseSeconds: 30, limit: 1 })}).ok
pub fn doc_claim_retry(): Document -> bool
  Document::claim_outbox(${voydString(namespace)}, ${jsonArgument({ table: "outbox", workerId: "voyd-worker", now: "2026-07-18T00:00:32.000Z", leaseSeconds: 30, limit: 1 })}).ok
pub fn doc_retry_error(): Document -> bool
  Document::retry_outbox(${voydString(namespace)}, "outbox", "e1", "invalid", "2026-07-18T00:00:31.000Z", "retry").error.code == "failed_condition"
pub fn doc_complete_error(): Document -> bool
  Document::complete_outbox(${voydString(namespace)}, "outbox", "e1", "invalid").error.code == "failed_condition"
pub fn doc_direct(): Document -> bool
  Document::get(${voydString(namespace)}, "articles", "direct").ok

pub fn index_create(): SearchIndex -> bool
  SearchIndex::create(${voydString(namespace)}, ${jsonArgument(schema)}).ok
pub fn index_inspect(): SearchIndex -> bool
  SearchIndex::inspect(${voydString(namespace)}, "articles").ok
pub fn index_upsert(): SearchIndex -> bool
  SearchIndex::upsert(${voydString(namespace)}, ${jsonArgument(searchDocument)}).ok
pub fn index_upsert_zero(): SearchIndex -> bool
  SearchIndex::upsert(${voydString(namespace)}, ${jsonArgument({ ...searchDocument, version: "0" })}).error.code == "invalid_request"
pub fn search_query(): Search -> bool
  Search::search(${voydString(namespace)}, ${jsonArgument({ namespace: "attacker", index: "articles", text: "turtle", fields: [], filters: [], tags: [], facets: ["status"], locale: "en", limit: 10 })}).ok
pub fn search_query_invalid(): Search -> bool
  Search::search(${voydString(namespace)}, ${jsonArgument({ index: "articles", text: "turtle", fields: null, filters: [], tags: [], facets: [], locale: "en", limit: 10 })}).error.code == "invalid_request"
pub fn index_rebuild(): SearchIndex -> bool
  SearchIndex::begin_rebuild(${voydString(namespace)}, ${jsonArgument({ ...schema, version: 2 })}).ok
pub fn index_list_generations(): SearchIndex -> bool
  SearchIndex::list_generations(${voydString(namespace)}, "articles", 10, "").ok
pub fn index_upsert_target(): SearchIndex -> bool
  SearchIndex::upsert(${voydString(namespace)}, ${jsonArgument(targetSearchDocument)}).ok
pub fn index_cutover(): SearchIndex -> bool
  SearchIndex::cutover(${voydString(namespace)}, "articles", ${voydString(rebuiltPhysical)}).ok
pub fn index_delete_generation(): SearchIndex -> bool
  SearchIndex::delete_generation(${voydString(namespace)}, ${voydString(initialPhysical)}).ok
pub fn index_delete(): SearchIndex -> bool
  SearchIndex::delete_document(${voydString(namespace)}, "articles", "a1", "3").ok

pub fn object_initiate(): Object -> bool
  Object::initiate_upload(${voydString(namespace)}, ${jsonArgument(objectRequest)}).ok
pub fn object_initiate_invalid(): Object -> bool
  Object::initiate_upload(${voydString(namespace)}, ${jsonArgument({ ...objectRequest, applicationMetadata: null, idempotencyKey: "voyd-invalid" })}).error.code == "invalid_request"
pub fn object_initiate_limit(): Object -> bool
  Object::initiate_upload(${voydString(namespace)}, ${jsonArgument({ ...objectRequest, key: "metadata-limit", idempotencyKey: "metadata-limit", applicationMetadata: Array.from({ length: 33 }, (_, index) => ({ name: `m${index}`, value: "x" })) })}).error.code == "limit_exceeded"
pub fn object_complete_error(): Object -> bool
  Object::complete_upload("tenant-a", "00000000-0000-4000-8000-000000000000", "[]").error.code == "not_found"
pub fn object_stat(): Object -> bool
  Object::stat(${voydString(namespace)}, "voyd/object.txt").ok
pub fn object_attacker_stat(): Object -> bool
  Object::stat("attacker", "voyd/object.txt").error.code == "not_found"
pub fn object_resolve(): Object -> bool
  Object::resolve_download(${voydString(namespace)}, "voyd/object.txt", 60).ok
pub fn object_delete(): Object -> bool
  Object::delete_object(${voydString(namespace)}, "voyd/object.txt", "").ok
pub fn object_cleanup(): Object -> bool
  Object::cleanup_abandoned("tenant-a", "2099-01-01T00:00:00.000Z", 10).ok
`;
    compiled = await createSdk().compile({ source, roots: roots() });
    assert.equal(compiled.success, true, compiled.success ? undefined : JSON.stringify(compiled.diagnostics));
  });

  after(async () => {
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  });

  const call = async (entryName: string): Promise<boolean> => {
    assert.equal(compiled.success, true);
    if (!compiled.success) throw new Error("Voyd compilation failed");
    return compiled.run<boolean>({ entryName, adapters: [adapter], bufferSize: 4 * 1024 * 1024 });
  };

  const callDynamic = async (effect: string, expression: string): Promise<boolean> => {
    const result = await createSdk().compile({ source: `${fixtureBase}\npub fn main(): ${effect} -> bool\n  ${expression}\n`, roots: roots() });
    assert.equal(result.success, true, result.success ? undefined : JSON.stringify(result.diagnostics));
    if (!result.success) return false;
    return result.run<boolean>({ entryName: "main", adapters: [adapter], bufferSize: 4 * 1024 * 1024 });
  };

  it("invokes every public capability through the asynchronous production adapter", async () => {
    for (const name of ["doc_migrate", "doc_inspect", "doc_missing", "doc_transact", "doc_get", "doc_attacker_get", "doc_query", "doc_query_invalid", "outbox_migrate", "outbox_write", "doc_claim", "doc_retry_error", "doc_complete_error"]) assert.equal(await call(name), true, name);

    const database = new DatabaseSync(path.join(directory, "storage.sqlite"));
    const leased = database.prepare("SELECT body_json FROM storage_documents WHERE namespace=? AND table_name='outbox' AND document_key='e1'").get(namespace) as { body_json: string };
    const firstLease = JSON.parse(leased.body_json).lease_token as string;
    database.close();
    assert.equal(await callDynamic("Document", `Document::retry_outbox(${voydString(namespace)}, "outbox", "e1", ${voydString(firstLease)}, "2026-07-18T00:00:31.000Z", "retry").ok`), true);
    assert.equal(await call("doc_claim_retry"), true);
    const databaseAfterRetry = new DatabaseSync(path.join(directory, "storage.sqlite"));
    const retried = databaseAfterRetry.prepare("SELECT body_json FROM storage_documents WHERE namespace=? AND table_name='outbox' AND document_key='e1'").get(namespace) as { body_json: string };
    const secondLease = JSON.parse(retried.body_json).lease_token as string;
    databaseAfterRetry.close();
    assert.equal(await callDynamic("Document", `Document::complete_outbox(${voydString(namespace)}, "outbox", "e1", ${voydString(secondLease)}).ok`), true);

    for (const name of ["index_create", "index_inspect", "index_upsert_zero", "index_upsert", "search_query", "search_query_invalid", "index_rebuild", "index_list_generations", "index_upsert_target", "index_cutover", "index_delete_generation", "index_delete"]) assert.equal(await call(name), true, name);

    assert.equal(await call("object_initiate_invalid"), true); assert.equal(await call("object_initiate_limit"), true);
    assert.equal(await call("object_initiate"), true);
    const objectDatabase = new DatabaseSync(path.join(directory, "storage.sqlite"));
    const session = objectDatabase.prepare("SELECT session_id,temp_path FROM storage_upload_sessions WHERE namespace=? AND idempotency_key='voyd-object'").get(namespace) as { session_id: string; temp_path: string };
    objectDatabase.close();
    await writeFile(session.temp_path, new TextEncoder().encode("Voyd object 🐢"));
    assert.equal(await callDynamic("Object", `Object::complete_upload(${voydString(namespace)}, ${voydString(session.session_id)}, ${jsonArgument([{ partNumber: 1, etag: "invalid" }])}).error.code == "invalid_request"`), true);
    assert.equal(await callDynamic("Object", `Object::complete_upload(${voydString(namespace)}, ${voydString(session.session_id)}, "[]").ok`), true);
    for (const name of ["object_complete_error", "object_stat", "object_attacker_stat", "object_resolve", "object_delete", "object_cleanup"]) assert.equal(await call(name), true, name);
  });

  it("returns data seeded directly in SQLite through Voyd", async () => {
    await storage.document.migrateTable(namespace, ARTICLE_TABLE);
    const database = new DatabaseSync(path.join(directory, "storage.sqlite"));
    database.prepare("INSERT OR REPLACE INTO storage_documents(namespace,table_name,document_key,version,body_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(namespace, "articles", "direct", 42, JSON.stringify({ direct: true }), new Date().toISOString(), new Date().toISOString());
    database.close();
    assert.equal(await call("doc_direct"), true);
  });

  it("carries a near-limit document through the imported package effect", async () => {
    await storage.document.migrateTable(namespace, ARTICLE_TABLE);
    const bodyJson = JSON.stringify({ public_id: "near-limit", private_id: "near-limit", status: "draft", updated_at: "2026-07-18T00:00:00.000Z", payload: "x".repeat(900_000) });
    const template = JSON.stringify({ idempotencyKey: "near-limit", operations: [{ kind: "put", table: "articles", key: "near-limit", bodyJson: JSON.stringify({ public_id: "near-limit", private_id: "near-limit", status: "draft", updated_at: "2026-07-18T00:00:00.000Z", payload: "__PAYLOAD__" }), condition: { kind: "absent" } }] });
    const [prefix, suffix] = template.split("__PAYLOAD__") as [string, string];
    const result = await createSdk().compile({ source: `${fixtureBase}\npub fn main(): Document -> bool\n  let requestJson = ${voydString(prefix)}.concat("x".repeat(900000)).concat(${voydString(suffix)})\n  Document::transact(${voydString(namespace)}, requestJson).ok\n`, roots: roots() });
    assert.equal(result.success, true, result.success ? undefined : JSON.stringify(result.diagnostics));
    if (!result.success) return;
    assert.equal(await result.run<boolean>({ entryName: "main", adapters: [adapter], bufferSize: 4 * 1024 * 1024 }), true);
    assert.equal((await storage.document.get(namespace, "articles", "near-limit")).bodyJson.length, bodyJson.length);
    for (let index = 2; index <= 4; index += 1) {
      const indexedBody = JSON.stringify({ public_id: `near-limit-${index}`, private_id: `near-limit-${index}`, status: "draft", updated_at: `2026-07-18T00:00:0${index}.000Z`, payload: "x".repeat(900_000) });
      await storage.document.transact({ namespace, idempotencyKey: `near-limit-${index}`, operations: [{ kind: "put", table: "articles", key: `near-limit-${index}`, bodyJson: indexedBody, condition: { kind: "absent" } }] });
    }
    const pageRequest = { table: "articles", index: "status_updated", prefix: ["draft"], order: "asc", limit: 10 };
    assert.equal(await callDynamic("Document", `Document::query_documents(${voydString(namespace)}, ${jsonArgument(pageRequest)}).error.code == "limit_exceeded"`), true);
  });

  it("fails linking for missing, wrong, and duplicate providers", async () => {
    assert.equal(compiled.success, true); if (!compiled.success) return;
    await assert.rejects(compiled.run({ entryName: "doc_get", adapters: [] }), /provide|external|interface/i);
    await assert.rejects(compiled.run({ entryName: "doc_get", adapters: [createSearchStorageAdapter(storage.search)] }), /provide|external|interface/i);
    await assert.rejects(compiled.run({ entryName: "doc_get", adapters: [adapter, adapter] }), /multiple.*provide/i);
  });

  it("maps real SQLite contention through Voyd and the production adapter", async () => {
    await storage.document.migrateTable(namespace, ARTICLE_TABLE);
    const blocker = new DatabaseSync(path.join(directory, "storage.sqlite")); blocker.exec("BEGIN IMMEDIATE");
    try {
      const request = { idempotencyKey: "voyd-locked", operations: [{ kind: "put", table: "articles", key: "voyd-locked", bodyJson: JSON.stringify({ public_id: "voyd-locked", private_id: "voyd-locked", status: "draft", updated_at: "2026-07-18T00:00:00.000Z" }), condition: { kind: "absent" } }] };
      assert.equal(await callDynamic("Document", `Document::transact(${voydString(namespace)}, ${jsonArgument(request)}).error.code == "unavailable"`), true);
    } finally { blocker.exec("ROLLBACK"); blocker.close(); }
  });

  it("translates cancellation, timeout, and unavailable errors at the Voyd adapter boundary", async () => {
    const compileErrorCheck = async (code: string) => {
      const result = await createSdk().compile({ source: `${fixtureBase}\npub fn main(): Document -> bool\n  Document::get(${voydString(namespace)}, "articles", "a1").error.code == ${voydString(code)}\n`, roots: roots() });
      assert.equal(result.success, true, result.success ? undefined : JSON.stringify(result.diagnostics));
      return result;
    };
    for (const code of ["timeout", "unavailable"] as const) {
      const result = await compileErrorCheck(code); if (!result.success) continue;
      const failing = { async get() { throw new StorageError(code, code, { operation: "document.get", retryable: true }); } } as unknown as DocumentStore;
      assert.equal(await result.run<boolean>({ entryName: "main", adapters: [createDocumentStorageAdapter(failing)], bufferSize: 4 * 1024 * 1024 }), true);
    }
    const controller = new AbortController(); controller.abort();
    const implementation = adapter.implementation["tessyl:storage/document@1"] as unknown as { get(this: { signal: AbortSignal }, namespace: string, table: string, key: string): Promise<{ ok: boolean; error: { code: string } }> };
    const response = await implementation.get.call({ signal: controller.signal }, namespace, "articles", "a1");
    assert.equal(response.ok, false); assert.equal(response.error.code, "cancelled");
  });
});
