# `pkg::storage`

`pkg::storage` provides typed, namespace-isolated document, search, and object
storage for Voyd applications.

The public Voyd API uses records, arrays, optionals, results, and enums. You do
not build request JSON or decode response JSON.

## Install and import

Install the package in the application workspace, then import only the
authorities the module needs:

```voyd
use pkg::storage::{ Document, StorageError, document }
use pkg::storage::document::{
  Delete,
  DeleteMutation,
  Index,
  IndexField,
  IndexScalarType,
  OutboxClaimRequest,
  OutboxCompletion,
  OutboxRetry,
  Put,
  PutMutation,
  Query,
  Stored,
  TableDefinition,
  Transaction,
  WriteCondition
}
```

The four independent effects are:

| Effect | Authority |
| --- | --- |
| `Document` | Define, read, query, and transactionally mutate documents |
| `Search` | Query full-text search |
| `SearchIndex` | Create, populate, rebuild, and remove search indexes |
| `ObjectStorage` | Manage immutable objects and transfer sessions |

A deployed host must provide an adapter for each reachable effect. Importing
only `Search` does not grant document, search-index, or object mutation
authority.

## Namespaces

Every operation is isolated by a namespace. Choose the namespace from trusted
application context, such as an authenticated account or workspace:

```voyd
document::get<Article>(workspace.id, "articles", article_id)
```

Do not accept a namespace directly from an untrusted request.

## Documents

### Define a document type

Documents are ordinary boundary-compatible Voyd values:

```voyd
use std::string::type::String

obj Article {
  public_id: String,
  title: String,
  status: String
}
```

Document roots must be records or objects. Fields may contain supported
primitives, arrays, nested records, optional values, and named variants.

### Create or migrate a table

```voyd
match(document::migrate_table(
  namespace,
  TableDefinition {
    name: "articles",
    schema_version: 1,
    indexes: [
      Index {
        name: "public_id",
        fields: [
          IndexField {
            path: "public_id",
            value_type: IndexScalarType::Text()
          }
        ],
        unique: true,
        ordered: false,
        sparse: false
      }
    ]
  }
))
  Ok:
    // Ready.
  Err<StorageError> { error }:
    // Report or handle the typed error.
```

Calling `migrate_table` repeatedly with the same definition is safe. Increment
`schema_version` when changing indexes. Reusing a version with a different
definition returns `Conflict`.

Index paths use dotted field names, such as `author.id`. Supported index field
types are `Null`, `Boolean`, `Number`, and `Text`.

### Put a typed document

`document::put` accepts your Voyd value directly. It handles storage encoding
and returns `Stored<T>`:

```voyd
let article = Article {
  public_id: "article-1",
  title: "Typed storage",
  status: "draft"
}

match(document::put(
  namespace,
  Put<Article> {
    table: "articles",
    key: "article-1",
    value: article,
    condition: WriteCondition::Absent(),
    idempotency_key: request_id
  }
))
  Err<StorageError> { error }:
    // Encoding or storage failed.
  Ok<Stored<Article>> { value: stored }:
    stored.value.title
```

Write conditions are:

- `Any`: no existence or version requirement.
- `Absent`: the key must not exist.
- `Present`: the key must exist.
- `Version(value)`: the current version must equal `value`.

Use a unique idempotency key for each logical mutation. Replaying the same
request returns its original result.

### Get a typed document

Missing documents are represented by `None`, not an error:

```voyd
match(document::get<Article>(namespace, "articles", key))
  Err<StorageError> { error }:
    // Backend failure, invalid request, or incompatible stored data.
  Ok { value: article }:
    article.match(active)
      None:
        // Missing.
      Some<Stored<Article>>:
        active.value.value.title
```

`Stored<T>` contains:

```voyd
obj Stored<T> {
  key: String,
  version: String,
  value: T,
  created_at: String,
  updated_at: String
}
```

### Delete a document

```voyd
document::delete(
  namespace,
  Delete {
    table: "articles",
    key,
    condition: WriteCondition::Version(value: current_version),
    idempotency_key: request_id
  }
)
```

Use `Absent`, `Present`, or `Version` when concurrent changes must be detected.

### Transactions

Use the `mutation:` overloads of `put` and `delete` to assemble one atomic
transaction. The put overload can fail while encoding the value:

```voyd
match(document::put(
  mutation: PutMutation<Article> {
    table: "articles",
    key: article.public_id,
    value: article,
    condition: WriteCondition::Absent()
  }
))
  Err<StorageError> { error }:
    // Encoding failed.
  Ok { value: article_write }:
    match(document::put(
      mutation: PutMutation<Event> {
        table: "outbox",
        key: event.id,
        value: event,
        condition: WriteCondition::Absent()
      }
    ))
      Err<StorageError> { error }:
        // Encoding failed.
      Ok { value: event_write }:
        document::transact(
          namespace,
          Transaction {
            idempotency_key: request_id,
            mutations: [article_write, event_write]
          }
        )
```

