import { TessylNativeError } from "../errors.js";
import type {
  NativeElementNode,
  NativeEventDescriptor,
  NativeFrameV1,
  NativeNode,
  NativeStaticFrameV1,
} from "../types.js";
import type { ResourceProfile } from "../profiles.js";
import { RENDER_POLICY } from "./render-policy.js";

const ALLOWED_TAGS = new Set<string>(RENDER_POLICY.tags);
const VOID_TAGS = new Set<string>(RENDER_POLICY.voidTags);
const GLOBAL_ATTRS = new Set<string>(RENDER_POLICY.globalAttributes);
const TAG_ATTRS: Readonly<Record<string, ReadonlySet<string>>> = Object.fromEntries(Object.entries(RENDER_POLICY.tagAttributes).map(([tag, names]) => [tag, new Set<string>(names)]));
const ALLOWED_EVENTS = new Set<string>(RENDER_POLICY.events);
const SAFE_INPUT_TYPES = new Set<string>(RENDER_POLICY.safeInputTypes);

type ValidationState = { nodes: number; handlers: number; stringBytes: number };
const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength;

const fail = (message: string): never => {
  const separator = message.lastIndexOf(": ");
  const boundedMessage = message.length <= 220
    ? message
    : `${message.slice(0, 140)}…${separator > 140 ? message.slice(separator) : ""}`;
  throw new TessylNativeError({
    code: "protocol_violation",
    phase: "run",
    message: boundedMessage,
    recoverable: true,
  });
};

const exactKeys = (record: Record<string, unknown>, allowed: readonly string[], path: string): void => {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) fail(`${path}: unknown field ${key.slice(0, 48)}`);
};

const rejectAccessors = (value: object, path: string): void => {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === "symbol") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.get || descriptor?.set) fail(`${path}: accessor properties are unsupported`);
  }
};

