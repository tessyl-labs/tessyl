import assert from "node:assert/strict";
import test from "node:test";
import { validateArtifact } from "./artifact.js";
import { checkTessera, compileTessera, testTessera } from "./compiler.js";
import { renderStaticArtifactHtml } from "../fallback-renderer.js";

const source = `use pkg::tessyl_native::all
use pkg::tessyl_native::semantic_view
use std::number::cast::to_f64
use std::test::assertions::all

obj Model { count: i32 }

enum Msg
  Increment

pub fn app() -> Tessera<Model, Msg>
  tessera({ init, step, view, subscriptions })

fn subscriptions(_model: Model) -> Sub<Msg>
  Sub<Msg>::none()

fn init() -> Model
  Model { count: 0 }

fn step(model: Model, msg: Msg) -> Update<Model, Msg>
  match(msg)
    Msg::Increment:
      next(Model { count: model.count + 1 })

fn view(model: Model) -> View<Msg>
  <Column>
    <Heading level={2}>Counter</Heading>
    <ArticleLink slug="article_slug-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">Article</ArticleLink>
    <Metric label="Count" value={to_f64(model.count)} />
    <Button on_press={Msg::Increment {}}>Increment</Button>
  </Column>

test "significant figures fixture":
  let rounded = round_significant(1234.567, 4)
  assert(rounded > 1234.9 and rounded < 1235.1)

test "vector fixtures":
  let vector = add(Vec2 { x: 2.0, y: 3.0 }, Vec2 { x: 4.0, y: -1.0 })
  assert(vector.x, eq: 6.0)
  assert(vector.y, eq: 2.0)

test "scene groups compose matrix transforms across core primitives":
  let objects = group_objects(scene_group(objects: [
    coordinates(x_label: "x", y_label: "y"),
    circle_mark(center: Vec2 { x: 10.0, y: 10.0 }, radius: 2.0, label: "Scaled circle"),
    rectangle_mark(origin: Vec2 { x: 5.0, y: 5.0 }, width: 4.0, height: 3.0, label: "Rotated rectangle")
  ], transform: Matrix2 { m11: 0.0, m12: -2.0, m21: 1.5, m22: 0.0 }))
  let rendered = semantic_view(Scene(title: "Transformed scene", description: "Grouped transformed geometry", objects: objects))
  assert(rendered.has_scene("Transformed scene"), eq: true)

test "matrix complex and statistics fixtures":
  let matrix = matrix_multiply(Matrix2 { m11: 1.0, m12: 2.0, m21: 3.0, m22: 4.0 }, Matrix2 { m11: 2.0, m12: 0.0, m21: 1.0, m22: 2.0 })
  assert(matrix.m11, eq: 4.0)
  assert(complex_multiply(Complex { real: 1.0, imaginary: 2.0 }, Complex { real: 3.0, imaginary: 4.0 }).real, eq: -5.0)
  let calculated_quantity = quantity_multiply(quantity(value: 2.0, dimension: Dimension { mass: 1, length: 0, time: 0, current: 0, temperature: 0 }), quantity(value: 9.0, dimension: Dimension { mass: 0, length: 2, time: -2, current: 0, temperature: 0 }))
  assert(calculated_quantity.value, eq: 18.0)
  assert(calculated_quantity.dimension().time, eq: -2)
  assert(mean([1.0, 2.0, 3.0]), eq: 2.0)

test "numerical analysis fixtures":
  assert(integrate(function: (value: f64) -> f64 => value, from: 0.0, to: 1.0, steps: 100), eq: 0.5)
  let root = root_bisection(function: (value: f64) -> f64 => value * value - 4.0, lower: 0.0, upper: 3.0, tolerance: 0.000001, iterations: 64)
  assert(root > 1.999 and root < 2.001)
  let evolved = rk4_step(state: ScalarState { time: 0.0, value: 1.0 }, dt: 0.1, derivative: (state: ScalarState) -> f64 => state.value)
  assert(evolved.value > 1.105 and evolved.value < 1.106)

test "random replay fixture":
  let first = random_next(random(42i64))
  let repeated = random_next(random(42i64))
  assert(first.value, eq: repeated.value)

test "mechanics fixture":
  let body = mechanics_step(body: Body2 { position: Vec2 { x: 0.0, y: 0.0 }, velocity: Vec2 { x: 1.0, y: 0.0 }, mass: 1.0 }, acceleration: Vec2 { x: 0.0, y: 1.0 }, dt: 1.0)
  assert(body.position.x, eq: 1.0)
  assert(body.position.y, eq: 1.0)

test "semantic validation accepts a near-limit table":
  let ~rows = Array<TableRow>::with_capacity(749)
  var index = 0
  while index < 749:
    rows.push(TableRow { values: ["left", "right"] })
    index = index + 1
  let rendered = semantic_view(Table(columns: [TableColumn { key: "left", label: "Left" }, TableColumn { key: "right", label: "Right" }], rows: rows, caption: "Near limit"))
  assert(rendered.contains_text("Near limit"), eq: true)

`;

