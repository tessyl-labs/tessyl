# Tessyl Integration SDK

This document defines the private TypeScript API through which Tessyl compiles
and runs Tesserae. It is the supported integration boundary between the Tessyl
product and Tessyl Native; examples may precede implementation.

## Audience and package boundary

`@tessyl/native` is installed only by Tessyl services and clients. Tessera
authors never install it. They write Voyd against the separate
`pkg::tessyl_native` author API described in the
[Tessera Author SDK](./tessera-author-sdk.md).

The two surfaces ship from the same repository so their versions can remain
compatible, but they serve different callers:

| Surface | Caller | Responsibility |
| --- | --- | --- |
| Tessera Author SDK | Untrusted Voyd source | Define state, views, commands, and subscriptions |
| Tessyl Integration SDK | Trusted Tessyl code | Compile, validate, initialize, run, and terminate Tesserae |

Tessyl application code must use the integration facade. Worker bootstraps,
VX hosts, protocol brokers, validators, iframe setup, and watchdogs are private
implementation details of Native.

## Design goals

- Give Tessyl one API for the complete source-to-runtime lifecycle.
- Prevent Tessyl call sites from assembling security-sensitive internals.
- Keep Tessyl's content model outside Native.
- Make resource, capability, protocol, and author-SDK versions explicit.
- Make cleanup deterministic and failures bounded.
- Use the same validation and profiles in preview and production.

## Canonical facade

`createTessylNative` is the only supported top-level integration factory:

```ts
import { createTessylNative } from "@tessyl/native";

const native = createTessylNative(config);
```

It exposes three lifecycle operations:

```ts
interface TessylNative {
  compile(input: CompileTesseraInput): Promise<CompileTesseraResult>;
  initialize(input: InitializeTesseraInput): Promise<TesseraInstance>;
  run(input: RunTesseraInput): Promise<TesseraInstance>;
}
```

- `compile` turns author source into a validated, portable artifact.
- `initialize` validates an artifact and creates an isolated runtime without
  executing the Tessera application.
- `run` is the normal convenience path: initialize, start, and return the live
  instance.

The same facade is used in trusted build and browser environments. Native may
use environment-specific bundles internally so compiler code cannot enter the
browser bundle, but Tessyl must not gain separate low-level APIs as a result.
An operation unavailable in the configured environment fails before processing
untrusted input.

## Creating the facade

Configuration contains trusted platform adapters and policy registries, never
contributor-controlled values:

```ts
type TessylNativeConfig = {
  runtime?: {
    onArticleLink: (slug: string) => void;
  };
  telemetry?: NativeTelemetry;
};
```

A browser supplies the trusted product callback for reader-initiated article
links. Native owns compiler setup, Worker and renderer assets, and the immutable
capability and resource profile registries. Environment-specific package builds
select the server compiler or browser runtime implementation. Tessyl cannot
supply ad hoc capabilities, replace Native runtime assets, or raise resource
limits for one Tessera.

## Compiling

```ts
type CompileTesseraInput = {
  source: TesseraSourceBundle;
  authorManifest: TesseraAuthorManifest;
  profile: NativeBuildProfile;
};

type CompileTesseraResult =
  | {
      ok: true;
      artifact: TesseraArtifactV1;
      diagnostics: readonly NativeDiagnostic[];
    }
  | {
      ok: false;
      diagnostics: readonly NativeDiagnostic[];
    };
```

`compile` resolves the pinned author SDK and allowed dependencies, invokes Voyd
under build limits, inspects the Wasm boundary, generates the default fallback,
and validates the complete artifact. The result contains no Tessyl content ID,
revision, approval state, permissions, caption, or article relationship.

```ts
const result = await native.compile({ source, authorManifest, profile });

if (!result.ok) return showDiagnostics(result.diagnostics);

await tessylArtifacts.submit(result.artifact);
```

Expected source and policy failures return diagnostics. Infrastructure failures
reject with `TessylNativeError`. Tessyl owns storage, review, approval,
revisioning, and publication after compilation.

## Initializing and running

```ts
type InitializeTesseraInput = {
  artifact: TesseraArtifact;
  container: HTMLElement;
  presentation?: TesseraPresentation;
  signal?: AbortSignal;
  onStatusChange?: (status: TesseraStatus) => void;
};

type RunTesseraInput = InitializeTesseraInput;

type TesseraPresentation = {
  expandedView?: boolean;
  height?: "compact" | "standard" | "tall";
};
```

