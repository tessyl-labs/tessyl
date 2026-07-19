import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { CompletedPart, StorageComposition, TableDefinition, UploadSession } from "../src/contracts.js";
import { StorageError } from "../src/errors.js";

export type UploadWriter = (session: UploadSession, content: Uint8Array) => Promise<readonly CompletedPart[]>;

export const ARTICLE_TABLE: TableDefinition = {
  name: "articles",
  schemaVersion: 1,
  indexes: [
    { name: "public_id", fields: [{ path: "public_id", type: "string" }], unique: true, ordered: false, sparse: false },
    { name: "private_id", fields: [{ path: "private_id", type: "string" }], unique: true, ordered: false, sparse: false },
    { name: "status_updated", fields: [{ path: "status", type: "string" }, { path: "updated_at", type: "string" }], unique: false, ordered: true, sparse: false },
  ],
};

export const SEARCH_SCHEMA = {
  name: "articles",
  version: 1,
  fields: ["title", "body"],
  filterFields: ["status", "author"],
  facetFields: ["status", "author"],
  locales: ["en", "fr"],
} as const;

/** Backend-neutral contract assertions shared by local and disposable hosted suites. */
export const runStorageConformance = async (storage: StorageComposition, writeUpload: UploadWriter): Promise<void> => {
  const alpha = `tenant-alpha-${crypto.randomUUID()}`;
  const beta = `tenant-beta-${crypto.randomUUID()}`;
  await storage.document.migrateTable(alpha, ARTICLE_TABLE);
  await storage.document.migrateTable(beta, ARTICLE_TABLE);

  const article = { public_id: "pub-1", private_id: "private-1", status: "draft", updated_at: "2026-07-18T10:00:00.000Z", title: "Unicode 🐢 article" };
  const createRequest = { namespace: alpha, idempotencyKey: "create-article", operations: [{ kind: "put" as const, table: "articles", key: "article-1", bodyJson: JSON.stringify(article), condition: { kind: "absent" as const } }] };
  const concurrentCreates = await Promise.all([storage.document.transact(createRequest), storage.document.transact(createRequest)]);
  assert.equal(concurrentCreates[0]?.documents[0]?.version, "1");
  assert.equal(concurrentCreates.filter(({ replayed }) => replayed).length, 1);
  assert.equal((await storage.document.transact({ namespace: alpha, idempotencyKey: "create-article", operations: [{ kind: "put", table: "articles", key: "article-1", bodyJson: JSON.stringify(article), condition: { kind: "absent" } }] })).replayed, true);
  await assert.rejects(storage.document.get(beta, "articles", "article-1"), (error: unknown) => error instanceof StorageError && error.code === "not_found");
  assert.equal((await storage.document.query({ namespace: alpha, table: "articles", index: "public_id", prefix: ["pub-1"], order: "asc", limit: 10 })).documents[0]?.key, "article-1");
  assert.equal((await storage.document.query({ namespace: alpha, table: "articles", index: "private_id", prefix: ["private-1"], order: "asc", limit: 10 })).documents[0]?.key, "article-1");

  await assert.rejects(storage.document.transact({ namespace: alpha, idempotencyKey: "unique-conflict", operations: [{ kind: "put", table: "articles", key: "article-2", bodyJson: JSON.stringify({ ...article, private_id: "private-2" }), condition: { kind: "absent" } }] }), (error: unknown) => error instanceof StorageError && error.code === "conflict");
  await assert.rejects(storage.document.get(alpha, "articles", "article-2"), (error: unknown) => error instanceof StorageError && error.code === "not_found");
  await assert.rejects(storage.document.transact({ namespace: alpha, idempotencyKey: "bad-version", operations: [{ kind: "put", table: "articles", key: "article-1", bodyJson: JSON.stringify(article), condition: { kind: "version_equals", version: "99" } }] }), (error: unknown) => error instanceof StorageError && error.code === "failed_condition");
  await storage.document.transact({ namespace: alpha, idempotencyKey: "delete-incarnation", operations: [{ kind: "delete", table: "articles", key: "article-1", condition: { kind: "version_equals", version: "1" } }] });
  const recreated = await storage.document.transact({ namespace: alpha, idempotencyKey: "recreate-incarnation", operations: [{ kind: "put", table: "articles", key: "article-1", bodyJson: JSON.stringify(article), condition: { kind: "absent" } }] });
  assert.equal(recreated.documents[0]?.version, "3");
  await assert.rejects(storage.document.transact({ namespace: alpha, idempotencyKey: "stale-incarnation", operations: [{ kind: "put", table: "articles", key: "article-1", bodyJson: JSON.stringify(article), condition: { kind: "version_equals", version: "1" } }] }), (error: unknown) => error instanceof StorageError && error.code === "failed_condition");
  await assert.rejects(storage.document.transact({ namespace: alpha, idempotencyKey: "atomic-rollback", operations: [
    { kind: "put", table: "articles", key: "rolled-back", bodyJson: JSON.stringify({ ...article, public_id: "rollback", private_id: "rollback" }), condition: { kind: "absent" } },
    { kind: "put", table: "articles", key: "conflicting", bodyJson: JSON.stringify(article), condition: { kind: "absent" } },
  ] }), (error: unknown) => error instanceof StorageError && error.code === "conflict");
  await assert.rejects(storage.document.get(alpha, "articles", "rolled-back"), (error: unknown) => error instanceof StorageError && error.code === "not_found");
  await assert.rejects(storage.document.transact({ namespace: alpha, idempotencyKey: "bad-kind", operations: [{ kind: "unknown", table: "articles", key: "bad", condition: { kind: "none" } } as never] }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  await assert.rejects(storage.document.transact({ namespace: alpha, idempotencyKey: "bad-condition", operations: [{ kind: "delete", table: "articles", key: "article-1", condition: { kind: "unknown" } as never }] }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  await assert.rejects(storage.document.transact({ namespace: alpha, idempotencyKey: "nul-document", operations: [{ kind: "put", table: "articles", key: "nul-document", bodyJson: '{"public_id":"nul\\u0000","private_id":"nul","status":"draft","updated_at":"2026-07-18T10:00:00.000Z"}', condition: { kind: "absent" } }] }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  await assert.rejects(storage.document.transact({ namespace: alpha, idempotencyKey: "surrogate-document", operations: [{ kind: "put", table: "articles", key: "surrogate-document", bodyJson: '{"public_id":"bad\\ud800","private_id":"surrogate","status":"draft","updated_at":"2026-07-18T10:00:00.000Z"}', condition: { kind: "absent" } }] }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  await assert.rejects(storage.document.transact({ namespace: alpha, idempotencyKey: "oversized-index-key", operations: [{ kind: "put", table: "articles", key: "oversized-index-key", bodyJson: JSON.stringify({ ...article, public_id: "x".repeat(600), private_id: "oversized-index-key" }), condition: { kind: "absent" } }] }), (error: unknown) => error instanceof StorageError && error.code === "limit_exceeded");
  await assert.rejects(storage.document.query({ namespace: alpha, table: "articles", index: "public_id", prefix: ["x".repeat(600)], order: "asc", limit: 10 }), (error: unknown) => error instanceof StorageError && error.code === "limit_exceeded");

  for (let index = 2; index <= 4; index += 1) await storage.document.transact({ namespace: alpha, idempotencyKey: `article-${index}`, operations: [{ kind: "put", table: "articles", key: `article-${index}`, bodyJson: JSON.stringify({ public_id: `pub-${index}`, private_id: `private-${index}`, status: "draft", updated_at: `2026-07-18T1${index}:00:00.000Z` }), condition: { kind: "absent" } }] });
  const firstPage = await storage.document.query({ namespace: alpha, table: "articles", index: "status_updated", prefix: ["draft"], order: "asc", limit: 2 });
  const secondPage = await storage.document.query({ namespace: alpha, table: "articles", index: "status_updated", prefix: ["draft"], order: "asc", limit: 2, cursor: firstPage.cursor });
  assert.deepEqual([...firstPage.documents, ...secondPage.documents].map((document) => document.key), ["article-1", "article-2", "article-3", "article-4"]);
  await assert.rejects(storage.document.query({ namespace: alpha, table: "articles", index: "status_updated", prefix: ["published"], order: "asc", limit: 2, cursor: firstPage.cursor }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  const descending = await storage.document.query({ namespace: alpha, table: "articles", index: "status_updated", prefix: ["draft"], lower: ["draft", "2026-07-18T12:00:00.000Z"], lowerInclusive: true, upper: ["draft", "2026-07-18T14:00:00.000Z"], upperInclusive: false, order: "desc", limit: 10 });
  assert.deepEqual(descending.documents.map(({ key }) => key), ["article-3", "article-2"]);
  await assert.rejects(storage.document.query({ namespace: alpha, table: "articles", index: "status_updated", prefix: null, order: "sideways", limit: 10 } as never), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");

  const outbox: TableDefinition = { name: "outbox", schemaVersion: 1, indexes: [{ name: "available", fields: [{ path: "available_at", type: "string" }], unique: false, ordered: true, sparse: false }] };
  await storage.document.migrateTable(alpha, outbox);
  await storage.document.transact({ namespace: alpha, idempotencyKey: "outbox-1", operations: [{ kind: "put", table: "outbox", key: "event-1", bodyJson: JSON.stringify({ type: "generic.event", payload: { id: 1 }, available_at: "2026-07-18T00:00:00.000Z", attempt: 0 }), condition: { kind: "absent" } }] });
  const claims = await storage.document.claimOutbox({ namespace: alpha, table: "outbox", workerId: "worker-a", now: "2026-07-18T12:00:00.000Z", leaseSeconds: 30, limit: 10 });
  assert.equal(claims.length, 1); assert.equal((await storage.document.claimOutbox({ namespace: alpha, table: "outbox", workerId: "worker-b", now: "2026-07-18T12:00:01.000Z", leaseSeconds: 30, limit: 10 })).length, 0);
  await assert.rejects(storage.document.retryOutbox(alpha, "outbox", "event-1", claims[0]!.leaseToken, "2026-07-18T12:01:00.000Z", "bad\0error"), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  await storage.document.retryOutbox(alpha, "outbox", "event-1", claims[0]!.leaseToken, "2026-07-18T12:01:00.000Z", "temporary");
  const retryClaim = await storage.document.claimOutbox({ namespace: alpha, table: "outbox", workerId: "worker-b", now: "2026-07-18T12:01:01.000Z", leaseSeconds: 30, limit: 10 });
  assert.equal(retryClaim[0]?.attempt, 2); await storage.document.completeOutbox(alpha, "outbox", "event-1", retryClaim[0]!.leaseToken);
  await storage.document.transact({ namespace: alpha, idempotencyKey: "outbox-long-worker", operations: [{ kind: "put", table: "outbox", key: "event-long-worker", bodyJson: JSON.stringify({ available_at: "2026-07-18T00:00:00.000Z", attempt: 0 }), condition: { kind: "absent" } }] });
  const longWorkerClaim = await storage.document.claimOutbox({ namespace: alpha, table: "outbox", workerId: "w".repeat(1_024), now: "2026-07-18T12:01:02.000Z", leaseSeconds: 30, limit: 1 });
  assert.equal(longWorkerClaim.length, 1); await storage.document.completeOutbox(alpha, "outbox", "event-long-worker", longWorkerClaim[0]!.leaseToken);
  await storage.document.transact({ namespace: alpha, idempotencyKey: "outbox-malformed", operations: [{ kind: "put", table: "outbox", key: "event-malformed", bodyJson: JSON.stringify({ available_at: "2026-07-18T00:00:00.000Z", attempt: "bad" }), condition: { kind: "absent" } }] });
  await assert.rejects(storage.document.claimOutbox({ namespace: alpha, table: "outbox", workerId: "worker-c", now: "2026-07-18T12:02:00.000Z", leaseSeconds: 30, limit: 10 }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  await assert.rejects(storage.document.claimOutbox({ namespace: alpha, table: "outbox", workerId: "worker-c", now: "2026-07-18T12:02:00.000Z", leaseSeconds: 86_401, limit: 10 }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");

  const searchSchema = { ...SEARCH_SCHEMA, fields: [...SEARCH_SCHEMA.fields], filterFields: [...SEARCH_SCHEMA.filterFields], facetFields: [...SEARCH_SCHEMA.facetFields], locales: [...SEARCH_SCHEMA.locales] };
  const initialSearch = await storage.searchIndex.create(alpha, searchSchema); await storage.searchIndex.create(beta, searchSchema);
  const createRaceNamespace = `search-create-race-${crypto.randomUUID()}`;
  const createRace = await Promise.allSettled([storage.searchIndex.create(createRaceNamespace, searchSchema), storage.searchIndex.create(createRaceNamespace, { ...searchSchema, version: 2 })]);
  assert.equal(createRace.filter(({ status }) => status === "fulfilled").length, 1); assert.equal(createRace.filter(({ status }) => status === "rejected").length, 1);
  const searchDocument = { namespace: alpha, index: "articles", documentId: "article-1", version: "10", fields: [{ name: "title", text: "Turtle storage guide" }, { name: "body", text: "A durable Unicode guide" }], filters: [{ name: "status", value: "published" }, { name: "author", value: "Ada" }], tags: ["docs"], locale: "en" } as const;
  await assert.rejects(storage.searchIndex.upsert({ ...searchDocument, version: "0" }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  await assert.rejects(storage.searchIndex.upsert({ ...searchDocument, version: "01" }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  await assert.rejects(storage.searchIndex.upsert({ ...searchDocument, documentId: "oversized-filter", filters: [{ name: "status", value: "x".repeat(32_001) }] }), (error: unknown) => error instanceof StorageError && error.code === "limit_exceeded");
  await assert.rejects(storage.searchIndex.upsert({ ...searchDocument, documentId: "oversized-term", fields: [{ name: "title", text: "x".repeat(32_001) }] }), (error: unknown) => error instanceof StorageError && error.code === "limit_exceeded");
  await assert.rejects(storage.searchIndex.upsert({ ...searchDocument, documentId: "nul-search", fields: [{ name: "title", text: "bad\0text" }] }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  assert.equal((await storage.searchIndex.upsert(searchDocument)).applied, true);
  assert.equal((await storage.searchIndex.upsert({ ...searchDocument, version: "9" })).applied, false);
  assert.equal((await storage.searchIndex.upsert({ ...searchDocument, version: "10", fields: [{ name: "title", text: "must not overwrite" }] })).applied, false);
  const searchPage = await storage.search.query({ namespace: alpha, index: "articles", text: "turtle guide", fields: [{ name: "title", boost: 2 }, { name: "body", boost: 1 }], filters: [{ name: "status", operator: "eq", value: "published" }], tags: ["docs"], facets: ["status"], locale: "en", limit: 10 });
  await assert.rejects(storage.search.query({ namespace: alpha, index: "articles", text: "", fields: [], filters: [{ name: "status", operator: "eq", value: "x".repeat(32_001) }], tags: [], facets: [], locale: "en", limit: 10 }), (error: unknown) => error instanceof StorageError && error.code === "limit_exceeded");
  await assert.rejects(storage.search.query({ namespace: alpha, index: "articles", text: "turtle", fields: [{ name: "title", boost: 1_001 }], filters: [], tags: [], facets: [], locale: "en", limit: 10 }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  assert.equal(searchPage.hits[0]?.documentId, "article-1"); assert.ok((searchPage.hits[0]?.highlights[0]?.ranges.length ?? 0) > 0); assert.equal(searchPage.facets[0]?.buckets[0]?.value, "published");
  assert.equal((await storage.search.query({ namespace: alpha, index: "articles", text: "turtle unicode", fields: [{ name: "title", boost: 1 }], filters: [], tags: [], facets: [], locale: "en", limit: 10 })).hits.length, 0);
  await storage.searchIndex.upsert({ ...searchDocument, documentId: "field-token-boundary", version: "1", fields: [{ name: "title", text: "foobar" }, { name: "body", text: "foo" }], filters: [], tags: ["field-token-boundary"] });
  assert.equal((await storage.search.query({ namespace: alpha, index: "articles", text: "foo", fields: [{ name: "title", boost: 1 }], filters: [], tags: ["field-token-boundary"], facets: [], locale: "en", limit: 10 })).hits.length, 0);
  const boundaryHits = (await storage.search.query({ namespace: alpha, index: "articles", text: "foo", fields: [{ name: "body", boost: 1 }], filters: [], tags: ["field-token-boundary"], facets: [], locale: "en", limit: 10 })).hits;
  assert.deepEqual(boundaryHits.map(({ documentId }) => documentId), ["field-token-boundary"]); assert.deepEqual(boundaryHits[0]?.highlights, [{ field: "body", text: "foo", ranges: [{ start: 0, end: 3 }] }]);
  await storage.searchIndex.upsert({ ...searchDocument, documentId: "cross-field-terms", version: "1", fields: [{ name: "title", text: "foo" }, { name: "body", text: "bar" }], filters: [], tags: ["cross-field-terms"] });
  assert.deepEqual((await storage.search.query({ namespace: alpha, index: "articles", text: "foo bar", fields: [{ name: "title", boost: 1 }, { name: "body", boost: 1 }], filters: [], tags: ["cross-field-terms"], facets: [], locale: "en", limit: 10 })).hits.map(({ documentId }) => documentId), ["cross-field-terms"]);
  assert.equal((await storage.search.query({ namespace: beta, index: "articles", text: "turtle", fields: [], filters: [], tags: [], facets: [], locale: "en", limit: 10 })).hits.length, 0);
  await assert.rejects(storage.search.query({ namespace: alpha, index: "missing", text: "", fields: [], filters: [], tags: [], facets: [], locale: "", limit: 10 }), (error: unknown) => error instanceof StorageError && error.code === "not_found");
  await storage.searchIndex.upsert({ ...searchDocument, documentId: "article-2", version: "1" });
  const oldGenerationPage = await storage.search.query({ namespace: alpha, index: "articles", text: "turtle", fields: [], filters: [], tags: [], facets: [], locale: "en", limit: 1 });
  assert.ok(oldGenerationPage.cursor);
  await assert.rejects(storage.search.query({ namespace: alpha, index: "articles", text: "guide", fields: [], filters: [], tags: [], facets: [], locale: "en", limit: 1, cursor: oldGenerationPage.cursor }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  const rebuild = await storage.searchIndex.beginRebuild(alpha, { ...searchSchema, version: 2 }); await storage.searchIndex.upsert({ ...searchDocument, index: rebuild.physicalName, version: "11" }); await storage.searchIndex.cutover(alpha, "articles", rebuild.physicalName);
  await assert.rejects(storage.searchIndex.deleteGeneration(alpha, rebuild.physicalName), (error: unknown) => error instanceof StorageError && error.code === "failed_condition");
  await storage.searchIndex.deleteGeneration(alpha, initialSearch.physicalName);
  await assert.rejects(storage.searchIndex.deleteGeneration(alpha, initialSearch.physicalName), (error: unknown) => error instanceof StorageError && error.code === "not_found");
  const abandoned = await storage.searchIndex.beginRebuild(alpha, { ...searchSchema, version: 3 });
  assert.equal(abandoned.generation, 3); assert.ok((await storage.searchIndex.listGenerations(alpha, "articles", 10)).generations.some(({ physicalName }) => physicalName === abandoned.physicalName));
  const firstGenerationPage = await storage.searchIndex.listGenerations(alpha, "articles", 1); const secondGenerationPage = await storage.searchIndex.listGenerations(alpha, "articles", 1, firstGenerationPage.cursor);
  assert.deepEqual([...firstGenerationPage.generations, ...secondGenerationPage.generations].map(({ generation }) => generation), [2, 3]);
  await storage.searchIndex.deleteGeneration(alpha, abandoned.physicalName);
  const replacementGeneration = await storage.searchIndex.beginRebuild(alpha, { ...searchSchema, version: 3 });
  assert.equal(replacementGeneration.generation, 4); await storage.searchIndex.deleteGeneration(alpha, replacementGeneration.physicalName);
  assert.deepEqual((await storage.searchIndex.listGenerations(alpha, "articles", 10)).generations.map(({ generation }) => generation), [2]);
  await assert.rejects(storage.search.query({ namespace: alpha, index: "articles", text: "turtle", fields: [], filters: [], tags: [], facets: [], locale: "en", limit: 1, cursor: oldGenerationPage.cursor }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  assert.equal((await storage.search.query({ namespace: alpha, index: "articles", text: "turtle", fields: [], filters: [], tags: [], facets: [], locale: "en", limit: 10 })).hits[0]?.version, "11");
  await storage.searchIndex.upsert({ ...searchDocument, index: rebuild.physicalName, documentId: "number-filter", version: "1", filters: [{ name: "status", value: 1 }] });
  await storage.searchIndex.upsert({ ...searchDocument, index: rebuild.physicalName, documentId: "string-filter", version: "1", filters: [{ name: "status", value: "1" }] });
  await storage.searchIndex.upsert({ ...searchDocument, index: rebuild.physicalName, documentId: "\uE000", version: "1", filters: [{ name: "status", value: "unicode" }], tags: ["unicode-order"] });
  await storage.searchIndex.upsert({ ...searchDocument, index: rebuild.physicalName, documentId: "😀", version: "1", filters: [{ name: "status", value: "unicode" }], tags: ["unicode-order"] });
  const unicodeFirst = await storage.search.query({ namespace: alpha, index: "articles", text: "", fields: [], filters: [], tags: ["unicode-order"], facets: [], locale: "en", limit: 1 });
  const unicodeSecond = await storage.search.query({ namespace: alpha, index: "articles", text: "", fields: [], filters: [], tags: ["unicode-order"], facets: [], locale: "en", limit: 1, cursor: unicodeFirst.cursor });
  assert.deepEqual([...unicodeFirst.hits, ...unicodeSecond.hits].map(({ documentId }) => documentId), ["\uE000", "😀"]);
  assert.deepEqual((await storage.search.query({ namespace: alpha, index: "articles", text: "", fields: [], filters: [{ name: "status", operator: "eq", value: 1 }], tags: [], facets: [], locale: "en", limit: 10 })).hits.map(({ documentId }) => documentId), ["number-filter"]);
  assert.deepEqual((await storage.search.query({ namespace: alpha, index: "articles", text: "", fields: [], filters: [{ name: "status", operator: "eq", value: "1" }], tags: [], facets: [], locale: "en", limit: 10 })).hits.map(({ documentId }) => documentId), ["string-filter"]);
  const longSearchName = "l".repeat(128); const longSchema = { ...searchSchema, name: longSearchName, version: 1 };
  await storage.searchIndex.create(alpha, longSchema); const longRebuild = await storage.searchIndex.beginRebuild(alpha, { ...longSchema, version: 2 });
  await storage.searchIndex.upsert({ ...searchDocument, index: longRebuild.physicalName, documentId: "long-name", version: "1" });
  await storage.searchIndex.cutover(alpha, longSearchName, longRebuild.physicalName); assert.equal((await storage.searchIndex.delete(alpha, longRebuild.physicalName, "long-name", "2")).applied, true);
  await storage.searchIndex.create(alpha, { ...searchSchema, name: "s_articles" });
  assert.equal((await storage.searchIndex.upsert({ ...searchDocument, index: "s_articles", documentId: "prefixed-logical", version: "1" })).applied, true);
  const longDocumentId = "i".repeat(600); assert.equal((await storage.searchIndex.upsert({ ...searchDocument, index: rebuild.physicalName, documentId: longDocumentId, version: "1" })).applied, true);
  assert.equal((await storage.searchIndex.delete(alpha, rebuild.physicalName, longDocumentId, "2")).applied, true);
  await assert.rejects(storage.searchIndex.upsert({ ...searchDocument, namespace: alpha, index: (await storage.searchIndex.inspect(beta, "articles")).physicalName, version: "12" }), (error: unknown) => error instanceof StorageError && (error.code === "invalid_request" || error.code === "not_found"));
  assert.equal((await storage.searchIndex.delete(alpha, "articles", "article-1", "12")).applied, true);
  assert.equal((await storage.searchIndex.upsert({ ...searchDocument, version: "11" })).applied, false);
  assert.equal((await storage.search.query({ namespace: alpha, index: "articles", text: "turtle", fields: [], filters: [{ name: "status", operator: "eq", value: "published" }], tags: [], facets: [], locale: "en", limit: 10 })).hits.length, 0);

  const content = new TextEncoder().encode("immutable turtle object 🐢"); const checksum = createHash("sha256").update(content).digest("hex");
  const uploadRequest = { namespace: alpha, key: "assets/turtle.txt", contentType: "text/plain; charset=utf-8", byteLength: String(content.byteLength), checksumSha256: checksum, applicationMetadata: [{ name: "purpose", value: "test" }], idempotencyKey: "object-1", partCount: 1, expiresInSeconds: 300 } as const;
  await assert.rejects(storage.object.initiateUpload({ ...uploadRequest, key: "assets/nonportable.txt", idempotencyKey: "object-nonportable", applicationMetadata: [{ name: "purpose", value: "bad\0metadata" }] }), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  const [session, replayedSession] = await Promise.all([storage.object.initiateUpload(uploadRequest), storage.object.initiateUpload(uploadRequest)]); assert.equal(replayedSession.sessionId, session.sessionId);
  await assert.rejects(storage.object.completeUpload(alpha, session.sessionId, Array.from({ length: 10_001 }, (_, index) => ({ partNumber: index + 1, etag: "etag" }))), (error: unknown) => error instanceof StorageError && error.code === "limit_exceeded");
  await assert.rejects(storage.object.completeUpload(alpha, session.sessionId, [{ partNumber: 1, etag: "bad\0etag" }]), (error: unknown) => error instanceof StorageError && error.code === "invalid_request");
  await assert.rejects(storage.object.initiateUpload({ namespace: alpha, key: "assets/other.txt", contentType: "text/plain", byteLength: String(content.byteLength), checksumSha256: checksum, applicationMetadata: [], idempotencyKey: "object-1", partCount: 1, expiresInSeconds: 300 }), (error: unknown) => error instanceof StorageError && error.code === "conflict");
  await assert.rejects(storage.object.completeUpload(beta, session.sessionId, []), (error: unknown) => error instanceof StorageError && error.code === "not_found");
  const parts = await writeUpload(session, content); const [metadata, replayedMetadata] = await Promise.all([storage.object.completeUpload(alpha, session.sessionId, parts), storage.object.completeUpload(alpha, session.sessionId, parts)]); assert.equal(replayedMetadata.version, metadata.version); assert.equal(metadata.checksumSha256, checksum); assert.equal((await storage.object.stat(alpha, "assets/turtle.txt")).byteLength, String(content.byteLength));
  await assert.rejects(storage.object.initiateUpload({ namespace: alpha, key: "assets/turtle.txt", contentType: "text/plain", byteLength: String(content.byteLength), checksumSha256: checksum, applicationMetadata: [], idempotencyKey: "object-duplicate-key", partCount: 1, expiresInSeconds: 300 }), (error: unknown) => error instanceof StorageError && error.code === "conflict");
  await assert.rejects(storage.object.stat(beta, "assets/turtle.txt"), (error: unknown) => error instanceof StorageError && error.code === "not_found"); assert.ok((await storage.object.resolveDownload(alpha, "assets/turtle.txt", 60)).url);
  await assert.rejects(storage.object.delete(alpha, "assets/turtle.txt", "wrong-version"), (error: unknown) => error instanceof StorageError && error.code === "failed_condition"); await Promise.all([storage.object.delete(alpha, "assets/turtle.txt", metadata.version), storage.object.delete(alpha, "assets/turtle.txt", metadata.version)]);
  const replacement = await storage.object.initiateUpload({ ...uploadRequest, idempotencyKey: "object-replacement" }); const replacementParts = await writeUpload(replacement, content); const replacementMetadata = await storage.object.completeUpload(alpha, replacement.sessionId, replacementParts); assert.equal(replacementMetadata.checksumSha256, checksum); await storage.object.delete(alpha, "assets/turtle.txt", replacementMetadata.version);

  await storage.search.close(); assert.equal((await storage.document.health()).ready, true);
  const controller = new AbortController(); controller.abort(); await assert.rejects(storage.document.health({ signal: controller.signal }), (error: unknown) => error instanceof StorageError && error.code === "cancelled");
};
