import { normalizeRenderFrame } from "@voyd-lang/vx-dom";
import type { NativeEventDescriptor, NativeFrameV1, NativeNode } from "../types.js";
import type { ResourceProfile } from "../profiles.js";
import { validateBoundaryValue } from "./validate.js";

type ScalarRecord = Record<string, string | number | boolean>;

export const normalizeNativeFrame = (input: unknown, profile: ResourceProfile): NativeFrameV1 => {
  preflightFrame(input, profile);
  const frame = normalizeRenderFrame(input);
  return { version: 1, root: compactNode(frame.root) };
};

const preflightFrame = (input: unknown, profile: ResourceProfile): void => {
  validateBoundaryValue(input, profile.maxFrameBytes, "vx frame", profile);
  const inputRecord = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : undefined;
  const root = inputRecord && "version" in inputRecord ? inputRecord.root : input;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (depth > profile.maxDepth) throw new Error("VX frame depth exceeds the Native profile");
    nodes += 1;
    if (nodes > profile.maxNodes) throw new Error("VX frame node count exceeds the Native profile");
    if (value === null || typeof value !== "object") {
      if (typeof value === "string" && new TextEncoder().encode(value).byteLength > profile.maxStringBytes) throw new Error("VX frame string exceeds the Native profile");
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > profile.maxChildren) throw new Error("VX frame child count exceeds the Native profile");
      for (let index = value.length - 1; index >= 0; index -= 1) stack.push({ value: value[index], depth: depth + 1 });
      continue;
    }
    const node = value as Record<string, unknown>;
    for (const candidate of [node.key, node.tag, node.value]) {
      if (typeof candidate === "string" && new TextEncoder().encode(candidate).byteLength > profile.maxStringBytes) throw new Error("VX frame string exceeds the Native profile");
    }
    const children = node.kind === "map" ? [node.child] : node.children;
    if (children === undefined) continue;
    if (!Array.isArray(children)) throw new Error("VX frame children must be an array");
    if (children.length > profile.maxChildren) throw new Error("VX frame child count exceeds the Native profile");
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ value: children[index], depth: depth + 1 });
  }
};

const compactNode = (input: ReturnType<typeof normalizeRenderFrame>["root"]): NativeNode => {
  if (input.kind === "text") return { kind: "text", value: input.value, ...(input.key === undefined ? {} : { key: String(input.key) }) };
  if (input.kind === "fragment") return {
    kind: "fragment",
    ...(input.key === undefined ? {} : { key: String(input.key) }),
    children: input.children.map(compactNode),
  };
  if (input.styles && Object.keys(input.styles).length) throw new Error("inline styles are outside the Tessyl Native render surface");
  return {
    kind: "element",
    tag: input.tag,
    ...(input.key === undefined ? {} : { key: String(input.key) }),
    ...(input.attrs === undefined ? {} : { attrs: input.attrs as ScalarRecord }),
    ...(input.props === undefined ? {} : { props: input.props as ScalarRecord }),
    ...(input.events === undefined ? {} : { events: input.events as NativeEventDescriptor[] }),
    ...(input.children === undefined ? {} : { children: input.children.map(compactNode) }),
  };
};