const safeRecord = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path}: expected object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${path}: invalid prototype`);
  rejectAccessors(value as object, path);
  return value as Record<string, unknown>;
};

const safeArray = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) fail(`${path}: expected array`);
  rejectAccessors(value as object, path);
  return value as unknown[];
};

const countString = (value: string, profile: ResourceProfile, state: ValidationState, path: string): void => {
  const bytes = utf8Length(value);
  if (bytes > profile.maxStringBytes) fail(`${path}: string limit exceeded`);
  state.stringBytes += bytes;
  if (state.stringBytes > profile.maxFrameBytes) fail(`${path}: frame string budget exceeded`);
};

const validateScalar = (value: unknown, path: string): void => {
  if (!["string", "number", "boolean"].includes(typeof value)) fail(`${path}: invalid scalar`);
  if (typeof value === "number" && !Number.isFinite(value)) fail(`${path}: non-finite number`);
};

const validateEvent = (
  value: unknown,
  profile: ResourceProfile,
  state: ValidationState,
  path: string,
): NativeEventDescriptor => {
  const event = safeRecord(value, path);
  exactKeys(event, ["kind", "event", "handlerId", "message", "options", "mapHandlerIds"], path);
  if (event.kind !== "event" || typeof event.event !== "string" || !ALLOWED_EVENTS.has(event.event)) {
    fail(`${path}: unsupported event`);
  }
  if (event.handlerId !== undefined && (!Number.isSafeInteger(event.handlerId) || (event.handlerId as number) < 0)) {
    fail(`${path}: invalid handler`);
  }
  if (event.handlerId === undefined && event.message === undefined) fail(`${path}: missing handler`);
  if (event.mapHandlerIds !== undefined) {
    const mapHandlerIds = safeArray(event.mapHandlerIds, `${path}.mapHandlerIds`);
    if (mapHandlerIds.length > profile.maxDepth) fail(`${path}: invalid message map`);
    for (const id of mapHandlerIds) if (!Number.isSafeInteger(id) || (id as number) < 0) fail(`${path}: invalid message map`);
  }
  state.handlers += 1;
  if (state.handlers > profile.maxHandlers) fail(`${path}: handler limit exceeded`);
  if (event.options !== undefined) {
    const options = safeRecord(event.options, `${path}.options`);
    exactKeys(options, ["preventDefault", "stopPropagation"], `${path}.options`);
    for (const option of Object.values(options)) if (typeof option !== "boolean") fail(`${path}: invalid event option`);
  }
  state.stringBytes += validateBoundaryValue(event.message, profile.maxBoundaryBytes, `${path}.message`, profile);
  if (state.stringBytes > profile.maxFrameBytes) fail(`${path}: frame byte budget exceeded`);
  return event as NativeEventDescriptor;
};

const validateElement = (
  node: Record<string, unknown>,
  profile: ResourceProfile,
  state: ValidationState,
  path: string,
): NativeElementNode => {
  exactKeys(node, ["kind", "tag", "key", "attrs", "props", "events", "children"], path);
  if (typeof node.tag !== "string" || !ALLOWED_TAGS.has(node.tag)) fail(`${path}: unsupported element`);
  const tag = node.tag as string;
  if (node.key !== undefined && typeof node.key !== "string") fail(`${path}: invalid key`);
  if (typeof node.key === "string" && node.key) countString(node.key, profile, state, `${path}.key`);
  for (const field of ["attrs", "props"] as const) {
    if (node[field] === undefined) continue;
    const values = safeRecord(node[field], `${path}.${field}`);
    if (Object.keys(values).length > profile.maxAttributes) fail(`${path}: attribute limit exceeded`);
    for (const [name, value] of Object.entries(values)) {
      if (!GLOBAL_ATTRS.has(name) && !TAG_ATTRS[tag]?.has(name)) fail(`${path}: unsupported ${field} ${name.slice(0, 48)}`);
      validateScalar(value, `${path}.${field}.${name}`);
      countString(name, profile, state, `${path}.${field}`);
      if (typeof value === "string") countString(value, profile, state, `${path}.${field}.${name}`);
      if ((name === "d" || name === "points") && typeof value === "string" && !/^[0-9eE.,+\-\sMLHVCSQTAZmlhvcsqtaz]*$/.test(value)) {
        fail(`${path}: invalid SVG geometry`);
      }
    }
  }
  const attrs = node.attrs as Record<string, unknown> | undefined;
  const props = node.props as Record<string, unknown> | undefined;
  if (tag === "a" && (typeof attrs?.["data-article-slug"] !== "string" || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(attrs["data-article-slug"] as string))) {
    fail(`${path}: invalid article slug`);
  }
  if (attrs?.["data-native-width"] === "fixed") {
    const pixels = Number(attrs["data-native-width-px"]);
    if (!Number.isFinite(pixels) || pixels <= 0 || pixels > 1_200) fail(`${path}: invalid fixed width`);
  }
  if (tag === "input") {
    if (attrs?.type !== undefined && props?.type !== undefined && String(attrs.type) !== String(props.type)) fail(`${path}: conflicting input type`);
    const inputType = props?.type ?? attrs?.type;
    if (inputType !== undefined && !SAFE_INPUT_TYPES.has(String(inputType))) fail(`${path}: unsafe input type`);
  }
  if (node.events !== undefined) {
    const events = safeArray(node.events, `${path}.events`);
    events.forEach((event, index) => validateEvent(event, profile, state, `${path}.events[${index}]`));
  }
  if (VOID_TAGS.has(tag) && Array.isArray(node.children) && node.children.length > 0) fail(`${path}: void element has children`);
  return node as unknown as NativeElementNode;
};

export const validateFrame = (value: unknown, profile: ResourceProfile): NativeFrameV1 => {
  const frame = safeRecord(value, "frame");
  exactKeys(frame, ["version", "root"], "frame");
  if (frame.version !== 1) fail("frame: unsupported version");
  const state: ValidationState = { nodes: 0, handlers: 0, stringBytes: 0 };
  const active = new Set<object>();
  const stack: { value: unknown; depth: number; path: string; exit?: boolean }[] = [
    { value: frame.root, depth: 0, path: "frame.root" },
  ];
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (item.exit) {
      active.delete(item.value as object);
      continue;
    }
    if (item.depth > profile.maxDepth) fail(`${item.path}: depth limit exceeded`);
    const node = safeRecord(item.value, item.path);
    if (active.has(node)) fail(`${item.path}: cyclic node`);
    active.add(node);
    stack.push({ ...item, value: node, exit: true });
    state.nodes += 1;
    if (state.nodes > profile.maxNodes) fail(`${item.path}: node limit exceeded`);
    if (node.key !== undefined && typeof node.key !== "string") fail(`${item.path}: invalid key`);
    if (typeof node.key === "string" && node.key) countString(node.key, profile, state, `${item.path}.key`);
    if (node.kind === "text") {
      exactKeys(node, ["kind", "value", "key"], item.path);
      if (typeof node.value !== "string") fail(`${item.path}: invalid text`);
      countString(node.value as string, profile, state, `${item.path}.value`);
      continue;
    }
    if (node.kind !== "fragment" && node.kind !== "element") fail(`${item.path}: invalid node kind`);
    if (node.kind === "element") validateElement(node, profile, state, item.path);
    else {
      exactKeys(node, ["kind", "children", "key"], item.path);
      if (node.key !== undefined) fail(`${item.path}: keyed fragments are unsupported`);
    }
    const childList = safeArray(node.children ?? [], `${item.path}.children`);
    if (childList.length > profile.maxChildren) fail(`${item.path}: child limit exceeded`);
    for (let index = childList.length - 1; index >= 0; index -= 1) {
      stack.push({ value: childList[index], depth: item.depth + 1, path: `${item.path}.children[${index}]` });
    }
  }
  return frame as unknown as NativeFrameV1;
};

export const validateStaticFrame = (value: unknown, profile: ResourceProfile): NativeStaticFrameV1 => {
  const frame = validateFrame(value, profile);
  const stack: NativeNode[] = [frame.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === "element") {
      if (node.events?.length || ["a", "input", "button", "select", "option"].includes(node.tag)) fail("fallback: interactive node");
      if (node.attrs && ("tabindex" in node.attrs || "href" in node.attrs)) fail("fallback: focusable node");
      stack.push(...(node.children ?? []));
    } else if (node.kind === "fragment") stack.push(...node.children);
  }
  return frame;
};

type BoundaryLimits = Pick<ResourceProfile,
  "maxBoundaryDepth" | "maxBoundaryContainers" | "maxBoundaryEntries" | "maxBoundaryEntriesPerContainer"
>;

export const validateBoundaryValue = (value: unknown, maxBytes: number, path = "value", limits?: BoundaryLimits): number => {
  if (value === undefined) return 0;
  let approximateBytes = 0;
  let containers = 0;
  let entries = 0;
  const active = new Set<object>();
  const stack: { value: unknown; depth: number; exit?: boolean }[] = [{ value, depth: 0 }];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.exit) { active.delete(current.value as object); continue; }
    const entry = current.value;
    if (entry === null || typeof entry === "boolean") {
      approximateBytes += 5;
      if (approximateBytes > maxBytes) fail(`${path}: payload limit exceeded`);
      continue;
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) fail(`${path}: non-finite number`);
      approximateBytes += 16;
      if (approximateBytes > maxBytes) fail(`${path}: payload limit exceeded`);
      continue;
    }
    if (typeof entry === "bigint") {
      if (entry < BigInt(Number.MIN_SAFE_INTEGER) || entry > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${path}: bigint outside safe range`);
      approximateBytes += 16;
      if (approximateBytes > maxBytes) fail(`${path}: payload limit exceeded`);
      continue;
    }
    if (typeof entry === "string") { approximateBytes += utf8Length(entry); }
    else if (typeof entry === "object") {
      if (active.has(entry)) fail(`${path}: cyclic value`);
      if (limits && current.depth > limits.maxBoundaryDepth) fail(`${path}: boundary depth limit exceeded`);
      const prototype = Object.getPrototypeOf(entry);
      if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null) fail(`${path}: invalid value prototype`);
      active.add(entry);
      containers += 1;
      if (limits && containers > limits.maxBoundaryContainers) fail(`${path}: boundary container limit exceeded`);
      stack.push({ value: entry, depth: current.depth, exit: true });
      if (Array.isArray(entry)) {
        entries += entry.length;
        if (limits && entry.length > limits.maxBoundaryEntriesPerContainer) fail(`${path}: boundary container entry limit exceeded`);
        if (limits && entries > limits.maxBoundaryEntries) fail(`${path}: boundary entry limit exceeded`);
        rejectAccessors(entry, path);
        approximateBytes += 2 + entry.length;
        if (approximateBytes > maxBytes) fail(`${path}: payload limit exceeded`);
        for (let index = entry.length - 1; index >= 0; index -= 1) stack.push({ value: entry[index], depth: current.depth + 1 });
      } else {
        const objectKeys = Object.keys(entry);
        entries += objectKeys.length;
        if (limits && objectKeys.length > limits.maxBoundaryEntriesPerContainer) fail(`${path}: boundary container entry limit exceeded`);
        if (limits && entries > limits.maxBoundaryEntries) fail(`${path}: boundary entry limit exceeded`);
        rejectAccessors(entry, path);
        approximateBytes += 2;
        for (const key of objectKeys) {
          approximateBytes += utf8Length(key) + 3;
          if (approximateBytes > maxBytes) fail(`${path}: payload limit exceeded`);
          stack.push({ value: (entry as Record<string, unknown>)[key], depth: current.depth + 1 });
        }
      }
    } else fail(`${path}: invalid boundary type`);
    if (approximateBytes > maxBytes) fail(`${path}: payload limit exceeded`);
  }
  return approximateBytes;
};

