# `@tessyl/storage`

`@tessyl/storage` is Tessyl's application-agnostic persistence boundary. It
provides four independently installable authorities:

- `Document`: transactional source-of-truth documents and declared indexes.
- `Search`: query-only full-text search.
- `SearchIndex`: search mutation, schema, rebuild, and cutover operations.
- `Object`: immutable object metadata and host-resolved transfer sessions.

The package contains complete local and hosted implementations. Article,
revision, publication, authorization, and asset workflow semantics belong in
the application and compose these generic operations.

## Entry points

```ts
import type { DocumentStore } from "@tessyl/storage";
import { createStorageAdapter } from "@tessyl/storage/adapter";
import { createLocalStorage } from "@tessyl/storage/local";
import { createHostedStorage } from "@tessyl/storage/hosted";
```

The core entry point exports only contracts, errors, limits, and composition.
It does not eagerly import SQLite, PostgreSQL, OpenSearch, or S3 clients.

Voyd applications resolve the package through the normal package namespace:

```voyd
use pkg::storage::{ Document, Search, SearchIndex, Object }

pub fn load(namespace: String, key: String): Document -> StorageResponse
  Document::get(namespace, "articles", key)
```

The stable external interface IDs are:

- `tessyl:storage/document@1`
- `tessyl:storage/search@1`
- `tessyl:storage/search-index@1`
- `tessyl:storage/object@1`

Changing an incompatible operation or DTO requires a new interface major
version. Generated contracts and WIT are committed in `generated/`.

## Boundary representation

Every operation requires a namespace as a separate argument. The host adapter
overwrites any namespace present in request JSON with that explicit argument,
so a Voyd caller cannot smuggle a different tenant scope through a DTO.

Documents and structured requests cross the current Wasm boundary as bounded
JSON strings. This is intentional: portable JSON is backend-neutral, while a
recursive JSON union is not a legal acyclic Component Model DTO. JSON values
must contain only objects, arrays, strings, finite numbers, booleans, and null.
The default maximum document size is 1 MiB, depth is 32, and total nodes are
bounded. Backend-native values, clients, credentials, and query languages never
cross the boundary.

When running Voyd directly through the SDK, configure its effect `bufferSize`
for the largest request and response you permit. The SDK's 128 KiB default is
smaller than this package's 1 MiB document limit; Tessyl's integration setup
uses 4 MiB so a near-limit JSON request and its response can share the buffer.
The adapter returns structured `limit_exceeded` when an encoded response would
exceed 3 MiB; callers should lower the page size and continue with the cursor.

All Voyd operations return:

```text
StorageResponse {
  ok,
  valueJson,
  error { code, message, retryable, operation, detailsJson }
}
```

Stable error codes are `not_found`, `conflict`, `failed_condition`,
`invalid_request`, `unavailable`, `quota_exceeded`, `limit_exceeded`, `timeout`,
`cancelled`, and `internal`. TypeScript APIs throw `StorageError`; the generated
adapter converts it to the DTO without throwing across the Wasm boundary.

## Document tables and indexes

Tables are declared explicitly and scoped by namespace. A definition contains
a stable name, a monotonically increasing schema version, and named indexes.

```ts
const articles = {
  name: "articles",
  schemaVersion: 1,
  indexes: [
    {
      name: "public_id",
      fields: [{ path: "public_id", type: "string" }],
      unique: true,
      ordered: false,
      sparse: false,
    },
    {
      name: "private_id",
      fields: [{ path: "private_id", type: "string" }],
      unique: true,
      ordered: false,
      sparse: false,
    },
    {
      name: "status_updated",
      fields: [
        { path: "status", type: "string" },
        { path: "updated_at", type: "string" },
      ],
      unique: false,
      ordered: true,
      sparse: false,
    },
  ],
} as const;

await storage.document.migrateTable(namespace, articles);
```

