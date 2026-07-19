# Tessera Author SDK

This is the primary guide for developers who author Tesserae. It defines the
implemented v2 Voyd API exposed as `pkg::tessyl_native`.
Authors do not install `@tessyl/native` or call its TypeScript integration API.

## Mental model

A Tessera is a typed state machine:

```text
init -> Model
Model -> view -> View<Msg>
Model + Msg -> step -> next Model and optional commands
subscriptions -> Msg
```

Tessyl Native builds this contract on VX while deliberately exposing a smaller
UI and capability surface. A developer owns application state and domain logic.
The framework owns rendering, accessibility defaults, browser integration,
resource enforcement, and failure recovery.

## Hello world

```voyd
use pkg::tessyl_native::all

obj Model {
  mass: f64
}

enum Msg
  MassChanged { value: f64 }

pub fn app() -> Tessera<Model, Msg>
  tessera({ init, step, view, subscriptions })

fn subscriptions(_model: Model) -> Sub<Msg>
  Sub<Msg>::none()

fn init() -> Model
  Model { mass: 1.0 }

fn step(model: Model, msg: Msg) -> Update<Model, Msg>
  next(update(model, msg))

fn update(model: Model, msg: Msg) -> Model
  match(msg)
    Msg::MassChanged { value }:
      Model { mass: value }

fn view(model: Model) -> View<Msg>
  <Column gap={Space::Medium}>
    <Heading level={2}>Mass–energy equivalence</Heading>
    <NumberField
      label="Mass"
      unit="kg"
      value={model.mass}
      min={0}
      on_change={(value) => Msg::MassChanged { value }}
    />
    <Metric
      label="Energy"
      value={model.mass * 299792458.0 * 299792458.0}
      unit="J"
    />
  </Column>
```

The required export is `app()`. Host values do not enter that function as
ambient arguments. A Tessera revision declares typed inputs, pinned datasets,
and reviewed assets in `tessera.json`, then receives them only through the
bounded subscriptions described below.

## Core API

```voyd
Tessera<Model, Msg>
Update<Model, Msg>
View<Msg>
Child<Msg> = View<Msg> | String
Cmd<Msg>
Sub<Msg>

tessera({ init, step, view, subscriptions }) -> Tessera<Model, Msg>
next(model) -> Update<Model, Msg>
next(model:, cmd:) -> Update<Model, Msg>
```

`Tessera` is the application descriptor; `Update` is the result of one state
transition. Both adapt to VX `Program` internally, but keeping them distinct
makes the author contract explicit. The wrappers let Tessyl evolve a constrained
surface without creating a second state model. Models, messages, and command
payloads must use values supported by the Voyd host boundary; functions, DOM
nodes, host objects, and recursive object graphs are not application state.

### State and messages

Keep durable application state in `Model`. Use messages to describe what
happened rather than which mutation to perform. Keep calculations pure when
possible, validate numeric domains explicitly, and represent expected failure
as state that the view can explain.

### Commands

Commands request one bounded action. The initial Author SDK exposes named,
typed constructors rather than generic string-based runtime commands:

```voyd
Cmd::delay(milliseconds: 250, message: Msg::Advanced {})
```

Unsupported commands fail the current interaction and produce a recoverable
runtime error. The application cannot register its own host command or request
navigation programmatically. Use `ArticleLink` for reader-initiated navigation.

### Subscriptions

Subscriptions describe ongoing inputs and are synchronized after each step:

```voyd
fn subscriptions(model: Model) -> Sub<Msg>
  if model.running:
    sub_animation_frame<Msg>((frame) => Msg::Frame { elapsed: frame.elapsed_ms })
  else:
    Sub::none()
```

Subscriptions include animation frames, fixed timesteps, reduced-motion and
container-size changes, typed declared inputs, pinned dataset text, and initial
shareable state. The runtime rate-limits, pauses, and disposes them as required.
Animation logic must use elapsed time rather than assuming a fixed frame rate;
simulation logic must advance only by `SimulationFrame.steps * step_ms`.

## API reference

Application source imports `pkg::tessyl_native`, not `std::vx` directly. Native
components return `View<Msg>` and encode only the supported render protocol.
Optional properties use `?`. `Child<Msg>` is either a `View<Msg>` or a `String`,
so literal and computed text can appear directly in `children`.