Tessyl resolves authorization and the published revision before calling Native.
Native then verifies artifact versions, hashes, schemas, and profile names. The
presentation object may affect the trusted shell's bounded layout; it cannot
change application capabilities, resources, or artifact identity.

`initialize` performs only trusted setup:

1. Validate the complete artifact and supported version tuple.
2. Render or retain the static fallback.
3. Create the sandboxed renderer iframe, Worker, message channels, broker, and
   watchdog.
4. Return an initialized instance without invoking the untrusted `app()`.

The caller can defer execution until the Tessera is near the viewport:

```ts
const instance = await native.initialize({ artifact, container });

if (isNearViewport(container)) {
  await instance.run();
}
```

The common path combines those steps:

```ts
const instance = await native.run({
  artifact,
  container,
  signal: pageLifecycle.signal,
});
```

`run` resolves only after the initial validated frame is ready. If startup
fails, the fallback remains visible and the promise rejects with a bounded
Native error.

Typed per-embed application inputs are not part of v1. When added, they must be
a versioned artifact/runtime feature, distinct from trusted presentation data.

## Instance lifecycle

```ts
interface TesseraInstance {
  readonly status: TesseraStatus;
  run(): Promise<void>;
  reset(): Promise<void>;
  setActive(active: boolean): void;
  dispose(): void;
}

type TesseraStatus =
  | "initialized"
  | "starting"
  | "running"
  | "paused"
  | "failed"
  | "disposed";
```

- `run` starts an initialized instance and is idempotent while it is running.
- `reset` terminates the Worker generation and starts a fresh one from `init`.
- `setActive(false)` pauses subscriptions and may release the Worker according
  to the resource profile.
- `dispose` synchronously marks the instance disposed, closes ports, terminates
  the Worker, disposes the renderer, and releases retained handlers. It is
  idempotent.

No method exposes the Voyd host, VX runtime, Worker, iframe, message ports,
capability handlers, or application model.

## Errors and diagnostics

```ts
class TessylNativeError extends Error {
  readonly code: NativeErrorCode;
  readonly phase: "configuration" | "compile" | "initialize" | "run";
  readonly recoverable: boolean;
}
```

Error codes are a closed, versioned union such as `unsupported_version`,
`invalid_artifact`, `resource_limit`, `timeout`, `trap`, `protocol_violation`,
and `disposed`. Messages and metadata are bounded and must not include reader
input, arbitrary source text, credentials, or attacker-sized payloads.

Compile diagnostics are for authors. Runtime errors are for Tessyl product UI
and telemetry. Tessyl may map them to localized reader-facing states but should
not parse error message strings.

## Ownership boundary

Tessyl Native owns:

- The author SDK and restricted dependency policy.
- Compilation, Wasm inspection, artifact construction, and artifact validation.
- Runtime protocols, schemas, profiles, isolation, watchdogs, and recovery.
- The trusted renderer, capability host, fallback schema, and instance lifecycle.

Tessyl owns:

- Tessera identity, ownership, revisions, provenance, review, and approval.
- Artifact storage and distribution authorization.
- Article embeds, captions, permissions, and presentation settings.
- Deciding when an authorized artifact may initialize or run.
- Product UI around Native status, errors, source review, and revision history.

Native must not call Tessyl databases or infer publication state. Tessyl must
not bypass Native validation or instantiate artifact Wasm directly.

## Versioning and compatibility

The TypeScript facade follows semantic versioning. Artifact and protocol
versions remain explicit inside the artifact and may evolve independently of
the package version. A breaking change to compile inputs, runtime inputs,
instance lifecycle, or error semantics requires a new integration-SDK major.

The Voyd author SDK has its own version recorded in the artifact. Updating the
integration package does not silently reinterpret an already published author
SDK, capability profile, resource profile, or protocol version.

## Integration requirements

- Tessyl imports only the root facade, types, and documented value helpers.
- Internal Native modules are not package exports.
- Tessyl never supplies contributor-created adapters, capability handlers,
  Worker URLs, renderer URLs, or profile definitions.
- Every initialized artifact was first authorized by Tessyl and is revalidated
  by Native.
- Every created instance is disposed on unmount, navigation, or cancellation.
- Preview uses `initialize` and `run`; it does not maintain a parallel runtime.
- Tests cover compile rejection, lazy initialization, successful run, timeout,
  reset, abort, unsupported versions, and deterministic disposal.