export const validateRuntimeStep = (value: unknown, profile: ResourceProfile): Record<string, unknown> => {
  validateBoundaryValue(value, profile.maxBoundaryBytes, "step", profile);
  const step = safeRecord(value, "step");
  exactKeys(step, ["frame", "commands", "subscriptions"], "step");
  if (step.frame !== undefined) validateFrame(step.frame, profile);
  if (step.commands !== undefined) validateRuntimeGraph(step.commands, "cmd", profile.maxCommandNodes, profile);
  if (step.subscriptions !== undefined) validateRuntimeGraph(step.subscriptions, "sub", profile.maxSubscriptions, profile);
  return step;
};

const validateRuntimeGraph = (value: unknown, type: "cmd" | "sub", max: number, profile: ResourceProfile): void => {
  const stack = [value];
  let count = 0;
  while (stack.length) {
    const node = safeRecord(stack.pop(), type);
    count += 1;
    if (count > max) fail(`${type}: graph limit exceeded`);
    if (node.type !== type || typeof node.kind !== "string") fail(`${type}: invalid envelope`);
    if (node.kind === "batch") {
      exactKeys(node, ["type", "kind", "children"], type);
      if (!Array.isArray(node.children) || node.children.length > max) fail(`${type}: invalid batch`);
      stack.push(...(node.children as unknown[]));
    } else if (node.kind === "map") {
      exactKeys(node, ["type", "kind", "child", "handlerId", "handlerKey", "__vxOwnedMapHandlerIds"], type);
      if (!Number.isSafeInteger(node.handlerId) || (node.handlerId as number) < 0) fail(`${type}: invalid map handler`);
      if (node.handlerKey !== undefined && !["string", "number"].includes(typeof node.handlerKey)) fail(`${type}: invalid map key`);
      if (typeof node.handlerKey === "string" && utf8Length(node.handlerKey) > profile.maxStringBytes) fail(`${type}: invalid map key`);
      if (node.__vxOwnedMapHandlerIds !== undefined) {
        if (!Array.isArray(node.__vxOwnedMapHandlerIds) || node.__vxOwnedMapHandlerIds.length > profile.maxDepth || node.__vxOwnedMapHandlerIds.some((id) => !Number.isSafeInteger(id) || id < 0)) fail(`${type}: invalid owned handlers`);
      }
      stack.push(node.child);
    } else {
      validateRuntimeLeaf(node, type, profile);
    }
  }
};

