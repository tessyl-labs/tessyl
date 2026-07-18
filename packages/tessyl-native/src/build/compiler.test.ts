import assert from "node:assert/strict";
import test from "node:test";
import { validateArtifact } from "./artifact.js";
import { compileTessera } from "./compiler.js";

const source = `use pkg::tessyl_native::all
use std::number::cast::to_f64

obj Model { count: i32 }

enum Msg
  Increment

pub fn app() -> Tessera<Model, Msg>
  tessera({ init, step, view })

fn init() -> Model
  Model { count: 0 }

fn step(model: Model, msg: Msg) -> Update<Model, Msg>
  match(msg)
    Msg::Increment:
      next(Model { count: model.count + 1 })

fn view(model: Model) -> View<Msg>
  <Column>
    <Heading level={2}>Counter</Heading>
    <Metric label="Count" value={to_f64(model.count)} />
    <Button on_press={Msg::Increment {}}>Increment</Button>
  </Column>
`;

test("compiles a Tessera into a hash-bound artifact", async () => {
  const result = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source } },
    authorManifest: { title: "Counter", sdkVersion: 1 },
    profile: "standard-v1",
  });
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics, null, 2));
  if (!result.ok) return;
  const fallbackText = JSON.stringify(result.artifact.fallback);
  assert.match(fallbackText, /Counter|Count|0/);
  assert.doesNotMatch(fallbackText, /Increment/);
  assert(result.artifact.dependencyLock.packages.length >= 7);
  assert(result.artifact.dependencyLock.packages.some((entry) => entry.name === "binaryen"));
  assert(result.artifact.dependencyLock.packages.some((entry) => entry.name === "import-meta-resolve"));
  assert(result.artifact.dependencyLock.packages.every((entry) => /^[a-f0-9]{64}$/.test(entry.contentHash)));
  assert.equal(result.artifact.manifest.compilerVersion, "0.3.1");
  assert.equal(result.artifact.manifest.vxRuntimeVersion, "0.3.1");
  const repeated = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source } },
    authorManifest: { title: "Counter", sdkVersion: 1 },
    profile: "standard-v1",
  });
  assert.equal(repeated.ok, true);
  if (repeated.ok) {
    assert.deepEqual(repeated.artifact.manifest, result.artifact.manifest);
    assert.deepEqual(repeated.artifact.buildProvenance, result.artifact.buildProvenance);
    assert.deepEqual(repeated.artifact.wasm, result.artifact.wasm);
  }
  await assert.doesNotReject(() => validateArtifact(result.artifact));
  const tampered = { ...result.artifact, wasm: result.artifact.wasm.slice() };
  tampered.wasm[tampered.wasm.length - 1] ^= 1;
  await assert.rejects(() => validateArtifact(tampered), /hash mismatch|malformed/);
  const incompatible = structuredClone(result.artifact);
  incompatible.manifest.vxRuntimeVersion = "999.0.0";
  await assert.rejects(() => validateArtifact(incompatible), /unsupported/);
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
  if (typeof SharedArrayBuffer !== "undefined") {
    const shared = new Uint8Array(new SharedArrayBuffer(result.artifact.wasm.byteLength));
    shared.set(result.artifact.wasm);
    await assert.rejects(() => validateArtifact({ ...result.artifact, wasm: shared }), /shared memory/);
  }
});

test("rejects ambient VX capabilities exposed by the upstream type", async () => {
  const result = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": source.replace("Cmd", "Cmd") + "\nfn forbidden() -> Cmd<Msg>\n  Cmd<Msg>::copy_to_clipboard(\"secret\")" } },
    authorManifest: { title: "Forbidden capability", sdkVersion: 1 },
    profile: "standard-v1",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.diagnostics.some((item) => item.code === "forbidden_capability"));
});

test("rejects forbidden dependencies before invoking Voyd", async () => {
  const result = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": "use pkg::web::all\npub fn app() -> i32\n  1" } },
    authorManifest: { title: "Forbidden", sdkVersion: 1 },
    profile: "standard-v1",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.diagnostics.some((item) => item.code === "forbidden_package"));
});

test("bounds source file metadata before policy scanning", async () => {
  const files = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`file-${index}.voyd`, ""]));
  const result = await compileTessera({ source: { entry: "file-0.voyd", files }, authorManifest: { title: "Too many", sdkVersion: 1 }, profile: "standard-v1" });
  assert.equal(result.ok, false);
  if (!result.ok) assert(result.diagnostics.some((item) => item.code === "resource_limit"));
});

test("policy scanning ignores forbidden-looking text in strings and comments", async () => {
  const harmless = source
    .replace("<Metric label=\"Count\" value={to_f64(model.count)} />", "<Code value=\"<div> use std::vx\" />")
    .concat("\n// use pkg::web::all and Cmd::fetch are documentation, not code\n");
  const result = await compileTessera({
    source: { entry: "main.voyd", files: { "main.voyd": harmless } },
    authorManifest: { title: "Harmless code sample", sdkVersion: 1 },
    profile: "standard-v1",
  });
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics));
});
