import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createSdk, type CompileResult } from "@voyd-lang/sdk";
import { createSearchStorageAdapter, createStorageAdapter } from "../host/adapter.js";
import { createLocalStorage } from "../local/index.js";
import type { StorageComposition } from "../src/contracts.js";

const namespace = "voyd-tenant";
const roots = () => ({
  src: path.resolve(import.meta.dirname, "fixtures"),
  pkgDirs: [path.resolve(import.meta.dirname, "../..")],
});

const imports = `
use std::array::Array
use std::optional::types::all
use std::result::types::all
use std::string::type::String
use pkg::storage::{ Document, Order, Search, SearchIndex, Scalar, StorageError, StorageErrorCode }
use pkg::storage::{ document, search }
use pkg::storage::document::{ Index, IndexField, IndexScalarType, OutboxClaimRequest, OutboxCompletion, Stored, TableDefinition, WriteCondition }
use pkg::storage::search::{ SearchDocument, SearchField, SearchFieldSelection, SearchFilter, SearchFilterEntry, SearchFilterValue, SearchQuery, SearchSchema }

obj Article {
  public_id: String,
  status: String,
  title: String
}

obj OutboxEvent {
  available_at: String,
  attempt: i32,
  payload: String
}

obj WideIntegers {
  minimum: i64,
  maximum: i64
}
`;

