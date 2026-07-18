# `@tessyl/tfm`

`@tessyl/tfm` parses Tessyl Flavored Markdown (TFM) into a deterministic,
validated flat node table. It supports CommonMark, GitHub Flavored Markdown,
and the versioned TFM directive vocabulary. It does not render HTML, fetch
links or references, or execute author content.

The durable schema version is `tfm-1`; the directive vocabulary version is
`tfm-directives-1`. Incompatible changes require a new version.

## TypeScript API

```ts
import { parse, type TfmParseResult } from "@tessyl/tfm";

const result: TfmParseResult = parse(`
# Motion

::tessyl-video[Pendulum demonstration.]{asset="asr_video_01JABC" controls=true}
`);

if (!result.success) {
  console.error(result.diagnostics);
}
```

Author syntax and validation failures are returned as structured diagnostics;
they are not thrown. Per-call limits may be lowered for stricter consumers:

```ts
parse(source, { limits: { maxSourceBytes: 100_000, maxNodeCount: 5_000 } });
```

## Voyd API

The package advertises its Voyd source and Node/browser adapter in
`package.json`. The adapter implements the synchronous
`tessyl:tfm/parser@1` interface.

```voyd
use pkg::tfm::{ parse, ParseResult }

let result = parse(source)
```

Monorepo consumers that resolve Voyd packages from source should include the
repository's `packages` directory in `roots.pkgDirs`; installed package
consumers use their normal package resolution setup. The checked-in generated
contract, TypeScript bindings, and WIT interface live in `generated/`.

## Result schema

`TfmParseResult` contains:

- `schemaVersion` and `vocabularyVersion`;
- `success`, which is false when any error diagnostic was produced;
- `root`, the index of the root node;
- `nodes`, an acyclic flat node table;
- `diagnostics`, with stable codes, severity, message, and source span; and
- `limits`, the effective resource limits for the parse.

Each node stores child indices rather than nested objects, so the DTO can cross
the Voyd/Wasm host boundary. A node includes its kind, source span, child
indices, normalized directive attributes, and fixed fields for Markdown data
such as text, URL, title, reference identifier, language, heading depth, list
metadata, and task-list state. TypeScript exposes a closed `TfmNodeKind` union;
unexpected dependency nodes become `unsupported` rather than changing the
public schema. Fields that do not apply use an empty string, `false`, or `0` sentinel.
Offsets are UTF-16 code-unit offsets, matching JavaScript string indexing;
line and column values are one-based.

Raw HTML produces `TFM_RAW_HTML`, makes the result unsuccessful, and is kept
only as a bounded inert text snippet. Ordinary Markdown links and image URLs
are preserved as data for a later rendering/security policy. CommonMark
reference nodes carry an identifier and resolve through the single matching
`definition` node, avoiding repeated URL/title payloads. The parser never
fetches them.

## TFM grammar

Leaf directives are atomic blocks and use exactly two colons:

```md
::name[Optional caption with **inline Markdown**]{key="value"}
```

Container directives wrap Markdown and use at least three colons. A closing
fence must contain at least as many colons as its opener. When containers are
nested, the outer fence must be longer:

```md
::::tessyl-card-grid{columns=2}
:::tessyl-card{title="Mercury"}
The closest planet to the Sun.
:::
::::
```

Single-colon inline directives are not part of TFM v1. Directive names,
attributes, forms, and layout nesting are closed and allowlisted.

### Leaf vocabulary

| Directive | Attributes |
| --- | --- |
| `tessyl-video` | required `asset` (`asr_video_…`); `controls` boolean, default `true` |
| `tessyl-audio` | required `asset` (`asr_audio_…`); optional `transcript` (`asr_text_…`); `controls` boolean, default `true` |
| `tessyl-app` | required `revision` (`tsr_…`); `height` is `compact`, `standard`, or `tall`, default `standard` |
| `tessyl-data-table` | required `dataset` (`dsr_…`); `sortable` boolean, default `true` |

### Container vocabulary

| Directive | Attributes and nesting |
| --- | --- |
| `tessyl-aside` | optional `title`; `tone` is `informative`, `note`, `tip`, `warning`, or `caution`, default `informative` |
| `tessyl-infobox` | optional `title`; `tone` is `neutral`, `positive`, or `warning`, default `neutral` |
| `tessyl-columns` | no attributes; contains only `tessyl-column` directives |
| `tessyl-column` | no attributes; must be a direct child of `tessyl-columns` |
| `tessyl-card-grid` | `columns` is an integer from 1 through 4, default 3; contains only `tessyl-card` directives |
| `tessyl-card` | required `title`; must be a direct child of `tessyl-card-grid` |

Opaque IDs are checked only for their documented prefix and bounded syntax.
Existence, authorization, storage lookup, rendering, and Tessera execution are
outside this package.

## Resource limits

Default hard limits are:

| Resource | Limit |
| --- | ---: |
| UTF-8 source bytes | 2,000,000 |
| AST nesting depth | 64 |
| nodes | 50,000 |
| attributes per directive | 32 |
| attribute name/value characters | 1,024 |
| diagnostics | 100 |

Overrides can only lower these hard limits. Once the diagnostic limit is hit,
the final diagnostic is `TFM_DIAGNOSTIC_LIMIT`. Source, depth, and node budget
failures stop conversion before a large boundary DTO is allocated. Invalid
directive source snippets are capped at 256 characters and invalid container
descendants are validated without being copied into unreachable node records.

## Development

```bash
npm run generate -w @tessyl/tfm
npm run typecheck -w @tessyl/tfm
npm test -w @tessyl/tfm
npm run build -w @tessyl/tfm
```

Regenerate and commit `generated/` whenever the Voyd external DTO changes.