Create a delete mutation with
`document::delete(mutation: DeleteMutation { ... })`. Transactions may mix
mutations for different document types and tables.

The transaction result contains written table/key/version triples, deleted
keys, and a `replayed` flag. All mutations commit or none do.

### Query an index

```voyd
use pkg::storage::{ Order, Scalar }

let request = Query {
  table: "articles",
  index: "status_updated",
  prefix: [Scalar::Text(value: "draft")],
  lower: None {},
  upper: None {},
  order: Order::Ascending(),
  limit: 20,
  cursor: None {}
}

match(document::query<Article>(namespace, request))
  Err<StorageError> { error }:
    // Query failed.
  Ok { value: page }:
    page.documents
```

Use `Bound { values, inclusive }` for lower or upper range bounds. Pass the
returned cursor to fetch the next page. Cursors are opaque. Every document in
the returned `Page<T>` is decoded as `T`; incompatible stored data returns
`InvalidData`.

### Outbox workers

`document::claim_outbox<T>` leases and decodes eligible documents:

```voyd
match(document::claim_outbox<Event>(
  namespace,
  OutboxClaimRequest {
    table: "outbox",
    worker_id,
    now,
    lease_seconds: 30,
    limit: 20
  }
))
  Err<StorageError> { error }:
    // Claim failed.
  Ok { value: claimed }:
    let first = claimed.at(0)
    first.document.value
```

An outbox document must have a top-level `available_at: String` field containing
an ISO 8601 timestamp. The provider keeps attempts and leases separately, so
claiming or retrying a record never changes the shape or contents of `T`.

After processing, either complete the record:

```voyd
document::complete_outbox(
  namespace,
  OutboxCompletion {
    table: "outbox",
    key: first.document.key,
    lease_token: first.lease_token
  }
)
```

Or release it for another attempt:

```voyd
document::retry_outbox(
  namespace,
  OutboxRetry {
    table: "outbox",
    key: first.document.key,
    lease_token: first.lease_token,
    available_at: next_attempt_at,
    error: failure_message
  }
)
```

Lease tokens are required for both operations. A stale token returns
`FailedCondition`.

## Search

Search queries and index administration use separate effects.

### Create an index

```voyd
use pkg::storage::search::SearchSchema

SearchIndex::create(
  namespace,
  SearchSchema {
    name: "articles",
    version: 1,
    fields: ["title", "body"],
    filter_fields: ["status"],
    facet_fields: ["status"],
    locales: ["en"]
  }
)
```

### Index a document

```voyd
use pkg::storage::search::{
  SearchDocument,
  SearchField,
  SearchFilterValue
}

SearchIndex::upsert(
  namespace,
  SearchDocument {
    index: "articles",
    document_id: article.public_id,
    version: article_version,
    fields: [
      SearchField { name: "title", text: article.title }
    ],
    filters: [
      SearchFilterValue {
        name: "status",
        value: Scalar::Text(value: article.status)
      }
    ],
    tags: [],
    locale: "en"
  }
)
```

Versions are monotonic. Stale search mutations are ignored and report the
current version.

### Query search

```voyd
use std::array::Array
use pkg::storage::search::{
  SearchFieldSelection,
  SearchFilterEntry,
  SearchQuery
}

Search::search(
  namespace,
  SearchQuery {
    index: "articles",
    text: query_text,
    fields: [
      SearchFieldSelection { name: "title", boost: 2.0 }
    ],
    filters: Array<SearchFilterEntry>::init(),
    tags: Array<String>::init(),
    facets: ["status"],
    locale: "en",
    limit: 20,
    cursor: None {}
  }
)
```

Filters use `SearchFilter::Equal` or `SearchFilter::NotEqual`, wrapped in a
`SearchFilterEntry`. Results include scored hits, field text, highlights,
facets, and an optional cursor.

### Rebuild an index

1. Call `begin_rebuild` with the new schema version.
2. Populate the returned physical generation with `upsert`.
3. Call `cutover`.
4. Delete obsolete generations with `delete_generation`.

Use `list_generations` to inspect active and inactive generations.

## Objects

Objects are immutable after upload completion.

### Start an upload

```voyd
use std::array::Array
use pkg::storage::{ Metadata, ObjectStorage, UploadRequest }

ObjectStorage::initiate_upload(
  namespace,
  UploadRequest {
    key: "images/header.png",
    content_type: "image/png",
    byte_length: byte_length,
    checksum_sha256: checksum,
    metadata: Array<Metadata>::init(),
    idempotency_key: request_id,
    part_count: 1,
    expires_in_seconds: 900
  }
)
```