Supported index scalars are null, boolean, finite IEEE-754 number, and string.
Each declared field fixes one type. Strings use normalized, byte-stable UTF-8
binary ordering; applications that need locale collation should store a
precomputed collation key. Numbers use a sortable IEEE-754 encoding, with `-0`
canonicalized to `0`. Composite fields compare lexicographically. Missing fields
produce null for a non-sparse index and no entry for a sparse index. Uniqueness
is scoped to namespace, table, and index. The complete encoded index key is
limited to 1,024 bytes so every accepted key remains indexable by PostgreSQL;
local storage enforces the same portable boundary.

Equality, composite prefix, and ordered lower/upper range queries operate only
on declared indexes. There is no arbitrary SQL or table-scan query API. Results
use the encoded key and primary document key as a deterministic tie-breaker.
Continuation cursors are opaque base64url values and are rejected when reused
with a different index or direction.

Changing an existing definition without increasing `schemaVersion` fails with
`conflict`. A higher version atomically records the new definition and rebuilds
all index entries. Document writes and index maintenance occur in the same
SQLite or PostgreSQL transaction.

Writes support `none`, `absent`, `present`, and `version_equals` conditions.
Transactions are bounded to 100 operations by default and may span tables in
one namespace. They cannot span search or object storage. An idempotency key
replays the original result and conflicts if reused with different input.

## Durable outbox

Search is a derived projection. Write the source document, head change, and a
generic outbox document in one `Document.transact` call. Outbox bodies use these
generic fields:

- `available_at`: ISO timestamp at which the record may be claimed.
- `lease_token` and `lease_until`: host-managed lease state.
- `attempt`: host-managed claim count.
- `processed_at`: completion marker.
- `last_error`: bounded retry diagnostic.

`claimOutbox` uses an immediate SQLite write transaction or PostgreSQL
`FOR UPDATE SKIP LOCKED`. `completeOutbox` and `retryOutbox` require the exact
lease token. Leases are bounded to 86,400 seconds. Processing must remain
idempotent because a worker can finish an
external action and lose its lease before recording completion.

## Search consistency and lifecycle

`SearchIndex.upsert` and `delete` require an application-provided monotonic
integer version encoded as a string. Mutations at or below the current version
are ignored and return `applied: false`. Local search uses SQLite FTS5. Hosted
search uses OpenSearch external versions, namespace routing, and a mandatory
namespace term in a host-built bool query.

Queries support selected fields with boosts, equality/inequality filters, tags,
facets, locale, bounded pagination, and deterministic score/ID ordering. The
maximum per-field boost is 1,000. The contract never accepts SQLite FTS syntax
or OpenSearch DSL. Highlights contain
plain source text plus UTF-16 start/end ranges; they are never trusted HTML.

Create a changed schema with `beginRebuild`, replay the source-of-truth outbox
into the returned physical generation, then atomically switch the logical alias
with `cutover`. Existing generations are retained for rollback until explicitly
removed with `deleteGeneration`; deleting the active generation is rejected.
Paginated `listGenerations` recovers inactive handles after an interrupted rebuild, and
durable per-index generation counters prevent retired physical names from ever
being reused. Hosted lifecycle mutations are serialized across host instances
with a PostgreSQL advisory lock.
Hosted physical mappings carry an internal storage-format version. A legacy
active generation remains discoverable and deletable, but queries and writes
return `failed_condition` until an operator uses `beginRebuild` and `cutover`
to move the alias to the current format.
This means search is read-after-refresh, not transactionally consistent with
Document, and applications should expose that projection lag honestly.

`Search` and `SearchIndex` are separate interfaces and can be installed in
different processes or supplied to different Voyd modules. Query authority
does not imply mutation or lifecycle authority.

## Objects

Object keys are opaque application values. Backends transform them into a
namespace hash plus a SHA-256 key digest, so `..`, slashes, Unicode, and absolute
path-looking input cannot escape the namespace directory or bucket prefix.
Completed local object files and hosted S3 objects also include an immutable
upload-session digest in their physical key. A delayed cleanup or delete from
an expired lease therefore cannot remove a newer upload that has reclaimed the
same logical object key.

1. `initiateUpload` reserves an immutable key and returns a host-resolved local
   file URL or S3-compatible presigned multipart URLs.
