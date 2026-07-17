import { TessylNativeError } from "../errors.js";
import type { ResourceProfile } from "../profiles.js";

const ALLOWED_IMPORT_MODULES = new Set([
  "voyd.callback",
  "voyd.boundary.callback",
  "voyd.render.callback",
  "voyd.vx.callback",
  "voyd.callback.scope",
]);
const REQUIRED_EXPORTS = new Map<string, "function" | "memory">([["app", "function"], ["memory", "memory"]]);
const ALLOWED_EXPORTS = new Set([
  "app", "memory", "effects_memory", "init_effects", "resume_continuation", "resume_effectful", "effect_status", "effect_len",
  "resume_effectful_raw", "end_request_raw", "handle_outcome", "effect_cont", "__voyd_effect_table", "__voyd_export_abi", "__voyd_external_requirements",
  "__voyd_trap_metadata", "__voyd_callback_dispatch", "__voyd_callback_release", "__voyd_outcome_tag", "__voyd_outcome_payload",
  "__voyd_outcome_unwrap_i32", "__voyd_effect_id", "__voyd_effect_op_id", "__voyd_effect_resume_kind",
  "__voyd_panic_ptr", "__voyd_panic_len", "__voyd_panic_scratch_ptr", "__voyd_panic_scratch_capacity",
]);

export const inspectWasm = (wasm: Uint8Array, profile: ResourceProfile): void => {
  if (wasm.byteLength === 0 || wasm.byteLength > profile.maxWasmBytes) reject("Wasm size is outside the resource profile");
  if (wasm.byteLength < 8 || wasm[0] !== 0 || wasm[1] !== 0x61 || wasm[2] !== 0x73 || wasm[3] !== 0x6d || wasm[4] !== 1 || wasm[5] !== 0 || wasm[6] !== 0 || wasm[7] !== 0) {
    reject("Wasm module header is malformed");
  }
  const importCount = inspectImports(wasm);
  inspectStructureCounts(wasm, profile, importCount);
  const exports = inspectExports(wasm);
  if (exports.length > profile.maxHandlers + ALLOWED_EXPORTS.size) reject("Wasm export count exceeds the resource profile");
  const exportKinds = new Map(exports.map((entry) => [entry.name, entry.kind]));
  for (const [required, kind] of REQUIRED_EXPORTS) {
    if (!exportKinds.has(required)) reject(`Missing required Wasm export: ${required}`);
    if (exportKinds.get(required) !== kind) reject(`Wasm export ${required} must be a ${kind}`);
  }
  for (const entry of exports) {
    const callbackSignature = entry.kind === "function" && /^__voyd_callback_signature__[A-Za-z0-9_]{1,160}$/.test(entry.name);
    if (!ALLOWED_EXPORTS.has(entry.name) && !callbackSignature) reject(`Unexpected Wasm export: ${entry.name.slice(0, 96)}`);
  }
  inspectResourceSections(wasm, profile);
};

const inspectExports = (wasm: Uint8Array): Array<{ name: string; kind: "function" | "table" | "memory" | "global" | "tag" }> => {
  const kinds = ["function", "table", "memory", "global", "tag"] as const;
  let offset = 8;
  while (offset < wasm.byteLength) {
    const id = wasm[offset++];
    const size = readUleb(wasm, offset); offset = size.next;
    const end = offset + size.value;
    if (end > wasm.byteLength) reject("Wasm section exceeds module size");
    if (id !== 7) { offset = end; continue; }
    const count = readUleb(wasm, offset); offset = count.next;
    if (count.value > 512) reject("Wasm export count exceeds the resource profile");
    const out: Array<{ name: string; kind: typeof kinds[number] }> = [];
    for (let index = 0; index < count.value; index += 1) {
      const name = readName(wasm, offset); offset = name.next;
      const kind = kinds[wasm[offset++]];
      if (!kind) reject("Wasm export kind is unsupported");
      offset = readUleb(wasm, offset).next;
      out.push({ name: name.value, kind });
    }
    if (offset !== end) reject("Wasm export section is malformed");
    return out;
  }
  return [];
};

