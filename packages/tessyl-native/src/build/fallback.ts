import type { NativeElementNode, NativeFrameV1, NativeNode, NativeStaticFrameV1 } from "../types.js";
import type { ResourceProfile } from "../profiles.js";
import { validateFrame, validateStaticFrame } from "../protocol/validate.js";

const INTERACTIVE = new Set(["button", "input", "select", "option", "a"]);
const nodeText = (node: NativeNode): string => node.kind === "text"
  ? node.value
  : (node.kind === "fragment" ? node.children : node.children ?? []).map(nodeText).join("");

export const projectStaticFallback = (input: unknown, profile: ResourceProfile): NativeStaticFrameV1 => {
  const frame = validateFrame(input, profile);
  const project = (node: NativeNode): NativeNode | undefined => {
    if (node.kind === "text") return { ...node };
    if (node.kind === "fragment") return { ...node, children: node.children.map(project).filter((child): child is NativeNode => Boolean(child)) };
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
