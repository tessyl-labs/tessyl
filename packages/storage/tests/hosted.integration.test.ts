import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { CreateBucketCommand, PutObjectCommand, S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import { createSdk } from "@voyd-lang/sdk";
import pg from "pg";
import { ARTICLE_TABLE, runStorageConformance, SEARCH_SCHEMA } from "../conformance/index.js";
import { createStorageAdapter } from "../host/adapter.js";
import { createHostedStorage } from "../hosted/index.js";
import type { StorageComposition } from "../src/contracts.js";
import { StorageError } from "../src/errors.js";

const enabled = process.env.TESSYL_STORAGE_HOSTED_TEST === "1";
const q = (value: string): string => JSON.stringify(value);
const jq = (value: unknown): string => q(JSON.stringify(value));

describe("hosted storage against PostgreSQL, OpenSearch, and S3", { skip: !enabled }, () => {
  const postgresUrl = process.env.TESSYL_STORAGE_POSTGRES_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/tessyl_storage";
  const openSearchUrl = process.env.TESSYL_STORAGE_OPENSEARCH_URL ?? "http://127.0.0.1:9200";
  const s3Endpoint = process.env.TESSYL_STORAGE_S3_ENDPOINT ?? "http://127.0.0.1:9000";
  const bucket = process.env.TESSYL_STORAGE_S3_BUCKET ?? "tessyl-storage-test";
  const credentials = { accessKeyId: process.env.TESSYL_STORAGE_S3_ACCESS_KEY ?? "minioadmin", secretAccessKey: process.env.TESSYL_STORAGE_S3_SECRET_KEY ?? "minioadmin" };
  const pool = new pg.Pool({ connectionString: postgresUrl, max: 10 });
  const openSearch = new OpenSearchClient({ node: openSearchUrl });
  const s3 = new S3Client({ endpoint: s3Endpoint, region: "us-east-1", credentials, forcePathStyle: true });
  let storage: StorageComposition;
  let fixtureBase: string;

  before(async () => {
    await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch((error: unknown) => {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 409) throw error;
    });
    storage = await createHostedStorage({ postgres: pool, openSearch, s3, bucket, keyPrefix: `ci-${crypto.randomUUID()}`, maxConcurrency: 16 });
    fixtureBase = await readFile(path.resolve(import.meta.dirname, "fixtures/storage.voyd"), "utf8");
  });

  after(async () => {
    await storage.close();
    await pool.end();
    await openSearch.close();
    s3.destroy();
  });

  it("passes the backend-neutral contract against real disposable services", async () => {
    await runStorageConformance(storage, async (session, content) => {
      const completed = [];
      for (const part of session.parts) {
        const response = await fetch(part.url, { method: "PUT", body: content });
        assert.equal(response.ok, true, await response.text());
        completed.push({ partNumber: part.partNumber, etag: response.headers.get("etag") ?? "" });
      }
      return completed;
    });
  });

  it("requires an explicit rebuild for legacy hosted search formats", async () => {
    const namespace = `legacy-hosted-${crypto.randomUUID()}`; const namespaceHash = createHash("sha256").update(namespace).digest("hex").slice(0, 20);
    const logicalName = "articles"; const physical = `tessyl-${namespaceHash}-${logicalName}-v7-g7`; const alias = `tessyl-${namespaceHash}-${logicalName}`;
    const schema = { ...SEARCH_SCHEMA, fields: [...SEARCH_SCHEMA.fields], filterFields: [...SEARCH_SCHEMA.filterFields], facetFields: [...SEARCH_SCHEMA.facetFields], locales: [...SEARCH_SCHEMA.locales] };
    await openSearch.indices.create({ index: physical, body: { mappings: { dynamic: "strict", _meta: { tessyl_schema: schema, generation: 7, namespace_hash: namespaceHash }, properties: { namespace: { type: "keyword" }, locale: { type: "keyword" }, version: { type: "long" }, tags: { type: "keyword" } } } } });
    await openSearch.indices.putAlias({ index: physical, name: alias });
    assert.equal((await storage.searchIndex.listGenerations(namespace, logicalName, 10)).generations[0]?.physicalName, physical);
    await assert.rejects(storage.searchIndex.inspect(namespace, logicalName), (error: unknown) => error instanceof StorageError && error.code === "failed_condition");
    await assert.rejects(storage.search.query({ namespace, index: logicalName, text: "", fields: [], filters: [], tags: [], facets: [], locale: "en", limit: 10 }), (error: unknown) => error instanceof StorageError && error.code === "failed_condition");
    const rebuilt = await storage.searchIndex.beginRebuild(namespace, { ...schema, version: 2 }); assert.equal(rebuilt.generation, 8);
    await storage.searchIndex.cutover(namespace, logicalName, rebuilt.physicalName); await storage.searchIndex.deleteGeneration(namespace, physical);
  });

  it("uses the authoritative object reservation when stale completed sessions exist", async () => {
    const namespace = `legacy-object-${crypto.randomUUID()}`; const objectKey = "object.txt"; const staleSession = crypto.randomUUID(); const currentSession = crypto.randomUUID();
    const staleBackendKey = `tests/${staleSession}`; const currentBackendKey = `tests/${currentSession}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: staleBackendKey, Body: "stale" })); await s3.send(new PutObjectCommand({ Bucket: bucket, Key: currentBackendKey, Body: "current" }));
    const insert = `INSERT INTO tessyl_storage_upload_sessions(session_id,namespace,object_key,content_type,byte_length,checksum_sha256,metadata_json,idempotency_key,backend_upload_id,backend_key,expires_at,completed,version,request_hash,part_count,created_at)
      VALUES($1,$2,$3,'text/plain',$4,$5,'[]'::jsonb,$6,'legacy',$7,now(),true,$8,'legacy',1,$9)`;
    await pool.query(insert, [staleSession, namespace, objectKey, 5, createHash("sha256").update("stale").digest("hex"), "stale", staleBackendKey, "stale-version", new Date("2026-01-01T00:00:00.000Z")]);
    await pool.query(insert, [currentSession, namespace, objectKey, 7, createHash("sha256").update("current").digest("hex"), "current", currentBackendKey, "current-version", new Date("2026-01-02T00:00:00.000Z")]);
    await pool.query("INSERT INTO tessyl_storage_object_keys(namespace,object_key,session_id) VALUES($1,$2,$3)", [namespace, objectKey, currentSession]);
    assert.equal((await storage.object.stat(namespace, objectKey)).version, "current-version");
    await assert.rejects(storage.object.completeUpload(namespace, staleSession, []), (error: unknown) => error instanceof StorageError && error.code === "not_found");
    await assert.rejects(storage.object.initiateUpload({ namespace, key: objectKey, contentType: "text/plain", byteLength: "5", checksumSha256: createHash("sha256").update("stale").digest("hex"), applicationMetadata: [], idempotencyKey: "stale", partCount: 1, expiresInSeconds: 300 }), (error: unknown) => error instanceof StorageError && error.code === "conflict");
    await storage.object.delete(namespace, objectKey, "current-version");
    assert.equal((await pool.query("SELECT 1 FROM tessyl_storage_upload_sessions WHERE session_id=$1", [staleSession])).rowCount, 1);
    await assert.rejects(storage.object.stat(namespace, objectKey), (error: unknown) => error instanceof StorageError && error.code === "not_found");
  });

  it("maps cancellation while a mutation waits for hosted concurrency", async () => {
    const applicationName = `tessyl-concurrency-${crypto.randomUUID()}`;
    const limitedPool = new pg.Pool({ connectionString: postgresUrl, max: 3, application_name: applicationName });
    const limited = await createHostedStorage({ postgres: limitedPool, openSearch, s3, bucket, keyPrefix: `concurrency-${crypto.randomUUID()}`, maxConcurrency: 1 });
    const namespace = `concurrency-${crypto.randomUUID()}`;
    const blocker = await pool.connect();
    try {
      await limited.document.migrateTable(namespace, ARTICLE_TABLE);
      await blocker.query("BEGIN"); await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [namespace, ARTICLE_TABLE.name]);
      const first = limited.document.transact({ namespace, idempotencyKey: "first", operations: [{ kind: "put", table: ARTICLE_TABLE.name, key: "first", bodyJson: JSON.stringify({ public_id: "first", private_id: "first", status: "draft", updated_at: "2026-07-18T00:00:00.000Z" }), condition: { kind: "absent" } }] });
      for (;;) {
        const waiting = Number((await pool.query("SELECT COUNT(*) AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'", [applicationName])).rows[0]!.count);
        if (waiting > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const controller = new AbortController();
      const second = limited.document.transact({ namespace, idempotencyKey: "second", operations: [{ kind: "delete", table: ARTICLE_TABLE.name, key: "missing", condition: { kind: "none" } }] }, { signal: controller.signal });
      controller.abort(new Error("request closed"));
      await assert.rejects(second, (error: unknown) => error instanceof StorageError && error.code === "cancelled" && !error.retryable);
      await blocker.query("ROLLBACK"); await first;
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined); blocker.release(); await limited.close(); await limitedPool.end();
    }
  });

  it("timestamps hosted objects when publication completes", async () => {
    const namespace = `object-created-at-${crypto.randomUUID()}`; const content = new TextEncoder().encode("published now");
    const session = await storage.object.initiateUpload({ namespace, key: "object.txt", contentType: "text/plain", byteLength: String(content.length), checksumSha256: createHash("sha256").update(content).digest("hex"), applicationMetadata: [], idempotencyKey: "created-at", partCount: 1, expiresInSeconds: 300 });
    const response = await fetch(session.parts[0]!.url, { method: "PUT", body: content }); assert.equal(response.ok, true, await response.text());
    await pool.query("UPDATE tessyl_storage_upload_sessions SET created_at='2000-01-01T00:00:00.000Z' WHERE namespace=$1 AND session_id=$2", [namespace, session.sessionId]);
    const completionStartedAt = Date.now(); const metadata = await storage.object.completeUpload(namespace, session.sessionId, [{ partNumber: 1, etag: response.headers.get("etag") ?? "" }]);
    assert.ok(new Date(metadata.createdAt).getTime() >= completionStartedAt - 1_000);
  });

  it("invokes every operation through Voyd, Wasm, the adapter, and real hosted services", async () => {
    const namespace = `voyd-hosted-${crypto.randomUUID()}`;
    const adapter = createStorageAdapter(storage);
    const roots = { src: path.resolve(import.meta.dirname, "fixtures"), pkgDirs: [path.resolve(import.meta.dirname, "../..")] };
    const voyd = async (effect: string, expression: string, installedAdapter = adapter): Promise<boolean> => {
      const compiled = await createSdk().compile({ source: `${fixtureBase}\npub fn main(): ${effect} -> bool\n  ${expression}\n`, roots });
      assert.equal(compiled.success, true, compiled.success ? undefined : JSON.stringify(compiled.diagnostics));
      if (!compiled.success) return false;
      return compiled.run<boolean>({ entryName: "main", adapters: [installedAdapter], bufferSize: 4 * 1024 * 1024 });
    };

    assert.equal(await voyd("Document", `Document::migrate_table(${q(namespace)}, ${jq(ARTICLE_TABLE)}).ok`), true);
    assert.equal(await voyd("Document", `Document::inspect_table(${q(namespace)}, "articles").ok`), true);
    assert.equal(await voyd("Document", `Document::get(${q(namespace)}, "articles", "missing").error.code == "not_found"`), true);
    const article = { namespace: "attacker", idempotencyKey: "hosted-voyd-article", operations: [{ kind: "put", table: "articles", key: "a1", bodyJson: JSON.stringify({ public_id: "pub-h", private_id: "private-h", status: "draft", updated_at: "2026-07-18T00:00:00.000Z" }), condition: { kind: "absent" } }] };
    assert.equal(await voyd("Document", `Document::transact(${q(namespace)}, ${jq(article)}).ok`), true);
    assert.equal(await voyd("Document", `Document::get(${q(namespace)}, "articles", "a1").ok`), true);
    assert.equal(await voyd("Document", `Document::get("attacker", "articles", "a1").error.code == "not_found"`), true);
    assert.equal(await voyd("Document", `Document::query_documents(${q(namespace)}, ${jq({ namespace: "attacker", table: "articles", index: "public_id", prefix: ["pub-h"], order: "asc", limit: 10 })}).ok`), true);
    assert.equal(await voyd("Document", `Document::query_documents(${q(namespace)}, ${jq({ table: "articles", index: "public_id", prefix: null, order: "sideways", limit: 10 })}).error.code == "invalid_request"`), true);
    assert.equal(await voyd("Document", `Document::transact(${q(namespace)}, ${jq({ ...article, idempotencyKey: "hosted-present", operations: [{ ...article.operations[0], condition: { kind: "absent" } }] })}).error.code == "failed_condition"`), true);
    assert.equal(await voyd("Document", `Document::transact(${q(namespace)}, ${jq({ ...article, idempotencyKey: "hosted-conflict", operations: [{ ...article.operations[0], key: "a2" }] })}).error.code == "conflict"`), true);
    for (let index = 1; index <= 4; index += 1) {
      const bodyJson = JSON.stringify({ public_id: `large-${index}`, private_id: `large-${index}`, status: "large", updated_at: `2026-07-18T00:00:0${index}.000Z`, payload: "x".repeat(900_000) });
      await storage.document.transact({ namespace, idempotencyKey: `large-${index}`, operations: [{ kind: "put", table: "articles", key: `large-${index}`, bodyJson, condition: { kind: "absent" } }] });
    }
    assert.equal(await voyd("Document", `Document::query_documents(${q(namespace)}, ${jq({ table: "articles", index: "status_updated", prefix: ["large"], order: "asc", limit: 10 })}).error.code == "limit_exceeded"`), true);

    const outbox = { name: "outbox", schemaVersion: 1, indexes: [{ name: "available", fields: [{ path: "available_at", type: "string" }], unique: false, ordered: true, sparse: false }] };
    assert.equal(await voyd("Document", `Document::migrate_table(${q(namespace)}, ${jq(outbox)}).ok`), true);
    assert.equal(await voyd("Document", `Document::transact(${q(namespace)}, ${jq({ idempotencyKey: "event", operations: [{ kind: "put", table: "outbox", key: "e1", bodyJson: JSON.stringify({ available_at: "2026-01-01T00:00:00.000Z" }), condition: { kind: "absent" } }] })}).ok`), true);
    assert.equal(await voyd("Document", `Document::claim_outbox(${q(namespace)}, ${jq({ table: "outbox", workerId: "hosted-worker", now: "2026-07-18T00:00:00.000Z", leaseSeconds: 30, limit: 1 })}).ok`), true);
    const firstLease = JSON.parse((await storage.document.get(namespace, "outbox", "e1")).bodyJson).lease_token as string;
    assert.equal(await voyd("Document", `Document::retry_outbox(${q(namespace)}, "outbox", "e1", ${q(firstLease)}, "2026-07-18T00:00:31.000Z", "retry").ok`), true);
    assert.equal(await voyd("Document", `Document::claim_outbox(${q(namespace)}, ${jq({ table: "outbox", workerId: "hosted-worker", now: "2026-07-18T00:00:32.000Z", leaseSeconds: 30, limit: 1 })}).ok`), true);
    const secondLease = JSON.parse((await storage.document.get(namespace, "outbox", "e1")).bodyJson).lease_token as string;
    assert.equal(await voyd("Document", `Document::complete_outbox(${q(namespace)}, "outbox", "e1", ${q(secondLease)}).ok`), true);

    const schema = { ...SEARCH_SCHEMA, fields: [...SEARCH_SCHEMA.fields], filterFields: [...SEARCH_SCHEMA.filterFields], facetFields: [...SEARCH_SCHEMA.facetFields], locales: [...SEARCH_SCHEMA.locales] };
    assert.equal(await voyd("SearchIndex", `SearchIndex::create(${q(namespace)}, ${jq(schema)}).ok`), true);
    assert.equal(await voyd("SearchIndex", `SearchIndex::inspect(${q(namespace)}, "articles").ok`), true);
    const searchDocument = { namespace: "attacker", index: "articles", documentId: "a1", version: "1", fields: [{ name: "title", text: "Hosted turtle" }], filters: [{ name: "status", value: "draft" }], tags: ["voyd"], locale: "en" };
    assert.equal(await voyd("SearchIndex", `SearchIndex::upsert(${q(namespace)}, ${jq({ ...searchDocument, version: "0" })}).error.code == "invalid_request"`), true);
    assert.equal(await voyd("SearchIndex", `SearchIndex::upsert(${q(namespace)}, ${jq(searchDocument)}).ok`), true);
    assert.equal(await voyd("Search", `Search::search(${q(namespace)}, ${jq({ namespace: "attacker", index: "articles", text: "turtle", fields: [], filters: [], tags: [], facets: ["status"], locale: "en", limit: 10 })}).ok`), true);
    assert.equal(await voyd("Search", `Search::search(${q(namespace)}, ${jq({ index: "articles", text: "turtle", fields: null, filters: [], tags: [], facets: [], locale: "en", limit: 10 })}).error.code == "invalid_request"`), true);
    assert.equal(await voyd("SearchIndex", `SearchIndex::begin_rebuild(${q(namespace)}, ${jq({ ...schema, version: 2 })}).ok`), true);
    const physical = `tessyl-${createHash("sha256").update(namespace).digest("hex").slice(0, 20)}-articles-g2`;
    assert.equal(await voyd("SearchIndex", `SearchIndex::upsert(${q(namespace)}, ${jq({ ...searchDocument, index: physical, version: "2" })}).ok`), true);
    assert.equal(await voyd("SearchIndex", `SearchIndex::cutover(${q(namespace)}, "articles", ${q(physical)}).ok`), true);
    assert.equal(await voyd("SearchIndex", `SearchIndex::delete_document(${q(namespace)}, "articles", "a1", "3").ok`), true);

    const content = new TextEncoder().encode("Hosted Voyd object 🐢"); const checksum = createHash("sha256").update(content).digest("hex");
    const objectRequest = { namespace: "attacker", key: "voyd/object.txt", contentType: "text/plain", byteLength: String(content.length), checksumSha256: checksum, applicationMetadata: [{ name: "source", value: "voyd" }], idempotencyKey: "hosted-voyd-object", partCount: 1, expiresInSeconds: 300 };
    assert.equal(await voyd("Object", `Object::initiate_upload(${q(namespace)}, ${jq({ ...objectRequest, key: "impossible", idempotencyKey: "impossible", partCount: 2 })}).error.code == "invalid_request"`), true);
    assert.equal(await voyd("Object", `Object::initiate_upload(${q(namespace)}, ${jq({ ...objectRequest, key: "metadata-limit", idempotencyKey: "metadata-limit", applicationMetadata: Array.from({ length: 33 }, (_, index) => ({ name: `m${index}`, value: "x" })) })}).error.code == "limit_exceeded"`), true);
    assert.equal(await voyd("Object", `Object::initiate_upload(${q(namespace)}, ${jq(objectRequest)}).ok`), true);
    const session = (await pool.query<{ session_id: string; backend_key: string; backend_upload_id: string }>("SELECT session_id,backend_key,backend_upload_id FROM tessyl_storage_upload_sessions WHERE namespace=$1 AND idempotency_key=$2", [namespace, "hosted-voyd-object"])).rows[0]!;
    const uploadUrl = await getSignedUrl(s3, new UploadPartCommand({ Bucket: bucket, Key: session.backend_key, UploadId: session.backend_upload_id, PartNumber: 1 }), { expiresIn: 300 });
    const upload = await fetch(uploadUrl, { method: "PUT", body: content }); assert.equal(upload.ok, true); const etag = upload.headers.get("etag") ?? "";
    assert.equal(await voyd("Object", `Object::complete_upload(${q(namespace)}, ${q(session.session_id)}, ${jq([{ partNumber: 1, etag }])}).ok`), true);
    assert.equal(await voyd("Object", `Object::stat(${q(namespace)}, "voyd/object.txt").ok`), true);
    assert.equal(await voyd("Object", `Object::stat("attacker", "voyd/object.txt").error.code == "not_found"`), true);
    assert.equal(await voyd("Object", `Object::resolve_download(${q(namespace)}, "voyd/object.txt", 60).ok`), true);
    assert.equal(await voyd("Object", `Object::delete_object(${q(namespace)}, "voyd/object.txt", "wrong").error.code == "failed_condition"`), true);
    assert.equal(await voyd("Object", `Object::delete_object(${q(namespace)}, "voyd/object.txt", "").ok`), true);
    assert.equal(await voyd("Object", `Object::cleanup_abandoned(${q(namespace)}, "2099-01-01T00:00:00.000Z", 10).ok`), true);

    await pool.query("INSERT INTO tessyl_storage_documents(namespace,table_name,document_key,version,body_json,created_at,updated_at) VALUES($1,'articles','direct',42,$2::jsonb,now(),now()) ON CONFLICT DO NOTHING", [namespace, JSON.stringify({ direct: true })]);
    assert.equal(await voyd("Document", `Document::get(${q(namespace)}, "articles", "direct").ok`), true);

    const unavailable = await createHostedStorage({ postgres: pool, openSearch: { node: "http://127.0.0.1:1", maxRetries: 0, requestTimeout: 100 }, s3: { endpoint: "http://127.0.0.1:1", region: "us-east-1", credentials, forcePathStyle: true, maxAttempts: 1 }, bucket, keyPrefix: `unavailable-${crypto.randomUUID()}` });
    try {
      const unavailableRequest = { ...objectRequest, key: "unavailable", idempotencyKey: "unavailable" };
      const unavailableAdapter = createStorageAdapter(unavailable);
      assert.equal(await voyd("Object", `Object::initiate_upload(${q(namespace)}, ${jq(unavailableRequest)}).error.code == "unavailable"`, unavailableAdapter), true);
      assert.equal(await voyd("SearchIndex", `SearchIndex::inspect(${q(namespace)}, "articles").error.code == "unavailable"`, unavailableAdapter), true);
    } finally { await unavailable.close(); }
  });
});