export const wasmImportDescriptors = (wasm: Uint8Array): WebAssembly.ModuleImportDescriptor[] => {
  const descriptors: WebAssembly.ModuleImportDescriptor[] = [];
  let offset = 8;
  while (offset < wasm.byteLength) {
    const id = wasm[offset++];
    const size = readUleb(wasm, offset); offset = size.next;
    const end = offset + size.value;
    if (end > wasm.byteLength) reject("Wasm section exceeds module size");
    if (id !== 2) { offset = end; continue; }
    const count = readUleb(wasm, offset); offset = count.next;
    if (count.value > 512) reject("Wasm import count exceeds the resource profile");
    for (let index = 0; index < count.value; index += 1) {
      const moduleName = readName(wasm, offset); offset = moduleName.next;
      const importName = readName(wasm, offset); offset = importName.next;
      const kind = wasm[offset++];
      const allowedPanicTrap = moduleName.value === "env" && importName.value === "__voyd_panic_trap";
      if (kind !== 0 || (!ALLOWED_IMPORT_MODULES.has(moduleName.value) && !allowedPanicTrap)) reject(`Forbidden Wasm import: ${moduleName.value}.${importName.value}`.slice(0, 120));
      offset = readUleb(wasm, offset).next;
      descriptors.push({ module: moduleName.value, name: importName.value, kind: "function" });
    }
    if (offset !== end) reject("Wasm import section is malformed");
    return descriptors;
  }
  return descriptors;
};

const inspectImports = (wasm: Uint8Array): number => wasmImportDescriptors(wasm).length;

const inspectStructureCounts = (wasm: Uint8Array, profile: ResourceProfile, importCount: number): void => {
  let offset = 8;
  let sections = 0;
  let definedFunctions = 0;
  let codeBodies = 0;
  const limits = new Map<number, { maximum: number; label: string }>([
    [1, { maximum: profile.maxWasmTypes, label: "type" }],
    [3, { maximum: profile.maxWasmFunctions, label: "function" }],
    [6, { maximum: profile.maxWasmGlobals, label: "global" }],
    [9, { maximum: profile.maxWasmElementSegments, label: "element segment" }],
    [10, { maximum: profile.maxWasmFunctions, label: "code body" }],
    [11, { maximum: profile.maxWasmDataSegments, label: "data segment" }],
    [12, { maximum: profile.maxWasmDataSegments, label: "declared data segment" }],
  ]);
  while (offset < wasm.byteLength) {
    sections += 1;
    if (sections > profile.maxWasmSections) reject("Wasm section count exceeds the resource profile");
    const id = wasm[offset++];
    const size = readUleb(wasm, offset); offset = size.next;
    const end = offset + size.value;
    if (end > wasm.byteLength) reject("Wasm section exceeds module size");
    const sectionLimit = limits.get(id);
    if (sectionLimit) {
      const count = readUleb(wasm, offset);
      if (count.value > sectionLimit.maximum) reject(`Wasm ${sectionLimit.label} count exceeds the resource profile`);
      if (id === 3) definedFunctions = count.value;
      if (id === 10) codeBodies = count.value;
    }
    offset = end;
  }
  if (importCount + definedFunctions > profile.maxWasmFunctions) reject("Wasm function count exceeds the resource profile");
  if (definedFunctions !== codeBodies) reject("Wasm function and code counts do not match");
};

const readName = (wasm: Uint8Array, offset: number): { value: string; next: number } => {
  const size = readUleb(wasm, offset); offset = size.next;
  if (size.value > 256 || offset + size.value > wasm.byteLength) reject("Wasm import name is invalid");
  try {
    return { value: new TextDecoder("utf-8", { fatal: true }).decode(wasm.subarray(offset, offset + size.value)), next: offset + size.value };
  } catch (error) { return reject("Wasm import name is invalid", error); }
};

const inspectResourceSections = (wasm: Uint8Array, profile: ResourceProfile): void => {
  let offset = 8;
  let memoryCount = 0;
  let tableCount = 0;
  let totalInitialTableElements = 0;
  let totalMaximumTableElements = 0;
  while (offset < wasm.byteLength) {
    const id = wasm[offset++];
    const size = readUleb(wasm, offset); offset = size.next;
    const end = offset + size.value;
    if (end > wasm.byteLength) reject("Wasm section exceeds module size");
    if (id === 8) reject("Wasm start functions are not allowed");
    if (id === 5) {
      const count = readUleb(wasm, offset); offset = count.next; memoryCount += count.value;
      for (let index = 0; index < count.value; index += 1) {
        const limits = readLimits(wasm, offset); offset = limits.next;
        if (limits.shared || limits.is64 || limits.maximum === undefined || limits.maximum > profile.maxMemoryPages || limits.initial > limits.maximum) {
          reject("Wasm memory declaration is outside the resource profile");
        }
      }
    } else if (id === 4) {
      const count = readUleb(wasm, offset); offset = count.next; tableCount += count.value;
      if (tableCount > profile.maxTables) reject("Wasm table count exceeds the resource profile");
      for (let index = 0; index < count.value; index += 1) {
        offset = readReferenceType(wasm, offset);
        const limits = readLimits(wasm, offset); offset = limits.next;
        const maximum = limits.maximum ?? reject("Wasm table declaration is outside the resource profile");
        if (limits.shared || limits.is64 || maximum > profile.maxTableElements || limits.initial > maximum) {
          reject("Wasm table declaration is outside the resource profile");
        }
        totalInitialTableElements += limits.initial;
        totalMaximumTableElements += maximum;
        if (totalInitialTableElements > profile.maxTableElements || totalMaximumTableElements > profile.maxTableElements) {
          reject("Aggregate Wasm table capacity exceeds the resource profile");
        }
      }
    }
    if ((id === 4 || id === 5) && offset !== end) reject("Wasm resource section is malformed");
    offset = end;
  }
  if (memoryCount !== 1) reject("Wasm must define exactly one linear memory");
};