### Shared values

```voyd
enum Width
  Fit
  Fill
  Content
  Visualization
  Fixed { pixels: f64 }

enum Align
  Start
  Center
  End
  Stretch

enum Space
  None
  ExtraSmall
  Small
  Medium
  Large
  ExtraLarge

enum Tone
  Neutral
  Accent
  Informative
  Positive
  Caution
  Critical

enum TextSize
  Small
  Medium
  Large

enum TextWeight
  Regular
  Medium
  Strong

obj LegendItem {
  label: String,
  tone: Tone
}

obj AnimationFrame {
  elapsed_ms: f64,
  delta_ms: f64,
  reduced_motion: bool
}

obj ContainerSize {
  width: f64,
  height: f64
}

obj SelectOption {
  value: String,
  label: String
}

obj TableColumn {
  key: String,
  label: String
}

obj TableRow {
  values: Array<String>
}
```

Fixed dimensions are clamped by the renderer profile and never control the
outer article frame.

## STEM additions

The complete TES-7 API is specified in the
[STEM platform contract](./stem-platform.md). In summary:

- `Scene`, `InteractiveScene`, `ParticleField`, `VectorField`, and `Heatmap`
  provide bounded semantic SVG or Canvas 2D visualization without raw VX.
- `ScenePrimitive` covers coordinates, points, lines, arrows, circles,
  rectangles, paths, and labels. `SceneObject` supplies a layer and matrix
  transform; every meaningful mark requires a semantic label.
- `PointerGesture`, `FocusGesture`, and `KeyboardGesture` normalize pointer,
  drag, hover, wheel, focus, and keyboard interaction without exposing browser
  event objects.
- `sub_fixed_timestep`, `sub_reduced_motion`, and `SimulationFrame` provide
  deterministic bounded simulation with a non-animated path.
- `Vec2`, `Matrix2`, `Complex`, `Quantity`, numerical integration, bisection,
  RK4, deterministic random state, mechanics, and orbital helpers are pure.
- `sub_input_number`, `sub_input_string`, and `sub_input_boolean` expose only
  host values declared by the artifact input schema.
- `sub_dataset_text` exposes verified UTF-8 pinned dataset content;
  `sub_shareable_state` receives bounded deep-link state and
  `Cmd::share_state` publishes a replacement to the trusted host adapter.
- `ReviewedImage` references only a declared, hash-verified asset ID and always
  requires an accessible name. Authors never receive asset bytes or URLs.
- `DynamicResult` creates a local polite announcement. `Equation` is rendered
  as a safe MathML token tree with an accessible math name.

All titles, descriptions, labels, units, and error states must be meaningful
and non-empty. A visual interaction must also expose a description/data view
and a keyboard path. Reduced-motion mode must remain understandable without
continuous animation.

### Layout and content

```text
Column(children: Array<Child<Msg>>, gap?: Space, align?: Align,
       width?: Width) -> View<Msg>
Row(children: Array<Child<Msg>>, gap?: Space, align?: Align,
    wrap?: bool, width?: Width) -> View<Msg>
Grid(children: Array<Child<Msg>>, columns?: i32, gap?: Space) -> View<Msg>
Panel(children: Array<Child<Msg>>, tone?: Tone,
      padding?: Space) -> View<Msg>
Divider() -> View<Msg>
Spacer(size: Space) -> View<Msg>

Text(children: Array<Child<Msg>>, tone?: Tone, size?: TextSize,
     weight?: TextWeight) -> View<Msg>
Heading(level: i32, children: Array<Child<Msg>>) -> View<Msg>   level: 2–6
Callout(tone: Tone, title?: String,
        children: Array<Child<Msg>>) -> View<Msg>
Code(value: String, language?: String) -> View<Msg>
Equation(source: String, display?: bool) -> View<Msg>
Metric(label: String, value: f64, unit?: String, description?: String,
       precision?: i32) -> View<Msg>
Legend(items: Array<LegendItem>) -> View<Msg>
Table(columns: Array<TableColumn>, rows: Array<TableRow>,
      caption: String) -> View<Msg>
ArticleLink(slug: String, children: Array<Child<Msg>>) -> View<Msg>
```

