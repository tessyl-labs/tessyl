import { STANDARD_V1 } from "../profiles.js";

export const RENDER_POLICY = Object.freeze({
  version: 1,
  tags: [
    "div", "section", "article", "header", "footer", "main", "aside", "p", "span", "strong", "em", "code", "pre", "output",
    "h2", "h3", "h4", "h5", "h6", "hr", "a", "button", "label", "input", "select", "option", "table", "caption",
    "thead", "tbody", "tr", "th", "td", "dl", "dt", "dd", "ul", "ol", "li", "figure", "figcaption", "svg", "g", "path",
    "line", "polyline", "polygon", "circle", "rect", "text", "canvas", "img",
  ],
  voidTags: ["hr", "input", "line", "circle", "rect", "path", "polyline", "polygon", "img"],
  globalAttributes: [
    "aria-label", "aria-describedby", "aria-live", "aria-invalid", "aria-valuemin", "aria-valuemax", "aria-valuenow", "role",
    "title", "data-native-component", "data-article-slug", "aria-hidden", "tabindex", "data-native-gap", "data-native-align",
    "data-native-width", "data-native-wrap", "data-native-columns", "data-native-tone", "data-native-padding", "data-native-size",
    "data-native-weight", "data-native-width-px", "data-native-language", "data-native-display", "data-native-series",
    "data-native-scene", "data-native-particles", "data-native-description", "data-native-announcement", "data-native-math-source",
    "aria-roledescription", "data-native-asset-id", "data-native-particle-buffer", "data-native-interactive-gestures",
  ],
  tagAttributes: {
    input: ["type", "min", "max", "step", "value", "checked", "disabled", "maxlength", "placeholder"],
    button: ["type", "disabled"], select: ["value", "disabled"], option: ["value", "selected"],
    th: ["scope", "colspan", "rowspan"], td: ["colspan", "rowspan"], svg: ["viewbox", "x", "y", "width", "height", "aria-hidden"],
    path: ["d"], line: ["x1", "x2", "y1", "y2"], polyline: ["points"], circle: ["cx", "cy", "r"],
    polygon: ["points"], rect: ["x", "y", "width", "height", "rx"], text: ["x", "y", "text-anchor"], canvas: ["width", "height"],
  },
  events: ["click", "input", "change", "keydown", "keyup", "pointerdown", "pointermove", "pointerup", "pointercancel", "mouseenter", "mouseleave", "wheel", "focus", "blur"],
  safeInputTypes: ["button", "number", "range", "text", "checkbox"],
  limits: {
    maxNodes: STANDARD_V1.maxNodes,
    maxDepth: STANDARD_V1.maxDepth,
    maxChildren: STANDARD_V1.maxChildren,
    maxAttributes: STANDARD_V1.maxAttributes,
    maxStringBytes: STANDARD_V1.maxStringBytes,
    maxFrameBytes: STANDARD_V1.maxFrameBytes,
    maxBoundaryBytes: STANDARD_V1.maxBoundaryBytes,
    maxHandlers: STANDARD_V1.maxHandlers,
    maxSceneObjects: STANDARD_V1.maxSceneObjects,
  },
} as const);