const authorManifest = {
  title: "Counter",
  sdkVersion: 2 as const,
  metadata: { accessibleName: "Deterministic counter", purpose: "Demonstrate reviewed fallback selection", revision: "counter-r1", assumptions: ["Counts are dimensionless"] },
  fallback: { version: 1 as const, interactions: [{ targetLabel: "Increment", event: "click" as const }], essentialContent: ["Count"] },
  inputs: [{ name: "initial_count", type: "number" as const, default: 0, min: 0, max: 100 }],
};

test("compiles a Tessera into a hash-bound artifact", async () => {
  const result = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source } },
    authorManifest,
    profile: "standard-v1",
  });
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics, null, 2));
  if (!result.ok) return;
  const fallbackText = JSON.stringify(result.artifact.fallback);
  assert.match(fallbackText, /Counter|Count|1/);
  assert.doesNotMatch(fallbackText, /Increment/);
  assert(result.artifact.dependencyLock.packages.length >= 7);
  assert(result.artifact.dependencyLock.packages.some((entry) => entry.name === "binaryen"));
  assert(result.artifact.dependencyLock.packages.some((entry) => entry.name === "import-meta-resolve"));
  assert(result.artifact.dependencyLock.packages.every((entry) => /^[a-f0-9]{64}$/.test(entry.contentHash)));
  assert.equal(result.artifact.manifest.compilerVersion, "0.3.1");
  assert.equal(result.artifact.manifest.schemaVersion, 2);
  assert.equal(result.artifact.manifest.sdkVersion, "2");
  assert.equal(result.artifact.manifest.capabilityProfile, "public-v2");
  assert.equal(result.artifact.manifest.vxRuntimeVersion, "0.3.1");
  assert.equal(result.artifact.metadata.revision, "counter-r1");
  assert.equal(result.artifact.resources.inputs[0]?.name, "initial_count");
  assert.match(result.artifact.manifest.metadataHash, /^[a-f0-9]{64}$/);
  const forged = structuredClone(result.artifact);
  forged.metadata.title = "Forged title";
  await assert.rejects(() => renderStaticArtifactHtml(forged), /hash mismatch/);
  const repeated = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source } },
    authorManifest,
    profile: "standard-v1",
  });
  assert.equal(repeated.ok, true);
  if (repeated.ok) {
    assert.deepEqual(repeated.artifact.manifest, result.artifact.manifest);
    assert.deepEqual(repeated.artifact.buildProvenance, result.artifact.buildProvenance);
    assert.deepEqual(repeated.artifact.wasm, result.artifact.wasm);
  }
  const invalidFallbackTarget = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source } },
    authorManifest: { ...authorManifest, fallback: { version: 1, interactions: [{ targetLabel: "Missing control", event: "click" }] } },
    profile: "standard-v1",
  });
  assert.equal(invalidFallbackTarget.ok, false);
  if (!invalidFallbackTarget.ok) {
    assert(invalidFallbackTarget.diagnostics.some((item) => item.code === "author_build_failed"));
    assert(invalidFallbackTarget.diagnostics.some((item) => /Fallback target was not found/.test(item.message)));
  }
  await assert.doesNotReject(() => validateArtifact(result.artifact));
  const invalidInputContract = structuredClone(result.artifact);
  invalidInputContract.resources.inputs = [{ name: "bad_bounds", type: "number", min: 10, max: 1 }];
  await assert.rejects(() => validateArtifact(invalidInputContract), /bounds/);
  const incompleteDataset = structuredClone(result.artifact) as unknown as { resources: { datasets: unknown[] } };
  incompleteDataset.resources.datasets = [{ id: "data", revision: "r1", contentHash: "a".repeat(64), mediaType: "application/json", byteLength: 1 }];
  await assert.rejects(() => validateArtifact(incompleteDataset as never), /citation/);
  const tampered = { ...result.artifact, wasm: result.artifact.wasm.slice() };
  tampered.wasm[tampered.wasm.length - 1] ^= 1;
  await assert.rejects(() => validateArtifact(tampered), /hash mismatch|malformed/);
  const incompatible = structuredClone(result.artifact);
  incompatible.manifest.vxRuntimeVersion = "999.0.0";
  await assert.rejects(() => validateArtifact(incompatible), /unsupported/);
  const malformedSourceBundle = structuredClone(result.artifact);
  malformedSourceBundle.sourceBundle = new TextEncoder().encode('{"entry":"missing.voyd","files":{}}');
  await assert.rejects(() => validateArtifact(malformedSourceBundle), /Source bundle entry/);
  const mismatchedReviewedAsset = structuredClone(result.artifact);
  mismatchedReviewedAsset.resources.assets = [{ id: "figure", revision: "r1", contentHash: "a".repeat(64), mediaType: "image/png", byteLength: 1, accessibleName: "Reviewed figure", license: "CC-BY-4.0" }];
  mismatchedReviewedAsset.fallback = { version: 1, root: { kind: "element", tag: "img", attrs: { "data-native-asset-id": "figure", "aria-label": "Unreviewed label" }, children: [] } };
  await assert.rejects(() => validateArtifact(mismatchedReviewedAsset), /reviewed asset metadata/);
  const interactiveFallback = structuredClone(result.artifact);
  interactiveFallback.fallback = { version: 1, root: { kind: "element", tag: "button", children: [] } };
  await assert.rejects(() => validateArtifact(interactiveFallback), (error: unknown) => {
    assert.equal((error as { code?: string }).code, "invalid_artifact");
    assert.equal((error as { phase?: string }).phase, "initialize");
    return true;
  });
  const accessorFallback = structuredClone(result.artifact);
  Object.defineProperty(accessorFallback.fallback, "root", {
    enumerable: true,
    get: () => ({ kind: "element", tag: "script", children: [] }),
  });
  await assert.rejects(() => validateArtifact(accessorFallback), (error: unknown) => {
    assert.match(String((error as { cause?: unknown }).cause), /accessor propert/);
    return true;
  });
  const accessorMetadata = structuredClone(result.artifact);
  let metadataAccessorRead = false;
  Object.defineProperty(accessorMetadata.metadata.assumptions!, "0", {
    enumerable: true,
    get() { metadataAccessorRead = true; return "Untrusted assumption"; },
  });
  await assert.rejects(() => validateArtifact(accessorMetadata), /accessor propert/);
  assert.equal(metadataAccessorRead, false);
  if (typeof SharedArrayBuffer !== "undefined") {
    const shared = new Uint8Array(new SharedArrayBuffer(result.artifact.wasm.byteLength));
    shared.set(result.artifact.wasm);
    await assert.rejects(() => validateArtifact({ ...result.artifact, wasm: shared }), /shared memory/);
  }
});