const validateRuntimeLeaf = (node: Record<string, unknown>, type: "cmd" | "sub", profile: ResourceProfile): void => {
  if (node.kind === "none") {
    exactKeys(node, ["type", "kind"], type);
    return;
  }
  if (type === "cmd" && node.kind === "message") {
    exactKeys(node, ["type", "kind", "value"], type);
    validateBoundaryValue(node.value, profile.maxBoundaryBytes, `${type}.value`, profile);
    return;
  }
  if (type === "cmd" && node.kind === "delay") {
    exactKeys(node, ["type", "kind", "ms", "value"], type);
    if (typeof node.ms !== "number" && typeof node.ms !== "bigint") fail("cmd: invalid delay");
    const delay = Number(node.ms);
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > profile.maxDelayMs) fail("cmd: invalid delay");
    validateBoundaryValue(node.value, profile.maxBoundaryBytes, `${type}.value`, profile);
    return;
  }
  if (type === "sub" && (node.kind === "animation_frame" || node.kind === "container_size")) {
    exactKeys(node, ["type", "kind", "key"], type);
    if (typeof node.key !== "string" || node.key.length === 0 || utf8Length(node.key) > profile.maxStringBytes) fail("sub: invalid key");
    return;
  }
  fail(`${type}: unsupported capability`);
};
