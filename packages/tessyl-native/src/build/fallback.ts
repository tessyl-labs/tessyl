import type { NativeElementNode, NativeFrameV1, NativeNode, NativeStaticFrameV1 } from "../types.js";
import type { ResourceProfile } from "../profiles.js";
import { validateFrame, validateStaticFrame } from "../protocol/validate.js";

const INTERACTIVE = new Set(["button", "input", "select", "option", "a"]);
const PARTICLE_TONES = ["neutral", "accent", "informative", "positive", "caution", "critical"] as const;
const nodeText = (node: NativeNode): string => node.kind === "text"
  ? node.value
  : (node.kind === "fragment" ? node.children : node.children ?? []).map(nodeText).join("");
const nodeCount = (node: NativeNode): number => 1 + (node.kind === "text" ? 0 : (node.kind === "fragment" ? node.children : node.children ?? []).reduce((total, child) => total + nodeCount(child), 0));
const sceneObjectCount = (node: NativeNode): number => {
  if (node.kind === "text") return 0;
  const children = node.kind === "fragment" ? node.children : node.children ?? [];
  const current = node.kind === "element" && ["circle", "rect", "line", "path", "polyline", "polygon", "text"].includes(node.tag) && node.attrs?.["data-native-series"] === undefined ? 1 : 0;
  return current + children.reduce((total, child) => total + sceneObjectCount(child), 0);
};

const particleSnapshot = (node: NativeElementNode, maxExpansion: number, maxSceneObjects: number): { node: NativeElementNode; source: NativeElementNode; expansion: number; sceneObjects: number } | undefined => {
  if (node.attrs?.["data-native-component"] !== "particle-field") return undefined;
  const canvas = (node.children ?? []).find((child): child is NativeElementNode => child.kind === "element" && child.tag === "canvas" && child.attrs?.["data-native-particles"] !== undefined);
  if (!canvas) return undefined;
  const buffers: string[] = [];
  const collectBuffers = (child: NativeNode): void => {
    if (child.kind === "fragment") { child.children.forEach(collectBuffers); return; }
    if (child.kind !== "element") return;
    const buffer = child.attrs?.["data-native-particle-buffer"];
    if (typeof buffer === "string") buffers.push(buffer);
    else (child.children ?? []).forEach(collectBuffers);
  };
  (node.children ?? []).forEach(collectBuffers);
  const circles = buffers.flatMap((buffer) => {
    return buffer.split(";").filter(Boolean).flatMap((entry): NativeElementNode[] => {
      const values = entry.split(",").map(Number);
      if ((values.length !== 3 && values.length !== 6) || values.some((value) => !Number.isFinite(value))) return [];
      const [cx, cy, rawRadius] = values;
      const radius = Math.max(1, Math.min(24, rawRadius));
      const tone = values.length === 6 ? PARTICLE_TONES[values[3]] ?? PARTICLE_TONES[0] : PARTICLE_TONES[0];
      const opacity = values.length === 6 ? values[4] : 1;
      const glow = values.length === 6 ? values[5] : 0;
      return [{
        kind: "element",
        tag: "circle",
        attrs: {
          cx, cy, r: radius,
          "fill-opacity": opacity,
          ...(glow > 1 ? { "stroke-width": radius * (glow - 1) * 2, "stroke-opacity": opacity * 0.2 } : {}),
          "data-native-tone": tone,
          "data-native-component": "particle",
        },
        children: [],
      }];
    });
  });
  if (!circles.length) return undefined;
  let visibleCount = Math.min(circles.length, maxSceneObjects);
  while (visibleCount > 0 && visibleCount + Math.ceil(visibleCount / 64) - buffers.length > maxExpansion) visibleCount -= 1;
  const visibleCircles = circles.slice(0, visibleCount);
  const groups: NativeElementNode[] = [];
  for (let index = 0; index < visibleCircles.length; index += 64) groups.push({ kind: "element", tag: "g", children: visibleCircles.slice(index, index + 64) });
  return {
    expansion: visibleCircles.length + groups.length - buffers.length,
    sceneObjects: visibleCircles.length,
    source: canvas,
    node: {
      kind: "element",
      tag: "svg",
      attrs: {
        viewbox: `0 0 ${String(canvas.attrs?.width ?? 800)} ${String(canvas.attrs?.height ?? 450)}`,
        role: "img",
        "aria-label": String(canvas.attrs?.["aria-label"] ?? "Static particle snapshot"),
        "data-native-component": "particle-snapshot",
      },
      children: groups,
    },
  };
};