test("rejects ambient VX capabilities exposed by the upstream type", async () => {
  const result = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source.replace("Cmd", "Cmd") + "\nfn forbidden() -> Cmd<Msg>\n  Cmd<Msg>::copy_to_clipboard(\"secret\")" } },
    authorManifest: { title: "Forbidden capability", sdkVersion: 2 },
    profile: "standard-v1",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.diagnostics.some((item) => item.code === "forbidden_capability"));
  const aliased = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source.concat("\ntype UnsafeSub<Msg> = Sub<Msg>\n") } },
    authorManifest: { title: "Aliased capability", sdkVersion: 2 },
    profile: "standard-v1",
  });
  assert.equal(aliased.ok, false);
  if (!aliased.ok) assert(aliased.diagnostics.some((item) => item.code === "forbidden_api"));
  const qualifiedAlias = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source.concat("\ntype UnsafeSub<Msg> = tessyl_native::Sub<Msg>\n") } },
    authorManifest: { title: "Qualified aliased capability", sdkVersion: 2 },
    profile: "standard-v1",
  });
  assert.equal(qualifiedAlias.ok, false);
  if (!qualifiedAlias.ok) assert(qualifiedAlias.diagnostics.some((item) => item.code === "forbidden_api"));
  const spacedVx = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": "use std :: vx::all\npub fn app() -> i32\n  1" } },
    authorManifest: { title: "Spaced raw VX import", sdkVersion: 2 },
    profile: "standard-v1",
  });
  assert.equal(spacedVx.ok, false);
  if (!spacedVx.ok) assert(spacedVx.diagnostics.some((item) => item.code === "forbidden_api"));
  for (const groupedSource of ["use std::{ vx }\npub fn app() -> i32\n  1", "use pkg::{ web }\npub fn app() -> i32\n  1"]) {
    const grouped = await compileTessera({
      source: { entry: "main.voyd", files: { "main.voyd": groupedSource } },
      authorManifest: { title: "Grouped import", sdkVersion: 2 },
      profile: "standard-v1",
    });
    assert.equal(grouped.ok, false);
    if (!grouped.ok) assert(grouped.diagnostics.some((item) => item.code === "forbidden_api"));
  }
  const spacedCapability = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source.replace("Sub<Msg>::none()", "Sub<Msg> :: runtime(kind: \"ambient\", key: \"ambient\")") } },
    authorManifest: { title: "Spaced capability call", sdkVersion: 2 },
    profile: "standard-v1",
  });
  assert.equal(spacedCapability.ok, false);
  if (!spacedCapability.ok) assert(spacedCapability.diagnostics.some((item) => item.code === "forbidden_capability"));
});