Upload the bytes using the returned part URLs or upload handle, then call
`complete_upload` with the completed part numbers and ETags.

### Read and delete metadata

- `stat` returns `Ok(None)` when the object is missing.
- `resolve_download` returns metadata and a temporary download URL.
- `delete_object` accepts an optional expected version.
- `cleanup_abandoned` removes expired incomplete upload sessions.

Object data itself does not cross the Voyd package boundary; clients transfer
bytes through the resolved upload and download locations.

## Errors

Every operation returns `Result<T, StorageError>`.

`StorageError.code` is one of:

| Code | Meaning |
| --- | --- |
| `NotFound` | A required table, index, generation, session, or object is missing |
| `Conflict` | Uniqueness, schema, idempotency, or ownership conflict |
| `FailedCondition` | Version, existence, lease, or lifecycle condition failed |
| `InvalidRequest` | The request is malformed or violates the contract |
| `InvalidData` | Stored data cannot be decoded as the requested Voyd type |
| `QuotaExceeded` | Deployment quota rejected the operation |
| `LimitExceeded` | A portable package limit was exceeded |
| `Unavailable` | The backing service is temporarily unavailable |
| `Timeout` | The operation exceeded its deadline |
| `Cancelled` | The caller cancelled the operation |
| `Internal` | Unexpected backend failure |

Only retry when `retryable` is true. Mutations must also have an idempotency key
or monotonic version before they are safe to retry.

`StorageError.details` is an array of typed name/value entries. Decode failures
include the failing path, expected type, and actual value kind.

## Operation reference

### `document`

These facade functions require the `Document` effect.

| Function | Result |
| --- | --- |
| `migrate_table(namespace, definition)` | `Result<TableInspection, StorageError>` |
| `inspect_table(namespace, table)` | `Result<TableInspection, StorageError>` |
| `get<T>(namespace, table, key)` | `Result<Optional<Stored<T>>, StorageError>` |
| `put<T>(namespace, Put<T>)` | `Result<Stored<T>, StorageError>` |
| `put<T>(mutation: PutMutation<T>)` | `Result<TransactionMutation, StorageError>` |
| `delete(namespace, Delete)` | `Result<Unit, StorageError>` |
| `delete(mutation: DeleteMutation)` | `TransactionMutation` |
| `transact(namespace, Transaction)` | `Result<TransactionResult, StorageError>` |
| `query<T>(namespace, Query)` | `Result<Page<T>, StorageError>` |
| `claim_outbox<T>(namespace, OutboxClaimRequest)` | `Result<Array<Claimed<T>>, StorageError>` |
| `complete_outbox(namespace, OutboxCompletion)` | `Result<Unit, StorageError>` |
| `retry_outbox(namespace, OutboxRetry)` | `Result<Unit, StorageError>` |

### `Search`

| Operation | Result |
| --- | --- |
| `search(namespace, request)` | `SearchPage` |

### `SearchIndex`

| Operation | Result |
| --- | --- |
| `create(namespace, schema)` | `SearchIndexInspection` |
| `inspect(namespace, logical_name)` | `Optional<SearchIndexInspection>` |
| `list_generations(namespace, request)` | `SearchGenerationPage` |
| `begin_rebuild(namespace, schema)` | `SearchIndexInspection` |
| `cutover(namespace, request)` | `SearchIndexInspection` |
| `delete_generation(namespace, physical_name)` | `Unit` |
| `upsert(namespace, document)` | `SearchMutationResult` |
| `delete_document(namespace, request)` | `SearchMutationResult` |

### `ObjectStorage`

| Operation | Result |
| --- | --- |
| `initiate_upload(namespace, request)` | `UploadSession` |
| `complete_upload(namespace, request)` | `ObjectMetadata` |
| `stat(namespace, key)` | `Optional<ObjectMetadata>` |
| `resolve_download(namespace, request)` | `DownloadResolution` |
| `delete_object(namespace, request)` | `Unit` |
| `cleanup_abandoned(namespace, request)` | `i32` |

## Portable limits

Defaults are enforced consistently across local and hosted providers:

- namespace: 256 UTF-8 bytes;
- table, index, and field names: 128 bytes;
- key: 1,024 bytes;
- document: 1 MiB;
- transaction: 100 mutations;
- index: 4 fields and 32 entries per document;
- query: 16 KiB and 100 results;
- object metadata: 32 entries and 8 KiB;
- upload: 5 GiB and 10,000 parts.

Strings must be valid portable Unicode without NUL characters. Document
nesting is limited to 32 levels and 50,000 value nodes. Signed `i64` values are
preserved across documents, indexes, and search filters without narrowing to a
JavaScript number.