`Code` displays text and does not execute it. `Equation` accepts the native
math notation supported by the renderer, not HTML or extension commands.
Defaults are `Space::Medium` for gaps/padding, `Align::Stretch`, `Width::Fill`,
`wrap: false`, `Tone::Neutral`, `TextSize::Medium`, `TextWeight::Regular`, and
`display: false`. Grid columns are 1–12 and default to 1. `Metric` requires a
finite value; precision is bounded and otherwise uses native number formatting.
Table rows must have exactly one value per column. `ArticleLink` accepts only a
canonical Tessyl article slug: 1–80 lowercase ASCII letters or digits, with
single `-` or `_` separators between non-empty segments. Trusted rendering
handles its direct activation.

### Inputs

```text
Button(on_press: Msg, children: Array<Child<Msg>>, disabled?: bool,
       tone?: Tone) -> View<Msg>
Slider(label: String, value: f64, min: f64, max: f64,
       on_change: f64 -> Msg, step?: f64, disabled?: bool,
       unit?: String) -> View<Msg>
NumberField(label: String, value: f64, on_change: f64 -> Msg, min?: f64,
            max?: f64, step?: f64, disabled?: bool,
            unit?: String) -> View<Msg>
TextField(label: String, value: String, on_change: String -> Msg,
          disabled?: bool, placeholder?: String,
          max_length?: i32) -> View<Msg>
Select(label: String, value: String, options: Array<SelectOption>,
       on_change: String -> Msg, disabled?: bool) -> View<Msg>
Toggle(label: String, checked: bool, on_change: bool -> Msg,
       disabled?: bool) -> View<Msg>
```

Event payloads are `f64` for `Slider` and valid `NumberField` changes, `String`
for `TextField` and selected option values, `bool` for `Toggle`, and the supplied
`Msg` for `Button`. `NumberField` owns its transient empty/invalid edit buffer,
shows native validation, and emits only finite values in the declared range.
Authors represent domain-level invalidity in their model.

Inputs default to `disabled: false` and `Tone::Neutral`. Slider bounds must be
finite and increasing; its default step is one hundredth of the range. Optional
number-field bounds must be increasing, and any explicit step must be positive.
Text length defaults to the profile maximum. Select options are non-empty, have
unique values, and contain the current value. Invalid constructor properties
fail frame validation rather than being silently coerced.

### Charts and graphics

```voyd
obj Point {
  x: f64,
  y: f64
}

obj Series {
  name: String,
  points: Array<Point>
}

obj CategorySeries {
  name: String,
  values: Array<f64>
}

obj Axis {
  label: String,
  unit?: String,
  min?: f64,
  max?: f64
}

enum Annotation
  Vertical { x: f64, label: String }
  Horizontal { y: f64, label: String }
  PointLabel { point: Point, label: String }
```

```text
LineChart(title: String, description: String, series: Array<Series>,
          x_axis: Axis, y_axis: Axis,
          annotations?: Array<Annotation>) -> View<Msg>
ScatterPlot(title: String, description: String, series: Array<Series>,
            x_axis: Axis, y_axis: Axis,
            annotations?: Array<Annotation>) -> View<Msg>
BarChart(title: String, description: String, categories: Array<String>,
         series: Array<CategorySeries>, y_axis: Axis) -> View<Msg>
Histogram(title: String, description: String, values: Array<f64>,
          x_axis: Axis, bins?: i32) -> View<Msg>
```

Axis `min` and `max` must either both be absent or define an increasing domain.
Data contains only finite numbers. Bar-series lengths must match the category
count. Series names are required when more than one series is shown. The
resource profile bounds series, points, categories, bins, labels, and
annotations. Native components select accessible SVG output; arbitrary SVG,
canvas, URLs, and filters are unavailable.

`title` is the chart's accessible name. The required, length-bounded
`description` explains its purpose, key relationship, and takeaway rather than
repeating the title. The renderer also supplies a native “View chart data”
disclosure containing a profile-limited accessible table of the plotted points,
categories, or computed histogram bins. It is available to keyboard and
screen-reader users and does not rely on SVG traversal.

### Capabilities