test("snapshots build input before asynchronous compiler admission", async () => {
  const input = {
    source: { entry: "main.voyd", files: { "main.voyd": source } },
    authorManifest: { title: "Original title", sdkVersion: 2 as const },
    profile: "standard-v1" as const,
  };
  const compilation = compileTessera(input);
  input.source.files["main.voyd"] = "pub fn app() -> i32\n  42";
  input.authorManifest.title = "Mutated title";
  const result = await compilation;
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.artifact.metadata.title, "Original title");
    const bundle = JSON.parse(new TextDecoder().decode(result.artifact.sourceBundle)) as { files: Record<string, string> };
    assert.equal(bundle.files["main.voyd"], source);
  }
});

test("rejects forbidden dependencies before invoking Voyd", async () => {
  const result = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": "use pkg::web::all\npub fn app() -> i32\n  1" } },
    authorManifest: { title: "Forbidden", sdkVersion: 2 },
    profile: "standard-v1",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.diagnostics.some((item) => item.code === "forbidden_package"));
  const spaced = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": "use pkg :: web::all\npub fn app() -> i32\n  1" } },
    authorManifest: { title: "Spaced forbidden", sdkVersion: 2 },
    profile: "standard-v1",
  });
  assert.equal(spaced.ok, false);
  if (!spaced.ok) assert(spaced.diagnostics.some((item) => item.code === "forbidden_package"));
});