const readReferenceType = (wasm: Uint8Array, offset: number): number => {
  const byte = wasm[offset];
  if (byte === 0x70 || byte === 0x6f) return offset + 1;
  return reject("Unsupported Wasm table reference type");
};

const readLimits = (wasm: Uint8Array, offset: number): {
  initial: number; maximum?: number; shared: boolean; is64: boolean; next: number;
} => {
  const flags = readUleb(wasm, offset); offset = flags.next;
  if ((flags.value & ~7) !== 0) reject("Unsupported Wasm limits flags");
  const initial = readUleb(wasm, offset); offset = initial.next;
  let maximum: number | undefined;
  if ((flags.value & 1) === 1) { const parsed = readUleb(wasm, offset); maximum = parsed.value; offset = parsed.next; }
  return { initial: initial.value, maximum, shared: (flags.value & 2) !== 0, is64: (flags.value & 4) !== 0, next: offset };
};

export const enforceWasmLimits = (wasm: Uint8Array, profile: ResourceProfile): Uint8Array => {
  if (wasm.byteLength < 8) reject("Wasm module is malformed");
  const chunks: Uint8Array[] = [wasm.slice(0, 8)];
  let offset = 8;
  let foundMemory = false;
  while (offset < wasm.byteLength) {
    const sectionStart = offset;
    const id = wasm[offset++];
    const size = readUleb(wasm, offset);
    offset = size.next;
    const payloadEnd = offset + size.value;
    if (payloadEnd > wasm.byteLength) reject("Wasm section exceeds module size");
    if (id !== 5) {
      chunks.push(wasm.slice(sectionStart, payloadEnd));
      offset = payloadEnd;
      continue;
    }
    foundMemory = true;
    const payload: number[] = [];
    const count = readUleb(wasm, offset);
    offset = count.next;
    payload.push(...writeUleb(count.value));
    for (let index = 0; index < count.value; index += 1) {
      const flags = readUleb(wasm, offset); offset = flags.next;
      const initial = readUleb(wasm, offset); offset = initial.next;
      if ((flags.value & ~1) !== 0) reject("Shared or memory64 Wasm memory is not allowed");
      if (initial.value > profile.maxMemoryPages) reject("Wasm initial memory exceeds the resource profile");
      if ((flags.value & 1) === 1) {
        const maximum = readUleb(wasm, offset); offset = maximum.next;
        if (maximum.value > profile.maxMemoryPages || maximum.value < initial.value) reject("Wasm memory maximum is invalid");
        payload.push(...writeUleb(flags.value), ...writeUleb(initial.value), ...writeUleb(maximum.value));
      } else {
        payload.push(...writeUleb(1), ...writeUleb(initial.value), ...writeUleb(profile.maxMemoryPages));
      }
    }
    if (offset !== payloadEnd) reject("Wasm memory section is malformed");
    const bounded = Uint8Array.from(payload);
    chunks.push(Uint8Array.from([id]), Uint8Array.from(writeUleb(bounded.byteLength)), bounded);
  }
  if (!foundMemory) reject("Wasm module has no defined memory");
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.byteLength; }
  return output;
};

const readUleb = (bytes: Uint8Array, start: number): { value: number; next: number } => {
  let value = 0;
  let shift = 0;
  let offset = start;
  while (offset < bytes.byteLength && shift <= 35) {
    const byte = bytes[offset++];
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: offset };
    shift += 7;
  }
  return reject("Invalid Wasm integer encoding");
};

const writeUleb = (input: number): number[] => {
  let value = input;
  const out: number[] = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    out.push(byte);
  } while (value > 0);
  return out;
};

const reject = (message: string, cause?: unknown): never => {
  throw new TessylNativeError({ code: "invalid_artifact", phase: "compile", message, cause });
};