```text
Cmd::none() -> Cmd<Msg>
Cmd::batch(commands: Array<Cmd<Msg>>) -> Cmd<Msg>
Cmd::delay(milliseconds: f64, message: Msg) -> Cmd<Msg>
Cmd::share_state(state: String) -> Cmd<Msg>

Sub::none() -> Sub<Msg>
Sub::batch(subscriptions: Array<Sub<Msg>>) -> Sub<Msg>
sub_animation_frame<Msg>(handler: AnimationFrame -> Msg) -> Sub<Msg>
sub_fixed_timestep<Msg>(hz: i32, handler: SimulationFrame -> Msg) -> Sub<Msg>
sub_reduced_motion<Msg>(handler: bool -> Msg) -> Sub<Msg>
sub_container_size<Msg>(handler: ContainerSize -> Msg) -> Sub<Msg>
sub_input_number<Msg>(name: String, on_value: fn(f64) -> Msg) -> Sub<Msg>
sub_input_string<Msg>(name: String, on_value: fn(String) -> Msg) -> Sub<Msg>
sub_input_boolean<Msg>(name: String, on_value: fn(bool) -> Msg) -> Sub<Msg>
sub_dataset_text<Msg>(id: String, on_value: fn(String) -> Msg) -> Sub<Msg>
sub_shareable_state<Msg>(handler: fn(String) -> Msg) -> Sub<Msg>
```

`delay` requires a finite non-negative duration and is capped by the resource
profile. Missing, malformed, or disallowed capabilities fail the interaction
through the standard runtime error path. Dataset and input subscriptions can
only resolve declarations content-locked into the artifact.

## Styling and layout

Tesserae use tokens instead of CSS strings:

```voyd
Space::Small
Space::Medium
Align::Center
Width::Fill
content_width()
visualization_width()
Tone::Accent
TextSize::Large
```

The native renderer translates tokens into versioned Tessyl styles. There are
no arbitrary classes, inline styles, global selectors, external fonts, or
resource URLs. Components respond to their container rather than the browser
window. `content_width()` selects the bounded reading width, while
`visualization_width()` selects the narrower chart and simulation width. These
choices belong in the Voyd view rather than the host page or renderer defaults.

Particle appearance is declarative as well. Each `Particle` can select a
bounded `ParticleTone`, `opacity`, and `glow`; the exported
`*_particle_tone()` constructors provide its safe palette. `ParticleField` selects its tone and
whether its caption and detailed data remain visually exposed. The trusted
Canvas renderer only interprets these values—it does not choose per-Tessera
colors, emphasis, or visibility.

## Accessibility requirements

- All controls are keyboard operable and visibly focused.
- Inputs, outputs, axes, units, and validation errors are labelled.
- Dynamic results use live announcements only when an update requires notice.
- Motion respects the reader's reduced-motion preference and has a pause path.
- Color is not the sole carrier of meaning.
- Focus order follows reading order; a Tessera does not trap focus.
- Pointer-target and contrast requirements come from native components.

The Author SDK should make the accessible path the easiest path, but authors remain
responsible for meaningful labels and explanations.

## Resource model

Tesserae run under an immutable, versioned resource profile. Its exact limits
are shared by check, preview, build, and production runtime. Limits never change
in place; an incompatible change creates a new profile version. Profiles bound:

- Wasm and boundary-payload bytes.
- Interaction duration.
- Render-frame bytes, nodes, depth, and text length.
- Chart points and table cells.
- Pending events and active subscriptions.
- Animation rate and concurrent active Tesserae.

Do not perform large work eagerly in `view`. Precompute reusable values in
`init` or `step`, keep render trees compact, and reduce plotted data to the
resolution a reader can perceive. Exceeding a limit produces a bounded error;
it never grants a larger capability automatically.

## Failure and recovery

Expected domain errors belong in the model and view. Unexpected traps,
protocol violations, timeouts, and unavailable capabilities are handled by the
standard Tessyl frame. A reader may restart the Tessera from its initial state.
Application state is ephemeral in the initial release.

The standard Tessyl shell owns whole-application Reset. Reset terminates the
current Worker generation and starts a fresh one, rerunning `init`. Authors add
an in-view reset control only when a domain workflow needs a distinct partial
reset whose meaning should be explained inside the Tessera.