test("bounds source file metadata before policy scanning", async () => {
  const files = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`file-${index}.voyd`, ""]));
  const result = await compileTessera({ source: { entry: "file-0.voyd", files }, authorManifest: { title: "Too many", sdkVersion: 2 }, profile: "standard-v1" });
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.diagnostics.some((item) => item.code === "resource_limit"));
});

test("rejects accessor and oversized inputs before cloning", async () => {
  let accessed = false;
  const accessorInput = {
    source: { entry: "main.voyd", files: { "main.voyd": source } },
    authorManifest: { title: "Accessor", sdkVersion: 2 },
    profile: "standard-v1",
  } as Record<string, unknown>;
  Object.defineProperty(accessorInput, "surprise", { enumerable: true, get() { accessed = true; return "unbounded"; } });
  const accessorResult = await compileTessera(accessorInput as never);
  assert.equal(accessorResult.ok, false);
  assert.equal(accessed, false);

  let nestedAccessed = false;
  const inputs = [{ name: "count", type: "number", default: 1 }];
  Object.defineProperty(inputs, "named", { enumerable: true, get() { nestedAccessed = true; return "unbounded"; } });
  const nestedResult = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source } },
    authorManifest: { title: "Nested accessor", sdkVersion: 2, inputs } as never,
    profile: "standard-v1",
  });
  assert.equal(nestedResult.ok, false);
  assert.equal(nestedAccessed, false);

  const oversizedResult = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": "x".repeat(512 * 1024 + 1) } },
    authorManifest: { title: "Oversized", sdkVersion: 2 },
    profile: "standard-v1",
  });
  assert.equal(oversizedResult.ok, false);
  if (!oversizedResult.ok) assert(oversizedResult.diagnostics.some((item) => item.code === "resource_limit"));
});

test("rejects resource contracts that runtime admission would reject", async () => {
  const oversizedDefault = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source } },
    authorManifest: { title: "Invalid default", sdkVersion: 2, inputs: [{ name: "label", type: "string", maxLength: 2, default: "long" }] },
    profile: "standard-v1",
  });
  assert.equal(oversizedDefault.ok, false);
  const duplicateResourceId = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source } },
    authorManifest: {
      title: "Duplicate resources", sdkVersion: 2,
      datasets: [{ id: "shared", revision: "r1", contentHash: "a".repeat(64), mediaType: "application/json", byteLength: 1, citation: "fixture" }],
      assets: [{ id: "shared", revision: "r1", contentHash: "b".repeat(64), mediaType: "image/png", byteLength: 1, accessibleName: "fixture", license: "CC0" }],
    },
    profile: "standard-v1",
  });
  assert.equal(duplicateResourceId.ok, false);
  const oversizedDataset = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source } },
    authorManifest: { title: "Oversized dataset", sdkVersion: 2, datasets: [{ id: "large", revision: "r1", contentHash: "a".repeat(64), mediaType: "application/json", byteLength: 240 * 1024 + 1, citation: "fixture" }] },
    profile: "standard-v1",
  });
  assert.equal(oversizedDataset.ok, false);
});

test("policy scanning ignores forbidden-looking text in strings and comments", async () => {
  const harmless = source
    .replace("<Metric label=\"Count\" value={to_f64(model.count)} />", "<Code value=\"<div> use std::vx\" />")
    .concat("\n// use pkg::web::all and Cmd::fetch are documentation, not code\n");
  const result = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": harmless } },
    authorManifest: { title: "Harmless code sample", sdkVersion: 2 },
    profile: "standard-v1",
  });
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics));
});

test("check and test are distinct author workflows", async () => {
  const failingTestSource = source.concat(`
test "intentional review failure":
  assert(false)
`);
  const input = { source: { entry: "main.voyd", files: { "main.voyd": failingTestSource } }, authorManifest, profile: "standard-v1" as const };
  assert.deepEqual(await checkTessera(input), []);
  assert((await testTessera(input)).some((item) => item.code === "author_test_failed"));
});
