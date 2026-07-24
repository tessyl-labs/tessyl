import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import {
  CreateBucketCommand,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Client as OpenSearchClient } from "@opensearch-project/opensearch";
import pg from "pg";
import { ARTICLE_TABLE, runStorageConformance } from "../conformance/index.js";
import { createHostedStorage } from "../hosted/index.js";
import type { StorageComposition } from "../src/contracts.js";
import { StorageError } from "../src/errors.js";

const enabled = process.env.TESSYL_STORAGE_HOSTED_TEST === "1";

describe("hosted storage against PostgreSQL, OpenSearch, and S3", { skip: !enabled }, () => {
  const postgresUrl = process.env.TESSYL_STORAGE_POSTGRES_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/tessyl_storage";
  const openSearchUrl = process.env.TESSYL_STORAGE_OPENSEARCH_URL ?? "http://127.0.0.1:9200";
  const s3Endpoint = process.env.TESSYL_STORAGE_S3_ENDPOINT ?? "http://127.0.0.1:9000";
  const bucket = process.env.TESSYL_STORAGE_S3_BUCKET ?? "tessyl-storage-test";
  const credentials = {
    accessKeyId: process.env.TESSYL_STORAGE_S3_ACCESS_KEY ?? "minioadmin",
    secretAccessKey: process.env.TESSYL_STORAGE_S3_SECRET_KEY ?? "minioadmin",
  };
  const pool = new pg.Pool({ connectionString: postgresUrl, max: 10 });
  const openSearch = new OpenSearchClient({ node: openSearchUrl });
  const s3 = new S3Client({ endpoint: s3Endpoint, region: "us-east-1", credentials, forcePathStyle: true });
  let storage: StorageComposition;

  before(async () => {
    await s3.send(new CreateBucketCommand({ Bucket: bucket })).catch((error: unknown) => {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 409) throw error;
    });
    await s3.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: "Enabled" } }));
    storage = await createHostedStorage({
      postgres: pool,
      openSearch,
      s3,
      bucket,
      keyPrefix: `ci-${crypto.randomUUID()}`,
      maxConcurrency: 16,
    });
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

  it("uses the authoritative object reservation when stale completed sessions exist", async () => {
    const namespace = `object-reservation-${crypto.randomUUID()}`;
    const objectKey = "object.txt";
    const staleSession = crypto.randomUUID();
    const currentSession = crypto.randomUUID();
    const staleBackendKey = `tests/${staleSession}`;
    const currentBackendKey = `tests/${currentSession}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: staleBackendKey, Body: "stale" }));
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: currentBackendKey, Body: "current" }));
    const insert = `INSERT INTO tessyl_storage_upload_sessions(session_id,namespace,object_key,content_type,byte_length,checksum_sha256,metadata_json,idempotency_key,backend_upload_id,backend_key,expires_at,completed,version,request_hash,part_count,created_at)
      VALUES($1,$2,$3,'text/plain',$4,$5,'[]'::jsonb,$6,'stale-session',$7,now(),true,$8,'stale-session',1,$9)`;
    await pool.query(insert, [staleSession, namespace, objectKey, 5, createHash("sha256").update("stale").digest("hex"), "stale", staleBackendKey, "stale-version", new Date("2026-01-01T00:00:00.000Z")]);
    await pool.query(insert, [currentSession, namespace, objectKey, 7, createHash("sha256").update("current").digest("hex"), "current", currentBackendKey, "current-version", new Date("2026-01-02T00:00:00.000Z")]);
    await pool.query("INSERT INTO tessyl_storage_object_keys(namespace,object_key,session_id) VALUES($1,$2,$3)", [namespace, objectKey, currentSession]);
    assert.equal((await storage.object.stat(namespace, objectKey)).version, "current-version");
    await assert.rejects(storage.object.completeUpload(namespace, staleSession, []), (error: unknown) => error instanceof StorageError && error.code === "not_found");
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
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [namespace, ARTICLE_TABLE.name]);
      const first = limited.document.transact({
        namespace,
        idempotencyKey: "first",
        operations: [{
          kind: "put",
          table: ARTICLE_TABLE.name,
          key: "first",
          bodyJson: JSON.stringify({ public_id: "first", private_id: "first", status: "draft", updated_at: "2026-07-18T00:00:00.000Z" }),
          condition: { kind: "absent" },
        }],
      });
      for (;;) {
        const waiting = Number((await pool.query("SELECT COUNT(*) AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'", [applicationName])).rows[0]!.count);
        if (waiting > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const controller = new AbortController();
      const second = limited.document.transact({
        namespace,
        idempotencyKey: "second",
        operations: [{ kind: "delete", table: ARTICLE_TABLE.name, key: "missing", condition: { kind: "none" } }],
      }, { signal: controller.signal });
      controller.abort(new Error("request closed"));
      await assert.rejects(second, (error: unknown) => error instanceof StorageError && error.code === "cancelled" && !error.retryable);
      await blocker.query("ROLLBACK");
      await first;
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await limited.close();
      await limitedPool.end();
    }
  });

  it("timestamps hosted objects when publication completes", async () => {
    const namespace = `object-created-at-${crypto.randomUUID()}`;
    const content = new TextEncoder().encode("published now");
    const session = await storage.object.initiateUpload({
      namespace,
      key: "object.txt",
      contentType: "text/plain",
      byteLength: String(content.length),
      checksumSha256: createHash("sha256").update(content).digest("hex"),
      applicationMetadata: [],
      idempotencyKey: "created-at",
      partCount: 1,
      expiresInSeconds: 300,
    });
    const response = await fetch(session.parts[0]!.url, { method: "PUT", body: content });
    assert.equal(response.ok, true, await response.text());
    await pool.query("UPDATE tessyl_storage_upload_sessions SET created_at='2000-01-01T00:00:00.000Z' WHERE namespace=$1 AND session_id=$2", [namespace, session.sessionId]);
    const completionStartedAt = Date.now();
    const metadata = await storage.object.completeUpload(namespace, session.sessionId, [{ partNumber: 1, etag: response.headers.get("etag") ?? "" }]);
    assert.ok(new Date(metadata.createdAt).getTime() >= completionStartedAt - 1_000);
  });

  it("deletes the exact stored version from versioned buckets", async () => {
    const namespace = `versioned-object-${crypto.randomUUID()}`;
    const content = new TextEncoder().encode("delete every stored byte");
    const session = await storage.object.initiateUpload({
      namespace,
      key: "object.txt",
      contentType: "text/plain",
      byteLength: String(content.length),
      checksumSha256: createHash("sha256").update(content).digest("hex"),
      applicationMetadata: [],
      idempotencyKey: "versioned-delete",
      partCount: 1,
      expiresInSeconds: 300,
    });
    const response = await fetch(session.parts[0]!.url, { method: "PUT", body: content });
    assert.equal(response.ok, true, await response.text());
    const metadata = await storage.object.completeUpload(namespace, session.sessionId, [{ partNumber: 1, etag: response.headers.get("etag") ?? "" }]);
    const row = (await pool.query<{ backend_key: string; backend_version_id: string }>(
      "SELECT backend_key,backend_version_id FROM tessyl_storage_upload_sessions WHERE namespace=$1 AND session_id=$2",
      [namespace, session.sessionId],
    )).rows[0]!;
    assert.ok(row.backend_version_id);
    assert.equal(metadata.version, row.backend_version_id);
    await storage.object.delete(namespace, "object.txt", metadata.version);
    const versions = await s3.send(new ListObjectVersionsCommand({ Bucket: bucket, Prefix: row.backend_key }));
    assert.equal(versions.Versions?.some(({ Key }) => Key === row.backend_key) ?? false, false);
    assert.equal(versions.DeleteMarkers?.some(({ Key }) => Key === row.backend_key) ?? false, false);
  });
});
