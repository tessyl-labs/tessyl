import { TessylNativeError } from "../errors.js";
import { resourceProfile } from "../profiles.js";
import { validateStaticFrame } from "../protocol/validate.js";
import type { TesseraArtifact, TesseraArtifactV1 } from "../types.js";
import { canonicalJson, sha256 } from "./canonical.js";
import { inspectWasm } from "./wasm.js";
import { NATIVE_SDK_VERSION, VOYD_COMPILER_ABI_VERSION, VX_RUNTIME_ABI_VERSION } from "../versions.js";

export const validateArtifact = async (artifact: TesseraArtifact): Promise<TesseraArtifactV1> => {
  const validated = validateArtifactStructure(artifact);
  return validateArtifactIntegrity(validated);
};

export const validateArtifactIntegrity = async (validated: TesseraArtifactV1): Promise<TesseraArtifactV1> => {
  const manifest = validated.manifest;
  const hashes = await Promise.all([
    sha256(validated.wasm),
    sha256(validated.sourceBundle),
    sha256(canonicalJson(validated.dependencyLock)),
    sha256(canonicalJson(validated.fallback)),
    sha256(canonicalJson(validated.buildProvenance)),
  ]);
  const expected = [manifest.wasmHash, manifest.sourceHash, manifest.dependencyLockHash, manifest.fallbackHash, manifest.buildProvenanceHash];
  if (hashes.some((hash, index) => hash !== expected[index])) invalid("Artifact component hash mismatch");
  return validated;
};

export const validateArtifactStructure = (artifact: TesseraArtifact): TesseraArtifactV1 => {
  const record = plainRecord(artifact, "Artifact");
  exactKeys(record, ["manifest", "wasm", "sourceBundle", "dependencyLock", "fallback", "buildProvenance"], "Artifact");
  const manifest = artifact.manifest;
  const manifestRecord = plainRecord(manifest, "Manifest");
  exactKeys(manifestRecord, ["schemaVersion", "frameProtocolVersion", "rpcProtocolVersion", "sdkVersion", "vxRuntimeVersion", "compilerVersion", "sourceHash", "dependencyLockHash", "wasmHash", "fallbackHash", "buildProvenanceHash", "entrypoint", "capabilityProfile", "resourceProfile"], "Manifest");
  if (
    manifest.schemaVersion !== 1 ||
    manifest.frameProtocolVersion !== 1 ||
    manifest.rpcProtocolVersion !== 1 ||
    manifest.sdkVersion !== NATIVE_SDK_VERSION ||
    manifest.vxRuntimeVersion !== VX_RUNTIME_ABI_VERSION ||
    manifest.compilerVersion !== VOYD_COMPILER_ABI_VERSION ||
    manifest.entrypoint !== "app" ||
    manifest.capabilityProfile !== "public-v1" ||
    manifest.resourceProfile !== "standard-v1"
  ) invalid("Artifact version tuple is unsupported", "unsupported_version");
  for (const hash of [manifest.sourceHash, manifest.dependencyLockHash, manifest.wasmHash, manifest.fallbackHash, manifest.buildProvenanceHash]) {
    if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) invalid("Manifest contains an invalid content hash");
  }
  const profile = resourceProfile(manifest.resourceProfile);
  if (!(artifact.wasm instanceof Uint8Array) || !(artifact.sourceBundle instanceof Uint8Array)) invalid("Artifact byte fields are invalid");
  if (isSharedView(artifact.wasm) || isSharedView(artifact.sourceBundle)) invalid("Artifact byte fields cannot use shared memory");
  if (artifact.sourceBundle.byteLength > profile.maxSourceBytes) invalid("Source bundle exceeds its resource limit", "resource_limit");
  validateDependencyLock(artifact.dependencyLock);
  const provenance = plainRecord(artifact.buildProvenance, "Build provenance");
  exactKeys(provenance, ["version", "builder", "profile", "reproducible"], "Build provenance");
  if (provenance.version !== 1 || provenance.builder !== "@tessyl/native" || provenance.profile !== "standard-v1" || provenance.reproducible !== true) invalid("Build provenance is invalid");
  try { validateStaticFrame(artifact.fallback, profile); }
  catch (error) {
    const code = error instanceof TessylNativeError && error.code === "resource_limit" ? "resource_limit" : "invalid_artifact";
    throw new TessylNativeError({ code, phase: "initialize", message: "Artifact fallback is invalid", cause: error });
  }
  try { inspectWasm(artifact.wasm, profile); }
  catch (error) {
    if (error instanceof TessylNativeError) throw new TessylNativeError({ code: error.code, phase: "initialize", message: error.message, recoverable: error.recoverable, cause: error });
    throw error;
  }
  return artifact;
};

const validateDependencyLock = (value: unknown): void => {
  const lock = plainRecord(value, "Dependency lock");
  exactKeys(lock, ["version", "packages"], "Dependency lock");
  const packages = lock.packages;
  if (lock.version !== 1 || !Array.isArray(packages) || packages.length < 1 || packages.length > 64) invalid("Dependency lock is invalid");
  rejectAccessors(packages as object, "Dependency packages");
  const names = new Set<string>();
  for (const item of packages as unknown[]) {
    const entry = plainRecord(item, "Dependency entry");
    exactKeys(entry, ["name", "version", "contentHash"], "Dependency entry");
    if (typeof entry.name !== "string" || entry.name.length > 100 || names.has(entry.name) || typeof entry.version !== "string" || entry.version.length > 80 || typeof entry.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(entry.contentHash)) invalid("Dependency lock entry is invalid");
    names.add(entry.name as string);
  }
};

const plainRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label} is not an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(`${label} has an invalid prototype`);
  rejectAccessors(value as object, label);
  return value as Record<string, unknown>;
};

const rejectAccessors = (value: object, label: string): void => {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") invalid(`${label} contains a symbol key`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.get || descriptor?.set) invalid(`${label} contains an accessor property`);
  }
};

const isSharedView = (value: Uint8Array): boolean => typeof SharedArrayBuffer !== "undefined" && value.buffer instanceof SharedArrayBuffer;

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[], label: string): void => {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid(`${label} contains an unknown field`);
};

const invalid = (message: string, code: "invalid_artifact" | "unsupported_version" | "resource_limit" = "invalid_artifact"): never => {
  throw new TessylNativeError({ code, phase: "initialize", message, recoverable: code !== "invalid_artifact" });
};