describe("Voyd → host → local backend integration", () => {
  let directory: string;
  let storage: StorageComposition;
  let adapter: ReturnType<typeof createStorageAdapter>;

  before(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "tessyl-voyd-storage-"));
    storage = await createLocalStorage({ dataDirectory: directory, busyTimeoutMs: 20 });
    adapter = createStorageAdapter(storage);
  });

  after(async () => {
    await storage.close();
    await rm(directory, { recursive: true, force: true });
  });

  const compile = async (body: string): Promise<CompileResult> => {
    const result = await createSdk().compile({ source: `${imports}\n${body}`, roots: roots() });
    assert.equal(result.success, true, result.success ? undefined : JSON.stringify(result.diagnostics));
    return result;
  };

  const run = async (body: string, entryName = "main"): Promise<boolean> => {
    const result = await compile(body);
    if (!result.success) return false;
    return result.run<boolean>({ entryName, adapters: [adapter], bufferSize: 4 * 1024 * 1024 });
  };

  it("stores and reads typed Voyd documents", async () => {
    const source = `
pub fn main(): Document -> bool
  match(Document::migrate_table(
    "${namespace}",
    TableDefinition {
      name: "articles",
      schema_version: 1,
      indexes: [
      Index {
        name: "public_id",
        fields: [IndexField { path: "public_id", value_type: IndexScalarType::Text() }],
        unique: true,
        ordered: false,
        sparse: false
      }
      ]
    }
  ))
    Err<StorageError>:
      false
    Ok:
      let article = Article {
        public_id: "typed-1",
        status: "draft",
        title: "Typed storage"
      }
      match(document::put(
        table: "articles",
        key: "a1",
        document: article,
        condition: WriteCondition::Absent(),
        idempotency_key: "put-a1"
      ))
        Err<StorageError>:
          false
        Ok { value: request }:
          match(Document::put("${namespace}", request))
            Err<StorageError>:
              false
            Ok { value: wire }:
              match(document::decode<Article>(wire))
                Err<StorageError>:
                  false
                Ok<Stored<Article>> { value: stored }:
                  if stored.value.title != "Typed storage":
                    return false
                  match(Document::get("${namespace}", "articles", "a1"))
                    Err<StorageError>:
                      false
                    Ok { value: found }:
                      match(document::decode_optional<Article>(found))
                        Err<StorageError>:
                          false
                        Ok { value: decoded }:
                          decoded.match(active)
                            Some<Stored<Article>>:
                              active.value.value.public_id == "typed-1"
                            None:
                              false
`;
    assert.equal(await run(source), true);
  });

  it("queries and transactionally mutates typed Voyd documents", async () => {
    const source = `
pub fn main(): Document -> bool
  let article = Article {
    public_id: "typed-transaction",
    status: "ready",
    title: "Transactional storage"
  }
  match(document::put_mutation(
    table: "articles",
    key: "a-transaction",
    document: article,
    condition: WriteCondition::Absent()
  ))
    Err<StorageError>:
      false
    Ok { value: mutation }:
      match(Document::transact(
        "${namespace}",
        document::transaction(
          idempotency_key: "transaction-a",
          mutations: [mutation]
        )
      ))
        Err<StorageError>:
          false
        Ok:
          let request = document::query(
            table: "articles",
            index: "public_id",
            prefix: [Scalar::Text(value: "typed-transaction")],
            lower: None {},
            upper: None {},
            order: Order::Ascending(),
            limit: 10,
            cursor: None {}
          )
          match(Document::query_documents("${namespace}", request))
            Err<StorageError>:
              false
            Ok { value: page }:
              match(document::decode_page<Article>(page))
                Err<StorageError>:
                  false
                Ok { value: decoded }:
                  if decoded.documents.len() != 1:
                    return false
                  if decoded.documents.at(0).value.title != "Transactional storage":
                    return false
                  let deletion = document::delete_mutation(
                    table: "articles",
                    key: "a-transaction",
                    condition: WriteCondition::Present()
                  )
                  match(Document::transact(
                    "${namespace}",
                    document::transaction(
                      idempotency_key: "transaction-delete-a",
                      mutations: [deletion]
                    )
                  ))
                    Err<StorageError>:
                      false
                    Ok { value: deleted }:
                      if deleted.deletes.len() != 1:
                        return false
                      if deleted.deletes.at(0).table != "articles":
                        return false
                      deleted.deletes.at(0).key == "a-transaction"
`;
    assert.equal(await run(source), true);
  });

  it("round-trips the full signed i64 range", async () => {
    const source = `
pub fn main(): Document -> bool
  match(Document::migrate_table(
    "${namespace}",
    TableDefinition {
      name: "wide_integers",
      schema_version: 1,
      indexes: [
        Index {
          name: "maximum",
          fields: [IndexField { path: "maximum", value_type: IndexScalarType::Number() }],
          unique: true,
          ordered: true,
          sparse: false
        }
      ]
    }
  ))
    Err<StorageError>:
      false
    Ok:
      match(document::put(
        table: "wide_integers",
        key: "limits",
        document: WideIntegers {
          minimum: -9223372036854775808i64,
          maximum: 9223372036854775807i64
        },
        condition: WriteCondition::Absent(),
        idempotency_key: "wide-integers-put"
      ))
        Err<StorageError>:
          false
        Ok { value: request }:
          match(Document::put("${namespace}", request))
            Err<StorageError>:
              false
            Ok { value: wire }:
              match(document::decode<WideIntegers>(wire))
                Err<StorageError>:
                  false
                Ok { value: stored }:
                  if stored.value.minimum != -9223372036854775808i64:
                    return false
                  if stored.value.maximum != 9223372036854775807i64:
                    return false
                  let request = document::query(
                    table: "wide_integers",
                    index: "maximum",
                    prefix: [Scalar::I64(value: 9223372036854775807i64)],
                    lower: None {},
                    upper: None {},
                    order: Order::Ascending(),
                    limit: 1,
                    cursor: None {}
                  )
                  match(Document::query_documents("${namespace}", request))
                    Err<StorageError>:
                      false
                    Ok { value: page }:
                      page.documents.len() == 1
`;
    assert.equal(await run(source), true);
  });

  it("uses typed search APIs without JSON transport values", async () => {
    const source = `
pub fn main(): (SearchIndex, Search) -> bool
  match(SearchIndex::create(
    "${namespace}",
    SearchSchema {
      name: "articles",
      version: 1,
      fields: ["title"],
      filter_fields: ["status", "rank"],
      facet_fields: ["status"],
      locales: ["en"]
    }
  ))
    Err<StorageError>:
      false
    Ok:
      match(SearchIndex::upsert(
        "${namespace}",
        SearchDocument {
          index: "articles",
          document_id: "a1",
          version: "1",
          fields: [SearchField { name: "title", text: "Voyd turtle" }],
          filters: [
            SearchFilterValue { name: "status", value: Scalar::Text(value: "draft") },
            SearchFilterValue { name: "rank", value: Scalar::I64(value: 9223372036854775807i64) }
          ],
          tags: ["voyd"],
          locale: "en"
        }
      ))
        Err<StorageError>:
          false
        Ok:
          match(Search::search(
            "${namespace}",
            SearchQuery {
              index: "articles",
              text: "turtle",
              fields: Array<SearchFieldSelection>::init(),
              filters: [
                SearchFilterEntry {
                  value: SearchFilter::Equal(
                    name: "rank",
                    value: Scalar::I64(value: 9223372036854775807i64)
                  )
                }
              ],
              tags: Array<String>::init(),
              facets: ["status"],
              locale: "en",
              limit: 10,
              cursor: None {}
            }
          ))
            Err<StorageError>:
              false
            Ok { value: page }:
              page.hits.len() == 1
`;
    assert.equal(await run(source), true);
  });

  it("claims and completes typed outbox values without rewriting their shape", async () => {
    const source = `
pub fn main(): Document -> bool
  match(Document::migrate_table(
    "${namespace}",
    TableDefinition {
      name: "typed_outbox",
      schema_version: 1,
      indexes: Array<Index>::init()
    }
  ))
    Err<StorageError>:
      false
    Ok:
      match(document::put(
        table: "typed_outbox",
        key: "event-1",
        document: OutboxEvent {
          available_at: "2026-07-22T00:00:00.000Z",
          attempt: 0,
          payload: "typed payload"
        },
        condition: WriteCondition::Absent(),
        idempotency_key: "typed-outbox-put"
      ))
        Err<StorageError>:
          false
        Ok { value: request }:
          match(Document::put("${namespace}", request))
            Err<StorageError>:
              false
            Ok:
              match(Document::claim_outbox(
                "${namespace}",
                OutboxClaimRequest {
                  table: "typed_outbox",
                  worker_id: "worker",
                  now: "2026-07-22T01:00:00.000Z",
                  lease_seconds: 30,
                  limit: 1
                }
              ))
                Err<StorageError>:
                  false
                Ok { value: records }:
                  match(document::decode_claimed<OutboxEvent>(records))
                    Err<StorageError>:
                      false
                    Ok { value: claimed }:
                      if claimed.len() != 1:
                        return false
                      let record = claimed.at(0)
                      if record.document.value.payload != "typed payload":
                        return false
                      if record.attempt != 1:
                        return false
                      match(Document::complete_outbox(
                        "${namespace}",
                        OutboxCompletion {
                          table: "typed_outbox",
                          key: record.document.key,
                          lease_token: record.lease_token
                        }
                      ))
                        Err<StorageError>:
                          false
                        Ok:
                          true
`;
    assert.equal(await run(source), true);
  });

  it("uses typed object APIs without JSON transport values", async () => {
    const source = `
use pkg::storage::ObjectStorage
pub fn main(): ObjectStorage -> bool
  match(ObjectStorage::stat("${namespace}", "missing.txt"))
    Err<StorageError>:
      false
    Ok { value: metadata }:
      metadata.match(active)
        Some:
          false
        None:
          true
`;
    assert.equal(await run(source), true);
  });

  it("links only when every required authority has exactly one provider", async () => {
    const result = await compile(`
pub fn main(): Document -> bool
  match(Document::get("${namespace}", "articles", "missing"))
    Ok: true
    Err: false
`);
    if (!result.success) return;
    await assert.rejects(result.run({ entryName: "main", adapters: [] }), /provide|external|interface/i);
    await assert.rejects(result.run({ entryName: "main", adapters: [createSearchStorageAdapter(storage.search)] }), /provide|external|interface/i);
    await assert.rejects(result.run({ entryName: "main", adapters: [adapter, adapter] }), /multiple.*provide/i);
  });
});
