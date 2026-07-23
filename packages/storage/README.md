# `pkg::storage`

`pkg::storage` gives Voyd applications namespace-isolated document, search,
and object storage. This guide describes the package entirely from a Voyd
application's perspective.

The package exposes four independent effects:

| Effect | Authority |
| --- | --- |
| `Document` | Migrate, read, query, and transactionally write JSON documents |
| `Search` | Query full-text search |
| `SearchIndex` | Create, populate, rebuild, and delete search indexes |
| `Object` | Create upload sessions and manage immutable objects |

Import only the authority a module needs:

```voyd
use std::string::type::String
use pkg::storage::{
  Document,
  Object,
  Search,
  SearchIndex,
  StorageError,
  StorageResponse
}
```

The Voyd host must install an adapter for every imported storage effect. A
module that only imports `Search` cannot mutate search indexes, documents, or
objects. Missing or duplicate adapters fail when the module is linked.

## Guide map

1. Learn the [namespace and response rules](#the-two-rules-to-understand-first).
2. Follow the [end-to-end application flow](#end-to-end-application-flow).
3. Use the compact [operation reference](#operation-reference) while coding.
4. Check the [portable limits](#portable-limits-and-data-rules) before choosing
   document, query, and upload sizes.

## The two rules to understand first

### Every call is namespaced

The first argument to every operation is a `namespace`. Use a stable account,
workspace, or tenant ID selected by trusted application code:

```voyd
pub fn load_article(namespace: String, key: String): Document -> StorageResponse
  Document::get(namespace, "articles", key)
```

Namespaces are isolated. A document, search hit, upload session, or object in
one namespace is not visible from another namespace.

Do not take a namespace directly from an untrusted request. Resolve it from the
authenticated application context first.

### Structured values are JSON strings

Storage requests and responses contain recursive application data, so the
package transports them as JSON strings.

Every operation returns:

```voyd
StorageResponse {
  ok: bool,
  valueJson: String,
  error: StorageError {
    code: String,
    message: String,
    retryable: bool,
    operation: String,
    detailsJson: String
  }
}
```

When `ok` is `true`, decode `valueJson`. When `ok` is `false`, ignore
`valueJson` and handle `error.code`:

```voyd
pub fn article_status(namespace: String, key: String): Document -> String
  let response = Document::get(namespace, "articles", key)
  if response.ok:
    "found"
  else if response.error.code == "not_found":
    "missing"
  else:
    response.error.code
```

Stable error codes are:

- `not_found`: the requested table, document, index, generation, session, or
  object does not exist in this namespace.
- `conflict`: a uniqueness, schema, idempotency, or ownership conflict.
- `failed_condition`: an optimistic write condition, lease, or lifecycle
  precondition failed.
- `invalid_request`: malformed JSON, a wrong field type, or invalid input.
- `quota_exceeded`: a deployment quota rejected the operation.
- `limit_exceeded`: a portable package limit was exceeded.
- `unavailable`: the backing service is temporarily unavailable.
- `timeout`: the operation exceeded its deadline.
- `cancelled`: the caller cancelled the operation.
- `internal`: an unexpected storage failure.

Only retry when `retryable` is `true` and the operation is protected by an
idempotency key or monotonic version, or is read-only.

Use `std::json::parse` to inspect `valueJson` and
`std::json::stringify` to build dynamic request JSON. Do not interpolate
untrusted text directly into JSON.

```voyd
use std::array::Array
use std::dict::Dict
use std::json::{
  JsonArray,
  JsonError,
  JsonObject,
  JsonString,
  JsonValue,
  stringify
}
use std::result::types::{ Result, Ok, Err }
use std::string::type::String

// Safely builds a one-document transaction. `body_json` is itself a JSON
// string because document bodies are nested inside the transaction request.
fn put_request_json(
  idempotency_key: String,
  table: String,
  key: String,
  body_json: String
) -> Result<String, JsonError>
  let ~condition = Dict<String, JsonValue>::init()
  condition.set("kind", JsonString { value: "absent" })

  let ~operation = Dict<String, JsonValue>::init()
  operation.set("kind", JsonString { value: "put" })
  operation.set("table", JsonString { value: table })
  operation.set("key", JsonString { value: key })
  operation.set("bodyJson", JsonString { value: body_json })
  operation.set("condition", JsonObject { value: condition })

  let ~operations = Array<JsonValue>::with_capacity(1)
  operations.push(JsonObject { value: operation })

  let ~request = Dict<String, JsonValue>::init()
  request.set("idempotencyKey", JsonString { value: idempotency_key })
  request.set("operations", JsonArray { value: operations })
  stringify(JsonObject { value: request })

pub fn create_article(
  namespace: String,
  idempotency_key: String,
  body_json: String
): Document -> StorageResponse
  match(put_request_json(idempotency_key, "articles", "article_1", body_json))
    Ok<String> { value: request_json }:
      Document::transact(namespace, request_json)
    Err<JsonError> { error }:
      {
        ok: false,
        valueJson: "null",
        error: {
          code: "invalid_request",
          message: error.message,
          retryable: false,
          operation: "article.encode",
          detailsJson: "{}"
        }
      }
```

## End-to-end application flow

A typical Voyd application uses storage in this order:

1. Migrate document tables and create the initial search schema at startup.
2. Write the source document and an outbox record in one transaction.
3. Read and query documents from the source of truth.
4. Have a worker claim the outbox record and update the search projection.
5. Query search from read-only application modules.
6. Initiate object uploads, let the client transfer bytes, then complete them.

The following sections give every request and response shape needed for that
flow.

## 1. Create document tables

Tables and indexes are explicit. Call `migrate_table` during application
startup for every namespace that uses the table:

```voyd
pub fn migrate_articles(namespace: String): Document -> StorageResponse
  Document::migrate_table(
    namespace,
    "{\"name\":\"articles\",\"schemaVersion\":1,\"indexes\":[{\"name\":\"slug\",\"fields\":[{\"path\":\"slug\",\"type\":\"string\"}],\"unique\":true,\"ordered\":false,\"sparse\":false},{\"name\":\"status_updated\",\"fields\":[{\"path\":\"status\",\"type\":\"string\"},{\"path\":\"updated_at\",\"type\":\"string\"}],\"unique\":false,\"ordered\":true,\"sparse\":false}]}"
  )
```

The readable form of that definition is:

```json
{
  "name": "articles",
  "schemaVersion": 1,
  "indexes": [
    {
      "name": "slug",
      "fields": [{ "path": "slug", "type": "string" }],
      "unique": true,
      "ordered": false,
      "sparse": false
    },
    {
      "name": "status_updated",
      "fields": [
        { "path": "status", "type": "string" },
        { "path": "updated_at", "type": "string" }
      ],
      "unique": false,
      "ordered": true,
      "sparse": false
    }
  ]
}
```

Supported indexed field types are `null`, `boolean`, `number`, and `string`.
Nested fields use dotted paths such as `author.id`.

- A unique index rejects two documents with the same indexed values.
- An ordered index supports lower and upper range queries.
- A sparse index omits documents with a missing indexed field.
- A non-sparse index treats a missing field as `null`.

Repeating the same definition is safe. To change indexes, increment
`schemaVersion`. Reusing a version with a different definition returns
`conflict`.

Inspect the active definition and document count with:

```voyd
Document::inspect_table(namespace, "articles")
```

Successful `migrate_table` and `inspect_table` responses contain:

```json
{
  "definition": { "name": "articles", "schemaVersion": 1, "indexes": [] },
  "definitionHash": "...",
  "documentCount": 0
}
```

## 2. Write documents transactionally

`transact` accepts up to 100 `put` or `delete` operations. Every operation is
committed or none is committed. All operations must use the explicit namespace
argument, but they may span multiple tables.

```voyd
pub fn publish_article(
  namespace: String,
  request_json: String
): Document -> StorageResponse
  Document::transact(namespace, request_json)
```

A complete request that writes an article and its search outbox event is:

```json
{
  "idempotencyKey": "publish:article_1:request_7",
  "operations": [
    {
      "kind": "put",
      "table": "articles",
      "key": "article_1",
      "bodyJson": "{\"slug\":\"storage-guide\",\"title\":\"Storage in Voyd\",\"body\":\"A complete guide\",\"status\":\"published\",\"author\":\"Ada\",\"updated_at\":\"2026-07-18T12:00:00.000Z\"}",
      "condition": { "kind": "absent" }
    },
    {
      "kind": "put",
      "table": "outbox",
      "key": "search:article_1:1",
      "bodyJson": "{\"type\":\"article.search_upsert\",\"article_id\":\"article_1\",\"available_at\":\"2026-07-18T12:00:00.000Z\",\"attempt\":0}",
      "condition": { "kind": "absent" }
    }
  ]
}
```

Use a stable idempotency key for one logical request. Retrying the exact request
with the same key returns the original result with `replayed: true`. Reusing the
key with different input returns `conflict`.

Write conditions are:

```json
{ "kind": "none" }
{ "kind": "absent" }
{ "kind": "present" }
{ "kind": "version_equals", "version": "3" }
```

- `none` writes regardless of whether the key exists.
- `absent` creates only when the key does not exist.
- `present` updates or deletes only when the key exists.
- `version_equals` provides optimistic concurrency using a version returned by
  a previous read or write.

A successful transaction returns:

```json
{
  "documents": [
    {
      "namespace": "account_123",
      "table": "articles",
      "key": "article_1",
      "version": "1",
      "bodyJson": "{...}",
      "createdAt": "2026-07-18T12:00:00.000Z",
      "updatedAt": "2026-07-18T12:00:00.000Z"
    }
  ],
  "deletedKeys": [],
  "replayed": false
}
```

To update safely, read the document, change its body, then use its version:

```json
{
  "idempotencyKey": "archive:article_1:request_8",
  "operations": [
    {
      "kind": "put",
      "table": "articles",
      "key": "article_1",
      "bodyJson": "{\"slug\":\"storage-guide\",\"status\":\"archived\",\"updated_at\":\"2026-07-19T09:00:00.000Z\"}",
      "condition": { "kind": "version_equals", "version": "1" }
    }
  ]
}
```

To delete safely:

```json
{
  "idempotencyKey": "delete:article_1:request_9",
  "operations": [
    {
      "kind": "delete",
      "table": "articles",
      "key": "article_1",
      "condition": { "kind": "version_equals", "version": "2" }
    }
  ]
}
```

## 3. Read and query documents

Read one document by table and key:

```voyd
Document::get(namespace, "articles", "article_1")
```

The successful `valueJson` is one stored-document object in the shape shown
above. A missing key returns `not_found`.

Queries only use declared indexes; there is no table-scan or arbitrary query
language.

```voyd
pub fn published_articles(
  namespace: String,
  cursor: String
): Document -> StorageResponse
  let cursor_json = if cursor == "" then: "" else: ",\"cursor\":\"${cursor}\""
  Document::query_documents(
    namespace,
    "{\"table\":\"articles\",\"index\":\"status_updated\",\"prefix\":[\"published\"],\"order\":\"desc\",\"limit\":20${cursor_json}}"
  )
```

Only use interpolation like the example above for an opaque cursor returned by
storage. Use `std::json` when any interpolated value can come from a user.

The complete query shape is:

```json
{
  "table": "articles",
  "index": "status_updated",
  "prefix": ["published"],
  "lower": ["published", "2026-01-01T00:00:00.000Z"],
  "lowerInclusive": true,
  "upper": ["published", "2027-01-01T00:00:00.000Z"],
  "upperInclusive": false,
  "order": "asc",
  "limit": 100,
  "cursor": "opaque continuation token"
}
```

`prefix` may contain the leading fields of a composite index. `lower` and
`upper` apply to ordered indexes. Omit optional bounds and `cursor` when they
are not needed.

The response is:

```json
{
  "documents": [
    {
      "namespace": "account_123",
      "table": "articles",
      "key": "article_1",
      "version": "1",
      "bodyJson": "{\"slug\":\"storage-guide\",\"status\":\"published\"}",
      "createdAt": "2026-07-18T12:00:00.000Z",
      "updatedAt": "2026-07-18T12:00:00.000Z"
    }
  ],
  "cursor": "opaque continuation token"
}
```

Continue with the same query and returned cursor until `cursor` is absent. A
cursor cannot be reused with a changed index, bounds, order, or search query.

## 4. Process durable outbox records

Create an outbox table before writing events:

```json
{
  "name": "outbox",
  "schemaVersion": 1,
  "indexes": [
    {
      "name": "available",
      "fields": [{ "path": "available_at", "type": "string" }],
      "unique": false,
      "ordered": true,
      "sparse": false
    }
  ]
}
```

Write each outbox record in the same transaction as its source document. Its
body must contain `available_at`; initialize `attempt` to `0`. Storage manages
`lease_token`, `lease_until`, `attempt`, `processed_at`, and `last_error`.

Claim ready records:

```voyd
pub fn claim_search_work(
  namespace: String,
  now: String
): Document -> StorageResponse
  Document::claim_outbox(
    namespace,
    "{\"table\":\"outbox\",\"workerId\":\"search-worker-1\",\"now\":\"${now}\",\"leaseSeconds\":60,\"limit\":25}"
  )
```

Build this JSON with `std::json` if `now` or `workerId` is not trusted
application data.

A claim response contains:

```json
[
  {
    "document": {
      "table": "outbox",
      "key": "search:article_1:1",
      "version": "2",
      "bodyJson": "{...}"
    },
    "leaseToken": "opaque lease token",
    "attempt": 1
  }
]
```

After performing the external action idempotently, complete the record with
the exact token returned by the claim:

```voyd
Document::complete_outbox(
  namespace,
  "outbox",
  "search:article_1:1",
  lease_token
)
```

To retry later:

```voyd
Document::retry_outbox(
  namespace,
  "outbox",
  "search:article_1:1",
  lease_token,
  "2026-07-18T12:05:00.000Z",
  "search temporarily unavailable"
)
```

Outbox delivery is at least once. A worker can finish its action and lose its
lease before completion is recorded, so the action must be safe to repeat.

## 5. Create and populate search

Search is a derived projection, not the source of truth. Create its initial
schema at startup:

```voyd
pub fn create_article_search(namespace: String): SearchIndex -> StorageResponse
  SearchIndex::create(
    namespace,
    "{\"name\":\"articles\",\"version\":1,\"fields\":[\"title\",\"body\"],\"filterFields\":[\"status\",\"author\"],\"facetFields\":[\"status\",\"author\"],\"locales\":[\"en\"]}"
  )
```

The readable schema is:

```json
{
  "name": "articles",
  "version": 1,
  "fields": ["title", "body"],
  "filterFields": ["status", "author"],
  "facetFields": ["status", "author"],
  "locales": ["en"]
}
```

Repeating `create` with the same schema is safe. A changed schema requires the
rebuild flow below.

Upsert the projection from an outbox worker:

```voyd
pub fn index_article(
  namespace: String,
  document_json: String
): SearchIndex -> StorageResponse
  SearchIndex::upsert(namespace, document_json)
```

```json
{
  "index": "articles",
  "documentId": "article_1",
  "version": "1",
  "fields": [
    { "name": "title", "text": "Storage in Voyd" },
    { "name": "body", "text": "A complete guide" }
  ],
  "filters": [
    { "name": "status", "value": "published" },
    { "name": "author", "value": "Ada" }
  ],
  "tags": ["documentation"],
  "locale": "en"
}
```

`version` must be a positive decimal integer string that increases for that
search document. Repeating or reordering writes is safe: a mutation whose
version is not newer returns:

```json
{ "applied": false, "currentVersion": "3" }
```

Delete a search document with a newer version:

```voyd
SearchIndex::delete_document(
  namespace,
  "articles",
  "article_1",
  "4"
)
```

## 6. Query search

A module that only needs to search should import `Search`, not `SearchIndex`:

```voyd
use pkg::storage::{ Search, StorageResponse }

pub fn search_articles(
  namespace: String,
  query_json: String
): Search -> StorageResponse
  Search::search(namespace, query_json)
```

Complete query:

```json
{
  "index": "articles",
  "text": "storage guide",
  "fields": [
    { "name": "title", "boost": 2 },
    { "name": "body", "boost": 1 }
  ],
  "filters": [
    { "name": "status", "operator": "eq", "value": "published" },
    { "name": "author", "operator": "neq", "value": "Unknown" }
  ],
  "tags": ["documentation"],
  "facets": ["author", "status"],
  "locale": "en",
  "limit": 20,
  "cursor": "optional opaque continuation token"
}
```

Omit `cursor` on the first page. An empty `fields` array searches every schema
field with boost `1`. Query terms, filters, and tags use AND semantics.

Response:

```json
{
  "hits": [
    {
      "documentId": "article_1",
      "version": "1",
      "score": 3,
      "fields": [
        { "name": "title", "text": "Storage in Voyd" },
        { "name": "body", "text": "A complete guide" }
      ],
      "highlights": [
        {
          "field": "title",
          "text": "Storage in Voyd",
          "ranges": [{ "start": 0, "end": 7 }]
        }
      ]
    }
  ],
  "facets": [
    {
      "name": "author",
      "buckets": [{ "value": "Ada", "count": 1 }]
    }
  ],
  "cursor": "optional opaque continuation token"
}
```

Highlight text is plain source text, never trusted HTML. Ranges are UTF-16
start/end offsets. Escape text before rendering it.

Search is read-after-refresh and can lag behind document writes. Application UI
should not imply that a new source document is immediately searchable.

## 7. Rebuild a search schema

Do not call `create` with a changed schema. Rebuild without interrupting the
active index:

1. Call `begin_rebuild` with a higher schema version.
2. Read `physicalName` from the response.
3. Replay every source document into that physical name with `upsert`.
4. Continue applying live outbox events to the new generation.
5. Call `cutover` after the new generation is caught up.
6. Keep the old generation for rollback, then delete it explicitly.

```voyd
SearchIndex::begin_rebuild(
  namespace,
  "{\"name\":\"articles\",\"version\":2,\"fields\":[\"title\",\"body\",\"summary\"],\"filterFields\":[\"status\",\"author\"],\"facetFields\":[\"status\",\"author\"],\"locales\":[\"en\"]}"
)
```

The response to `create`, `inspect`, `begin_rebuild`, and `cutover` is:

```json
{
  "namespace": "account_123",
  "logicalName": "articles",
  "physicalName": "opaque generation name",
  "schema": {
    "name": "articles",
    "version": 2,
    "fields": ["title", "body", "summary"],
    "filterFields": ["status", "author"],
    "facetFields": ["status", "author"],
    "locales": ["en"]
  },
  "generation": 2,
  "active": false
}
```

During replay, set each upsert's `index` to the returned `physicalName`, not
`articles`. Cut over when replay and live events are caught up:

```voyd
SearchIndex::cutover(namespace, "articles", physical_name)
```

Recover generations after an interrupted rebuild:

```voyd
SearchIndex::list_generations(namespace, "articles", 100, "")
```

Pass the returned cursor as the fourth argument for later pages. Inspect the
active logical index with:

```voyd
SearchIndex::inspect(namespace, "articles")
```

Delete an inactive generation only after the rollback window closes:

```voyd
SearchIndex::delete_generation(namespace, old_physical_name)
```

Deleting the active generation returns `failed_condition`.

## 8. Upload, download, and delete objects

Object bytes do not cross the Voyd effect boundary. Voyd creates a transfer
session; the client uploads or downloads directly through the returned URL or
handle.

Initiate an upload:

```voyd
pub fn start_upload(
  namespace: String,
  request_json: String
): Object -> StorageResponse
  Object::initiate_upload(namespace, request_json)
```

```json
{
  "key": "articles/article_1/image.png",
  "contentType": "image/png",
  "byteLength": "24837",
  "checksumSha256": "lowercase hexadecimal SHA-256",
  "applicationMetadata": [
    { "name": "article_id", "value": "article_1" }
  ],
  "idempotencyKey": "upload:article_1:request_10",
  "partCount": 1,
  "expiresInSeconds": 300
}
```

`byteLength` is a decimal string. Calculate the checksum over the exact bytes
the client will upload. Reusing the same idempotency key with the same request
returns the same session.

Response:

```json
{
  "sessionId": "upload session UUID",
  "namespace": "account_123",
  "key": "articles/article_1/image.png",
  "expiresAt": "2026-07-18T12:05:00.000Z",
  "uploadHandle": "host-resolved upload handle",
  "parts": [
    { "partNumber": 1, "url": "host-resolved upload URL" }
  ]
}
```

The application returns the appropriate handle or part URLs to its trusted
client. After the client transfers the bytes, complete the session. Local
single-part transfers use an empty parts array:

```voyd
Object::complete_upload(namespace, session_id, "[]")
```

For a multipart transfer, pass the part numbers and ETags returned by the
transfer endpoint:

```json
[
  { "partNumber": 1, "etag": "etag returned for part 1" },
  { "partNumber": 2, "etag": "etag returned for part 2" }
]
```

Completion verifies namespace ownership, total length, multipart shape, and
SHA-256 before making the object visible. It returns:

```json
{
  "namespace": "account_123",
  "key": "articles/article_1/image.png",
  "contentType": "image/png",
  "byteLength": "24837",
  "checksumSha256": "lowercase hexadecimal SHA-256",
  "applicationMetadata": [
    { "name": "article_id", "value": "article_1" }
  ],
  "version": "opaque object version",
  "createdAt": "2026-07-18T12:01:00.000Z"
}
```

Read metadata without downloading:

```voyd
Object::stat(namespace, "articles/article_1/image.png")
```

Resolve a download for 60 seconds:

```voyd
Object::resolve_download(
  namespace,
  "articles/article_1/image.png",
  60
)
```

Response:

```json
{
  "metadata": {
    "namespace": "account_123",
    "key": "articles/article_1/image.png",
    "contentType": "image/png",
    "byteLength": "24837",
    "checksumSha256": "lowercase hexadecimal SHA-256",
    "applicationMetadata": [
      { "name": "article_id", "value": "article_1" }
    ],
    "version": "opaque object version",
    "createdAt": "2026-07-18T12:01:00.000Z"
  },
  "url": "host-resolved download URL",
  "expiresAt": "2026-07-18T12:02:00.000Z"
}
```

Delete with the current version to prevent a stale request from deleting a
replacement object:

```voyd
Object::delete_object(
  namespace,
  "articles/article_1/image.png",
  expected_version
)
```

Pass `""` as `expected_version` only when unconditional deletion is intended.

Periodically clean expired, incomplete uploads:

```voyd
Object::cleanup_abandoned(
  namespace,
  "2026-07-17T12:00:00.000Z",
  100
)
```

The successful `valueJson` is the number of sessions removed.

## Operation reference

### `Document`

```voyd
Document::migrate_table(namespace, definitionJson)
Document::inspect_table(namespace, table)
Document::get(namespace, table, key)
Document::transact(namespace, requestJson)
Document::query_documents(namespace, requestJson)
Document::claim_outbox(namespace, requestJson)
Document::complete_outbox(namespace, table, key, leaseToken)
Document::retry_outbox(namespace, table, key, leaseToken, availableAt, error)
```

### `Search`

```voyd
Search::search(namespace, requestJson)
```

### `SearchIndex`

```voyd
SearchIndex::create(namespace, schemaJson)
SearchIndex::inspect(namespace, logicalName)
SearchIndex::list_generations(namespace, logicalName, limit, cursor)
SearchIndex::begin_rebuild(namespace, schemaJson)
SearchIndex::cutover(namespace, logicalName, physicalName)
SearchIndex::delete_generation(namespace, physicalName)
SearchIndex::upsert(namespace, documentJson)
SearchIndex::delete_document(namespace, index, documentId, version)
```

Use `""` for the first `list_generations` cursor.

### `Object`

```voyd
Object::initiate_upload(namespace, requestJson)
Object::complete_upload(namespace, sessionId, partsJson)
Object::stat(namespace, key)
Object::resolve_download(namespace, key, expiresInSeconds)
Object::delete_object(namespace, key, expectedVersion)
Object::cleanup_abandoned(namespace, before, limit)
```

## Portable limits and data rules

The package rejects input before it becomes backend-specific. Design Voyd
application data around these defaults:

| Value | Default maximum |
| --- | ---: |
| Namespace | 256 UTF-8 bytes |
| Name | 128 UTF-8 bytes |
| Document or object key | 1,024 UTF-8 bytes |
| Document JSON | 1 MiB |
| Operations per transaction | 100 |
| Fields per document index | 4 |
| Indexes per table/document | 32 |
| Search query text | 16 KiB |
| Results per page | 100 |
| Object metadata entries | 32 |
| Object metadata | 8 KiB |
| Upload size | 5 GiB |
| Multipart parts | 10,000 |

JSON values may contain objects, arrays, strings, finite numbers, booleans, and
`null`. Document roots must be objects. NUL characters, unpaired UTF-16
surrogates, non-finite numbers, excessive nesting, and oversized values are
rejected.

Names for tables, indexes, fields, and search schema members use lowercase
snake case beginning with a letter. Object and document keys are opaque
application strings and may contain slashes or Unicode.

The current Voyd transport uses one bounded effect buffer for encoded arguments
and results. A host intending to permit near-1-MiB documents should configure a
4-MiB buffer. A response larger than the storage adapter's 3-MiB response limit
returns `limit_exceeded`; request a smaller page and continue with its cursor.

## Interface identities

These versioned interface IDs are stable:

- `tessyl:storage/document@1`
- `tessyl:storage/search@1`
- `tessyl:storage/search-index@1`
- `tessyl:storage/object@1`

The effect names and JSON shapes documented here are the public contract for
Voyd applications.