Every published Tessera includes a useful static fallback. Preview captures a
candidate from the default state as a restricted, non-interactive native frame.
Publication projects controls into non-focusable labelled value readouts,
removes buttons and links, validates the static schema and limits, binds it to
the revision, and requires reviewer approval. A fallback contains no input,
button, link, or other focusable element. Raw HTML, URLs, scripts, and styles
are never accepted as fallback input.

For charts, fallback projection keeps the title and description and renders the
bounded chart-data table permanently expanded, without a disclosure button or
other focusable control.

## Development workflow

### Project layout

The canonical standalone layout is:

```text
mass-energy/
  tessera.json
  src/
    main.voyd
    model.voyd
    view.voyd
  tests/
    model.test.voyd
```

`tessera.json` is author metadata, not the published runtime manifest:

```json
{
  "title": "Mass–energy equivalence",
  "entry": "src/main.voyd",
  "sdkVersion": 2
}
```

The entry file must export `app()`. The build root exposes local modules under
`src`; dependencies resolve only through the native package policy. Tests are
Voyd `test` declarations in `*.test.voyd` files under `src` or `tests` and are
excluded from the published Wasm. The author-facing `sdkVersion` selects an API
major; the server build resolves and locks the exact SDK and dependency content.

Keep the reducer and domain calculations pure and export them from an app module
for tests. The native testing package renders `View` into a semantic tree rather
than browser DOM, so tests assert reader-visible meaning instead of private
markup:

```voyd
use src::model::{ Model, Msg, update }
use src::view::view
use pkg::tessyl_native::semantic_view
use std::test::assertions::all

test "mass changes update the result":
  let model = update(Model { mass: 1.0 }, Msg::MassChanged { value: 2.0 })
  assert(model.mass, eq: 2.0)

  let rendered = semantic_view(view(model))
  assert(rendered.has_metric(label: "Energy", unit: "J"), eq: true)
```

`semantic_view` validates the native frame and exposes bounded queries by role,
label, text, value, and chart metadata. Browser preview and accessibility tests
cover behavior that requires focus, layout, or events.

### CLI commands

The planned tooling should support:

```text
tessyl native check [project]
tessyl native preview [project]
tessyl native test [project]
tessyl native build [project]
```

`project` defaults to the current directory and reads its `tessera.json` entry.

- `check` compiles with the native package/module policy and reports unsupported
  APIs or boundary types.
- `preview` runs the production protocol, validator, capability host, and
  resource profile locally.
- `test` runs Voyd tests plus framework accessibility and hostile-limit checks.
- `build` produces a reviewable source bundle, manifest, Wasm artifact, and
  native-frame fallback candidate. Native tooling stops at this portable
  artifact; Tessyl owns submission, validation, approval, and publication.

Preview must use the same restricted host as production. Development mode may
show richer diagnostics but must not silently enable capabilities.

The Tessyl article editor is the v2 submission and publication path. It can edit a
Tessera directly or import the local bundle produced by `build`. The CLI never
publishes or assigns a revision; submitting in the editor uploads source and
author metadata to Tessyl's build and review pipeline. Tessyl approval creates
the immutable revision that an article can pin.

## Publishing checklist

- The title, caption, instructions, inputs, outputs, units, and assumptions are
  clear.
- Domain errors and boundary values are tested.
- Keyboard and narrow-layout behavior has been checked.
- Motion can be paused and respects reduced-motion preferences.
- Charts remain understandable without color alone.
- Every chart has a useful description and an understandable data-table view.
- The fallback is useful and matches the default state.
- Source and data provenance are complete.
- The Tessera stays within the standard resource profile.

Tessyl publication creates an immutable revision around the Native artifact. An
article pins that revision and must explicitly adopt future revisions.

## Deliberately unavailable APIs

The initial Author SDK does not expose raw HTML/VX, JavaScript interop, DOM nodes,
network fetch, local or session storage, clipboard reads, arbitrary navigation,
global listeners, cross-Tessera messaging, dynamic code loading, or general
filesystem access. A future capability must have a typed SDK API, protocol
schema, host policy, resource limits, audit trail, and failure behavior before
it is added.
