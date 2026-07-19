# `@tessyl/tfm`

`@tessyl/tfm` parses Tessyl Flavored Markdown (TFM) into a deterministic,
validated flat node table and safely renders accepted TFM to semantic HTML. It
supports CommonMark, GitHub Flavored Markdown, and the TFM directive
vocabulary. It never fetches author links or resources during parsing or
rendering.

The current schema version is `tfm-1`; the directive vocabulary version is
`tfm-directives-1`.

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

## Safe HTML rendering

`renderHtml` fails closed when parsing produces an error. By default it returns
a standalone HTML document with current `@tessyl/design-tokens` values,
renderer styles, a restrictive CSP meta policy, and only a hash-authorized,
package-owned table sorter—never author scripts:

```ts
import { renderHtml } from "@tessyl/tfm";

const rendered = renderHtml(source, { title: "Lesson" });
if (!rendered.success) {
  console.error(rendered.diagnostics);
} else {
  response.setHeader("Content-Security-Policy", rendered.contentSecurityPolicy);
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(rendered.html);
}
```

Always send `contentSecurityPolicy` as an HTTP header when serving the result.
The document also contains the policy as a meta element, but browsers enforce
`frame-ancestors` only from the response header.

For insertion into an existing trusted page, request a fragment and import the
shared styles. Fragment styles refer to Tessyl semantic CSS variables, so they
inherit host theme changes:

```ts
import "@tessyl/design-tokens/theme.css";
import "@tessyl/tfm/renderer.css";
import { hydrateTfm, renderHtml } from "@tessyl/tfm";

const rendered = renderHtml(source, { format: "fragment" });
container.innerHTML = rendered.html;
const disposeInteractions = hydrateTfm(container);
```

Call the returned disposer before replacing or removing a hydrated fragment.

The renderer:

- escapes text, titles, code, accessible names, directive strings, and dataset cells;
- rejects raw HTML by failing the whole render;
- permits only HTTP(S), `mailto`, `tel`, and same-origin relative links;
- blocks every Markdown image request by default; `imagePolicy: "same-origin"`
  explicitly permits relative same-origin images and `imagePolicy: "https"`
  additionally permits HTTPS images;
- adds no-referrer and safe external-link attributes;
- emits no author scripts or event handlers; and
- deduplicates resource resolution and applies render-wide resource, dataset,
  and diagnostic budgets.

Opaque directive IDs are not authorization. A host can resolve them only after
checking existence and caller access:

```ts
const rendered = renderHtml(source, {
  resolveResource({ kind, id }) {
    const authorized = authorizeAndLoad(kind, id, currentUser);
    if (!authorized) return undefined;
    return kind === "dataset"
      ? { columns: authorized.columns, rows: authorized.rows }
      : { url: authorized.url, label: authorized.label };
  },
});
```

For asynchronous authorization or storage, `renderHtmlAsync` parses once,
deduplicates resource requests, resolves them concurrently, and renders the
pre-authorized bundle:

```ts
const rendered = await renderHtmlAsync(source, {
  async resolveResource({ kind, id }) {
    return authorizeAndLoadAsync(kind, id, currentUser);
  },
});
```

Callers that already have authorized data can pass serializable `resources`
directly. `resolveResource` and `resources` are trust boundaries; their output
is still structurally checked, URL-filtered, escaped, and resource-bounded.

Media resource URLs may be same-origin relative URLs, HTTPS URLs, or `blob:`
URLs. `blob:` is accepted only for video and audio resolved by the trusted host;
it is intended for browser-created, already-authorized media capabilities and
can never be supplied directly by TFM source. App and transcript URLs remain
limited to same-origin relative or HTTPS URLs. Apps are placed in an iframe
with `sandbox="allow-scripts"`; the renderer never grants `allow-same-origin`,
forms, popups, or top-level navigation. Unresolved resources render as styled,
non-interactive placeholders that retain the leaf directive's accessible name.

## Voyd API

The package advertises its Voyd source and Node/browser adapter in
`package.json`. The adapter implements `tessyl:tfm/parser@1` and the synchronous
`tessyl:tfm/renderer@1` interface.

```voyd
use pkg::tfm::{ parse, render_html, render_html_with_resources, ParseResult, RenderResult }

let result = parse(source)
let rendered = render_html(source)
```

Voyd hosts can pass a boundary-safe `Array<RenderResource>` to
`render_html_with_resources`; dataset rows are flattened into `cells` in
row-major order using the `columns` length. The bundle must already be
authorized by the host.

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
::name[Optional accessible name with **inline Markdown**]{key="value"}
```

The bracketed label on a leaf directive provides its accessible name. Inline
formatting is reduced to plain text for ARIA and iframe-title attributes; it is
not rendered as a visible caption.

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

Single-colon inline directives are not part of the current TFM grammar. Directive names,
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

Resource directives render without a surrounding card. `tessyl-card` is the
only directive that opts content into the shared card surface. Asides and
infoboxes use callout styling and do not display their directive kind.

Opaque IDs are checked only for their documented prefix and bounded syntax.
Existence, authorization, storage lookup, and Tessera execution remain host
responsibilities. The renderer accepts authorized resource descriptions but
does not fetch or authorize them itself.

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

Run the package workbench to edit representative TFM and inspect its rendered
output and diagnostics side by side:

```bash
npm run dev -w @tessyl/tfm
```

Then open `http://127.0.0.1:3002`. The example exercises CommonMark/GFM and all
ten directives through the public renderer API.

To visit the workbench from another machine, bind it to a reachable interface
and use that machine's host name or IP address:

```bash
TFM_PLAYGROUND_HOST=0.0.0.0 npm run dev -w @tessyl/tfm
```

`TFM_PLAYGROUND_PORT` changes the default port of `3002`.

The example assets are self-contained. The committed
`playground/fixtures/demo-video.webm.base64` is decoded in the browser into a
typed WebM `Blob`; the short WAV is generated by the Vite fixture plugin; and
`app.html`, `transcript.txt`, and the same-origin preview shell live under
`playground/public/fixtures/`. No example media is fetched from a third party.