2. The client transfers bytes directly to that handle/URL.
3. `completeUpload(namespace, sessionId, parts)` verifies tenant ownership,
   length, multipart shape, and SHA-256 before atomically exposing metadata.
4. `resolveDownload` returns an expiring local handle or presigned URL.

Metadata includes content type, decimal-string byte length, lowercase SHA-256,
bounded application metadata, a backend version, and creation time. Reusing an
upload idempotency key returns the same session. A different upload for a live
key conflicts. Delete may require the current version. Abandoned multipart
uploads remain invisible and are removed by
`cleanupAbandoned(namespace, before, limit)`; run it from a bounded periodic
worker. The cutoff is capped at the host's current time. Local cleanup also
removes old untracked upload files left by a crash before session persistence.
For hosted buckets, configure an S3 `AbortIncompleteMultipartUpload` lifecycle
rule as the authoritative backstop for a process crash between multipart
creation and PostgreSQL persistence; database cleanup handles every tracked
session.

## Local deployment

```ts
const storage = await createLocalStorage({
  dataDirectory: "/var/lib/tessyl",
  busyTimeoutMs: 5_000,
});

const adapter = createStorageAdapter(storage);
```

Local storage creates `storage.sqlite`, `objects/`, and `uploads/` under the
resolved data directory. The filesystem root is rejected. SQLite runs in WAL
mode with foreign keys, normal synchronous durability, a bounded busy timeout,
and `BEGIN IMMEDIATE` write transactions. It requires no network service.

For a consistent backup, use SQLite's online backup API or briefly stop writers,
checkpoint WAL with `PRAGMA wal_checkpoint(TRUNCATE)`, then copy the database and
`objects/` tree as one backup set. Never copy only the main database file while
ignoring a live `-wal` file. On recovery, restore both the database and objects,
run `PRAGMA integrity_check`, and let deterministic migrations run before
accepting traffic. Upload files are temporary and can be discarded; incomplete
sessions are cleaned on schedule.

SQLite serializes writers. Multiple processes may share the database on a
filesystem with correct POSIX locking, but one application process is the
recommended personal/offline deployment. Monitor busy timeouts, disk capacity,
WAL growth, integrity checks, and backup age.

## Hosted deployment

```ts
const storage = await createHostedStorage({
  postgres: {
    connectionString: process.env.DATABASE_URL,
    max: 30,
    ssl: { rejectUnauthorized: true },
  },
  openSearch: {
    node: process.env.OPENSEARCH_URL,
    ssl: { rejectUnauthorized: true },
    auth: {
      username: process.env.OPENSEARCH_USER!,
      password: process.env.OPENSEARCH_PASSWORD!,
    },
  },
  s3: {
    region: process.env.AWS_REGION,
    endpoint: process.env.S3_ENDPOINT,
  },
  bucket: process.env.S3_BUCKET!,
  keyPrefix: "production",
  maxConcurrency: 64,
});
```

Credentials and clients remain host-only. PostgreSQL uses pooled,
parameterized queries, serializable transactions, advisory locks for portable
unique-index enforcement, and jittered retries only for serialization failures.
Changing indexes on a populated hosted table is an explicit maintenance
operation: set `allowBlockingMigrations: true` only after draining writers.
Without that opt-in, `migrateTable` returns `failed_condition` instead of
silently holding the table migration lock for a full index rebuild.
OpenSearch routes by the full namespace and adds its own namespace filter even
when caller input contains a conflicting namespace. S3 operations use reserved
keys and presigned multipart URLs; completion verifies the actual bytes.

All hosted operations pass through a bounded semaphore. The four health methods
check PostgreSQL, OpenSearch cluster state, and the S3 bucket and report latency.
Use the observability hook for operation duration, success, and stable error
code; do not log document bodies, credentials, presigned URLs, or tenant mapping
secrets.

