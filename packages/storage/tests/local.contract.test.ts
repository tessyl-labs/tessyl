import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, it } from "node:test";
import { runStorageConformance } from "../conformance/index.js";
import { createLocalStorage } from "../local/index.js";
import { composeStorage } from "../src/composition.js";
import type { StorageComposition } from "../src/contracts.js";
import { StorageError } from "../src/errors.js";

describe("local storage conformance", () => {
  let directory: string;
  let storage: StorageComposition;

  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "tessyl-storage-"));
    storage = await createLocalStorage({ dataDirectory: directory });
  });

  after(async () => {
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("passes the backend-neutral contract suite", async () => {
    await runStorageConformance(storage, async (session, content) => {
      await writeFile(fileURLToPath(session.uploadHandle), content);
      return [];
    });
    const content = new TextEncoder().encode("cross-instance completion");
    const session = await storage.object.initiateUpload({ namespace: "cross-instance", key: "object", contentType: "text/plain", byteLength: String(content.length), checksumSha256: createHash("sha256").update(content).digest("hex"), applicationMetadata: [], idempotencyKey: "cross-instance", partCount: 1, expiresInSeconds: 300 });
    await writeFile(fileURLToPath(session.uploadHandle), content);
    const second = await createLocalStorage({ dataDirectory: directory });
    const [firstResult, secondResult] = await Promise.all([storage.object.completeUpload("cross-instance", session.sessionId), second.object.completeUpload("cross-instance", session.sessionId)]);
    assert.equal(firstResult.version, secondResult.version);
    await second.close();
    const recomposed = composeStorage({ document: storage.document }, { search: storage.search }, { searchIndex: storage.searchIndex }, { object: storage.object });
    await recomposed.close();
  });

  it("keeps host-generated upload IDs usable with small application key limits", async () => {
    const limitedDirectory = await mkdtemp(path.join(os.tmpdir(), "tessyl-storage-small-keys-"));
    const limited = await createLocalStorage({ dataDirectory: limitedDirectory, limits: { maxKeyBytes: 8 } });
    try {
      const content = new TextEncoder().encode("short");
      const session = await limited.object.initiateUpload({ namespace: "n", key: "k", contentType: "text/plain", byteLength: String(content.length), checksumSha256: createHash("sha256").update(content).digest("hex"), applicationMetadata: [], idempotencyKey: "i", partCount: 1, expiresInSeconds: 60 });
      await writeFile(fileURLToPath(session.uploadHandle), content);
      await assert.rejects(limited.object.completeUpload("n", session.sessionId, [{ partNumber: 1, etag: "x" }]), (error: unknown) => error instanceof Error && "code" in error && error.code === "invalid_request");
      assert.equal((await limited.object.completeUpload("n", session.sessionId)).byteLength, String(content.length));
    } finally { await limited.close(); await rm(limitedDirectory, { recursive: true, force: true }); }
  });

  it("expires local download handles", async () => {
    const expiryDirectory = await mkdtemp(path.join(os.tmpdir(), "tessyl-storage-download-expiry-"));
    const expiring = await createLocalStorage({ dataDirectory: expiryDirectory });
    try {
      const content = new TextEncoder().encode("temporary local download");
      const session = await expiring.object.initiateUpload({ namespace: "n", key: "object.txt", contentType: "text/plain", byteLength: String(content.length), checksumSha256: createHash("sha256").update(content).digest("hex"), applicationMetadata: [], idempotencyKey: "download-expiry", partCount: 1, expiresInSeconds: 300 });
      await writeFile(fileURLToPath(session.uploadHandle), content); await expiring.object.completeUpload("n", session.sessionId);
      const resolution = await expiring.object.resolveDownload("n", "object.txt", 1); const handlePath = fileURLToPath(resolution.url);
      await access(handlePath); const peer = await createLocalStorage({ dataDirectory: expiryDirectory }); await access(handlePath); await peer.close(); await access(handlePath);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await assert.rejects(access(handlePath), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
      assert.equal((await expiring.object.stat("n", "object.txt")).byteLength, String(content.length));
    } finally { await expiring.close(); await rm(expiryDirectory, { recursive: true, force: true }); }
  });

  it("hides orphan objects and rejects stale upload-session replays", async () => {
    const objectDirectory = await mkdtemp(path.join(os.tmpdir(), "tessyl-storage-object-authority-"));
    const objectStorage = await createLocalStorage({ dataDirectory: objectDirectory });
    try {
      const content = new TextEncoder().encode("current"); const checksum = createHash("sha256").update(content).digest("hex");
      const request = { namespace: "n", key: "object.txt", contentType: "text/plain", byteLength: String(content.length), checksumSha256: checksum, applicationMetadata: [], idempotencyKey: "current", partCount: 1, expiresInSeconds: 300 } as const;
      const current = await objectStorage.object.initiateUpload(request); await writeFile(fileURLToPath(current.uploadHandle), content); await objectStorage.object.completeUpload("n", current.sessionId);
      const database = new DatabaseSync(path.join(objectDirectory, "storage.sqlite"));
      database.prepare("INSERT INTO storage_upload_sessions(session_id,namespace,object_key,content_type,byte_length,checksum_sha256,metadata_json,idempotency_key,temp_path,expires_at,request_hash,part_count,completed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)")
        .run("00000000-0000-4000-8000-000000000000", "n", "object.txt", "text/plain", content.length, checksum, "[]", "stale", fileURLToPath(current.uploadHandle), new Date().toISOString(), "stale", 1);
      await assert.rejects(objectStorage.object.completeUpload("n", "00000000-0000-4000-8000-000000000000"), (error: unknown) => error instanceof StorageError && error.code === "not_found");
      await assert.rejects(objectStorage.object.initiateUpload({ ...request, idempotencyKey: "stale" }), (error: unknown) => error instanceof StorageError && error.code === "conflict");
      database.prepare("DELETE FROM storage_object_keys WHERE namespace='n' AND object_key='object.txt'").run();
      await assert.rejects(objectStorage.object.stat("n", "object.txt"), (error: unknown) => error instanceof StorageError && error.code === "not_found");
      await assert.rejects(objectStorage.object.resolveDownload("n", "object.txt", 60), (error: unknown) => error instanceof StorageError && error.code === "not_found");
      database.close();
    } finally { await objectStorage.close(); await rm(objectDirectory, { recursive: true, force: true }); }
  });

  it("cleans upload files left after completion commits", async () => {
    const cleanupDirectory = await mkdtemp(path.join(os.tmpdir(), "tessyl-storage-object-cleanup-"));
    const cleanupStorage = await createLocalStorage({ dataDirectory: cleanupDirectory });
    try {
      const content = new TextEncoder().encode("completed");
      const session = await cleanupStorage.object.initiateUpload({ namespace: "n", key: "object.txt", contentType: "text/plain", byteLength: String(content.length), checksumSha256: createHash("sha256").update(content).digest("hex"), applicationMetadata: [], idempotencyKey: "cleanup", partCount: 1, expiresInSeconds: 300 });
      const uploadPath = fileURLToPath(session.uploadHandle); await writeFile(uploadPath, content); await cleanupStorage.object.completeUpload("n", session.sessionId);
      await writeFile(uploadPath, content); const old = new Date(Date.now() - 20 * 60_000); await utimes(uploadPath, old, old);
      assert.equal(await cleanupStorage.object.cleanupAbandoned("n", new Date().toISOString(), 10), 1);
      await assert.rejects(access(uploadPath), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
      assert.equal((await cleanupStorage.object.stat("n", "object.txt")).checksumSha256, createHash("sha256").update(content).digest("hex"));
    } finally { await cleanupStorage.close(); await rm(cleanupDirectory, { recursive: true, force: true }); }
  });

  it("repairs a partial object copy left by a crashed completion", async () => {
    const crashDirectory = await mkdtemp(path.join(os.tmpdir(), "tessyl-storage-object-copy-crash-"));
    const crashStorage = await createLocalStorage({ dataDirectory: crashDirectory });
    try {
      const namespace = "n"; const key = "object.txt"; const content = new TextEncoder().encode("complete object");
      const session = await crashStorage.object.initiateUpload({ namespace, key, contentType: "text/plain", byteLength: String(content.length), checksumSha256: createHash("sha256").update(content).digest("hex"), applicationMetadata: [], idempotencyKey: "copy-crash", partCount: 1, expiresInSeconds: 300 });
      await writeFile(fileURLToPath(session.uploadHandle), content);
      const namespaceHash = createHash("sha256").update(namespace).digest("hex"); const keyHash = createHash("sha256").update(key).digest("hex"); const sessionHash = createHash("sha256").update(session.sessionId).digest("hex");
      const target = path.join(crashDirectory, "objects", namespaceHash.slice(0, 2), namespaceHash, `${keyHash}-${sessionHash}`);
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content.slice(0, 3));
      assert.equal((await crashStorage.object.completeUpload(namespace, session.sessionId)).checksumSha256, createHash("sha256").update(content).digest("hex"));
    } finally { await crashStorage.close(); await rm(crashDirectory, { recursive: true, force: true }); }
  });

  it("maps real SQLite lock contention to retryable unavailable", async () => {
    const lockedDirectory = await mkdtemp(path.join(os.tmpdir(), "tessyl-storage-lock-"));
    const locked = await createLocalStorage({ dataDirectory: lockedDirectory, busyTimeoutMs: 10 });
    let blocker: DatabaseSync | undefined;
    try {
      await locked.document.migrateTable("locked", { name: "items", schemaVersion: 1, indexes: [] });
      blocker = new DatabaseSync(path.join(lockedDirectory, "storage.sqlite")); blocker.exec("BEGIN IMMEDIATE");
      await assert.rejects(locked.document.transact({ namespace: "locked", idempotencyKey: "write", operations: [{ kind: "put", table: "items", key: "item", bodyJson: "{}", condition: { kind: "absent" } }] }), (error: unknown) => error instanceof StorageError && error.code === "unavailable" && error.retryable);
    } finally { blocker?.exec("ROLLBACK"); blocker?.close(); await locked.close(); await rm(lockedDirectory, { recursive: true, force: true }); }
  });
});