export const projectStaticFallback = (input: unknown, profile: ResourceProfile): NativeStaticFrameV1 => {
  const frame = validateFrame(input, profile);
  let remainingExpansion = profile.maxNodes - nodeCount(frame.root);
  let remainingSceneObjects = profile.maxSceneObjects - sceneObjectCount(frame.root);
  const project = (node: NativeNode): NativeNode | undefined => {
    if (node.kind === "text") return { ...node };
    if (node.kind === "fragment") return { ...node, children: node.children.map(project).filter((child): child is NativeNode => Boolean(child)) };
    const snapshot = particleSnapshot(node, remainingExpansion, remainingSceneObjects);
    if (snapshot) {
      remainingExpansion -= snapshot.expansion;
      remainingSceneObjects -= snapshot.sceneObjects;
      const attrs = Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([key]) => !["tabindex", "href", "role", "data-article-slug"].includes(key)));
      return {
        kind: "element",
        tag: node.tag,
        ...(Object.keys(attrs).length ? { attrs } : {}),
        children: (node.children ?? []).map((child) => child === snapshot.source ? snapshot.node : project(child)).filter((child): child is NativeNode => Boolean(child)),
      };
    }
    if (node.attrs?.["data-native-particle-buffer"] !== undefined) return undefined;
    if (node.tag === "button") return undefined;
    if (node.tag === "canvas") {
      const description = String(node.attrs?.["aria-label"] ?? "Simulation visualization");
      return { kind: "element", tag: "div", attrs: { "data-native-component": "static-scene", "aria-label": description }, children: [
        { kind: "element", tag: "strong", children: [{ kind: "text", value: description }] },
        { kind: "element", tag: "p", children: [{ kind: "text", value: "Visual objects are described in the accompanying semantic data for this non-animated view." }] },
      ] };
    }
    if (node.tag === "img") return { kind: "element", tag: "div", attrs: { "data-native-component": "static-image", "aria-label": String(node.attrs?.["aria-label"] ?? "Reviewed image") }, children: [{ kind: "text", value: String(node.attrs?.["aria-label"] ?? "Reviewed image") }] };
    if (node.tag === "input" || node.tag === "select") {
      const label = String(node.attrs?.["aria-label"] ?? "Value");
      const rawValue = String(node.props?.value ?? node.attrs?.value ?? node.props?.checked ?? "");
      const selectedOption = node.tag === "select"
        ? (node.children ?? []).find((child) => child.kind === "element" && child.tag === "option" && (child.props?.selected === true || String(child.attrs?.value ?? "") === rawValue))
        : undefined;
      const value = selectedOption ? nodeText(selectedOption).trim() || rawValue : rawValue;
      return {
        kind: "element",
        tag: "div",
        attrs: { "data-native-component": "static-value" },
        children: [
          { kind: "element", tag: "span", children: [{ kind: "text", value: `${label}: ` }] },
          { kind: "element", tag: "strong", children: [{ kind: "text", value }] },
        ],
      };
    }
    if (node.tag === "option") return undefined;
    const attrs = Object.fromEntries(Object.entries(node.attrs ?? {}).filter(([key]) => !["tabindex", "href", "role", "data-article-slug"].includes(key)));
    const projected: NativeElementNode = {
      kind: "element",
      tag: node.tag === "a" ? "span" : INTERACTIVE.has(node.tag) ? "div" : node.tag,
      ...(Object.keys(attrs).length ? { attrs } : {}),
      children: (node.children ?? []).map(project).filter((child): child is NativeNode => Boolean(child)),
    };
    return projected;
  };
  const fallback = { version: 1 as const, root: project(frame.root) ?? { kind: "text" as const, value: "Interactive content unavailable." } };
  return validateStaticFrame(fallback, profile);
};