Shared infrastructure should enforce per-namespace request, result, upload, and
storage quotas above this lower-level package. Use PostgreSQL row/IO metrics,
OpenSearch routing and shard metrics, and bucket-prefix accounting to detect
noisy neighbors. Large tenants can move to dedicated pools, clusters, or buckets
by selecting a different host composition for their namespace; the Voyd API and
namespace stay unchanged.

TLS verification should remain enabled. Supply credentials through workload
identity or secret managers, rotate them without rebuilding Voyd/Wasm, grant
PostgreSQL only the storage schema, OpenSearch only the Tessyl index prefix, and
S3 only the configured bucket prefix.

## Timeouts, cancellation, and retries

TypeScript methods accept `AbortSignal` and `timeoutMs`. Cancellation is
cooperative around backend calls; synchronous SQLite work completes its current
statement before the next cancellation check. Timeout and cancellation map to
different stable errors. The fallback Voyd adapter invocation context reserves
a signal for runtimes that provide it.

Hosted mutations never report a timeout while their commit outcome is unknown.
Cancellation can remove a hosted mutation while it waits for admission. Once
admitted, the backend signal is detached and the operation settles through its
database, OpenSearch, or S3 outcome; backend-native statement/request timeouts
still apply. This prevents a timeout/retry pair from preceding a later
successful write with an unknown outcome.

Document transactions retry PostgreSQL serialization failures with bounded
jitter because the entire transaction is atomic and replay-safe. Search
mutations use external monotonic versions. Object initiation and transactions
use idempotency keys. Other writes are not blindly retried. `retryable: true`
means the caller may retry only when the operation's documented idempotency
precondition is satisfied.

Default limits are exported as `DEFAULT_STORAGE_LIMITS` and may be lowered per
deployment. Namespaces, names, keys, documents, query text, result counts,
transaction operations, index fields, metadata, upload size, and multipart
parts are all bounded before reaching a backend.

## Composition and duplicate providers

Construct exactly one provider for each requested authority, then create the
adapter explicitly. `createDocumentStorageAdapter`, `createSearchStorageAdapter`,
`createSearchIndexStorageAdapter`, and `createObjectStorageAdapter` install only
their named versioned interface; `createStorageAdapter` is the full-composition
convenience factory. `composeStorage` rejects missing or duplicate providers for
that full composition.
The Voyd linker also rejects two adapters that claim the same versioned
interface before an operation executes. There is no local/hosted discovery or
ambient global client.

## Testing and adding a backend

`@tessyl/storage/conformance` exports `runStorageConformance`. A backend must
implement all four interfaces and pass that suite without backend-specific
expectations. It covers namespace isolation, all article fixture indexes,
uniqueness, optimistic concurrency, rollback, cursor ordering, outbox leases,
search ranking/filters/facets/stale versions/rebuild, object sessions/checksums,
limits, stable errors, and cancellation.

Run local validation with:

```bash
npm run typecheck --workspace=@tessyl/storage
npm test --workspace=@tessyl/storage
npm run build --workspace=@tessyl/storage
```

The hosted suite requires disposable real services and is enabled explicitly:

```bash
TESSYL_STORAGE_HOSTED_TEST=1 \
TESSYL_STORAGE_POSTGRES_URL=postgres://... \
TESSYL_STORAGE_OPENSEARCH_URL=https://... \
TESSYL_STORAGE_S3_ENDPOINT=http://... \
npm run test:hosted --workspace=@tessyl/storage
```

The Storage GitHub workflow provisions PostgreSQL, OpenSearch, and MinIO. Both
local and hosted integration fixtures compile real Voyd source, instantiate the
Wasm runtime with the generated adapter, invoke every versioned interface, and
verify direct backend writes through the Voyd path.

To add a backend:

1. Implement the four least-authority TypeScript interfaces without returning
   backend-native values.
2. Enforce namespace in physical keys, queries, routing, and credentials.
3. Implement explicit, inspectable schema and rebuild migrations.
4. Map backend failures to `StorageError` and preserve retry semantics.
5. Run the shared conformance suite and a full Voyd/Wasm integration suite
   against the real service.
6. Document durability, backup, cleanup, scaling, and operational limits.
