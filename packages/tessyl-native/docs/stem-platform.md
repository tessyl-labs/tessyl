# STEM platform contract

TES-7 introduces the versioned `public-v2` capability and artifact schema for a complete, bounded
STEM authoring surface. The security boundary is unchanged: author code cannot
use raw VX, DOM, CSS, JavaScript, browser globals, network, storage, or external
effects. Native validates the same frame, resource, and artifact contracts in
build, preview, fallback, and browser execution.

Artifact and capability compatibility moved to v2. The frame and RPC fields
remain protocol v1 because they are stable transport envelopes; the admitted
node, event, command, and subscription surface is selected by the versioned
capability profile and validated at both ends.

## Standard shell and host actions

Every initialized Tessera is placed in a Native-owned region whose accessible
name comes from artifact metadata. Native presents loading, initialized, starting,
running, paused, failed, unsupported, and disposed states. Reset starts again
from `init`; Restart is the recoverable failure action. Expanded view is a real
keyboard-dismissable overlay, not a height hint.

The shell owns caption, instructions, assumptions, limitations, revision, and
accessibility information. Trusted hosts can provide these observational
adapters through `TessylNativeConfig.runtime`:

- `onArticleLink(slug)` for reader-activated Native article links;
- `onInspectSource(files, metadata)` for the Source entry point;
- `onInspectProvenance(artifact)` for revision/provenance inspection;
- `onExpandedViewChange(expanded)` for host URL or focus coordination;
- `onShareableStateChange(state)` for the host deep-link adapter.

Callbacks cannot change artifact identity, capabilities, resource limits, or
runtime state. A callback failure is isolated from the Tessera.

## Reviewed fallbacks

`TesseraAuthorManifest.fallback` can contain a deterministic sequence of
label-targeted `click`, `input`, and `change` interactions. The restricted build
runtime executes those interactions against real typed handlers, projects that
exact resulting frame, and hash-binds it into the artifact. `essentialContent`
produces reviewer warnings if projection removes an explanation the author has
marked essential.

`preview()` returns the exact projected fallback HTML. Use the exported
`renderStaticArtifact` or `renderStaticArtifactHtml` for articles, exports,
search previews, and no-script pages so revision metadata and provenance remain
attached. `renderStaticFallback`, `renderStaticFallbackHtml`, and
`staticFallbackStyles` remain available when only the reviewed frame is needed.
The playground injects compiled artifact fallbacks at build time; it does not
maintain hand-authored substitutes.

## Visualization backends

Native admits two bounded backends in this profile:

1. Retained semantic SVG for diagrams, coordinate systems, points, lines,
   arrows, shapes, paths, labels, transforms, layers, vector fields, heatmaps,
   uncertainty views, and chart composition. Every meaningful mark has a label
   and every visualization has an adjacent semantic data/description view.
2. A Canvas 2D particle field. A frame contains one retained canvas plus a
   bounded numeric particle buffer, rather than one DOM node per particle.
   Native owns drawing, validation, colors, and input normalization.

OffscreenCanvas is not admitted yet because its benefit does not justify a
second worker/resource lifecycle in the standard profile. WebGL and WebGPU are
also not admitted: shader compilation, device loss, texture allocation, and
driver-specific limits need a separate versioned backend profile. Authors
cannot request a context or supply shader source. Future backends must preserve
the same retained scene, semantic data view, deterministic cleanup, and
least-authority contract.

Pointer down/move/up, hover entry/exit, and wheel events are normalized to a
bounded `PointerGesture`; focus/blur use `FocusGesture`; and keyboard events use
`KeyboardGesture`. The
renderer clamps local pointer coordinates and strips ambient event objects.

## Deterministic simulation and computation

`sub_fixed_timestep` accepts 1–120 Hz. Native accumulates real time, caps work
at eight simulation steps per display frame, supplies interpolation alpha, and
drops excess wall-clock backlog instead of allowing a spiral of death. Fixed
step messages are not coalesced, so delivered step counts are not overwritten.
Under reduced motion it emits one non-animated state
with `steps = 0`; authors provide Step controls or an equivalent static path.
`sub_reduced_motion` exposes the preference directly.

The pure Voyd foundation includes dimensions and quantities, versioned physical
constants, significant figures, vectors, matrices, complex numbers, coordinate
transforms, mean/variance, interpolation, trapezoidal integration, bisection
root finding, RK4 scalar ODE integration, deterministic PRNG state, mechanics,
and orbital acceleration. These functions have no host imports and are locked
with `pkg::tessyl_native` in artifact dependency provenance.

## Inputs, data, assets, and state

Input definitions are content-locked in `artifact.resources`. Hosts supply only
declared values, which Native validates by type, bounds, and byte length before
starting a worker. Authors receive them through typed `sub_input_number`,
`sub_input_string`, or `sub_input_boolean` capabilities.

Dataset and asset references require canonical IDs, revisions, SHA-256 content
hashes, media types, attribution, and bounded byte lengths. Trusted hosts pass
dataset bytes by canonical ID; Native snapshots and verifies their exact hash,
length, UTF-8 encoding, and JSON syntax before worker startup. Authors receive
the bounded read-only text through `sub_dataset_text`, without a URL, fetch
API, or mutable handle. `sub_shareable_state` delivers the validated initial
deep-link state and `Cmd::share_state` publishes updates. Shareable state is
bounded to 8 KiB; persistent or collaborative storage remains outside the
profile.

## Resource diagnostics

The standard profile caps general render data at 4,096 plotted primitives and
1,500 table cells; accessible chart components accept up to 500 total points.
Retained scenes accept 128 author objects (up to 512 rendered primitives), and
particle fields accept 512 particles. It also caps animation at 120 updates per
second, simulation catch-up at eight steps per display frame, canvases at two
million pixels, pinned datasets at 240 KiB, and reviewed assets at 8 MiB.
Constructors reject oversized collections before building a large tree;
protocol validation enforces the limits again. Runtime telemetry
contains only revision-safe context, resource bucket, capability source, and
restart/failure category—never model state or reader input.

## Author workflows and examples

The facade provides distinct `check`, `preview`, `test`, and `build` phases.
Check performs policy/type compilation without tests or runtime artifact work;
test compiles and runs Voyd fixtures; build composes tests, fallback execution,
and artifact construction. The
playground examples cover an advanced calculator with accessible math and
local result announcements, data visualization and heatmap, particle physics,
fixed-timestep orbital motion, and a pointer/wheel/keyboard mathematical
diagram.

The semantic scene/data representation is also the future sonification input:
a trusted host may derive audio from labelled bounded marks after explicit
reader activation. Native v2 intentionally exposes no ambient audio device or
automatic sound capability to author code.
