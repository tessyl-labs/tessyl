import type { TfmDiagnostic, TfmSpan } from "./types.js";

type Point = { line?: number; column?: number; offset?: number };
type Position = { start?: Point; end?: Point };
type MdNode = {
  type: string;
  name?: string;
  children?: MdNode[];
  position?: Position;
};

type ParsedDirective = {
  start: number;
  end: number;
  type: "leafDirective" | "containerDirective" | "textDirective";
};

/**
 * Validates directive syntax using Remark's parsed directive positions. This
 * keeps fence checks aligned with CommonMark block quote/list prefix handling,
 * while a small lexical pass catches directive-looking lines Remark rejected.
 */
export const validateDirectiveSyntax = (
  source: string,
  root: MdNode,
  limits: { maxAttributeCount: number; maxAttributeLength: number },
  report: (diagnostic: TfmDiagnostic) => void,
): void => {
  const parsed = new Map<number, ParsedDirective>();
  const closingOffsets = new Set<number>();
  const codeRanges: Array<{ start: number; end: number }> = [];
  const pending: Array<{ node: MdNode; parentFence?: number }> = [{ node: root }];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    const { node, parentFence } = current;
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    let childParentFence = parentFence;

    if (node.type === "code" && start !== undefined && end !== undefined) {
      codeRanges.push({ start, end });
    }

    if (isDirective(node) && start !== undefined && end !== undefined) {
      parsed.set(start, { start, end, type: node.type });
      const fenceLength = colonRunAt(source, start);
      validateRawAttributes(source, start, node, limits, report);
      if (node.type === "leafDirective") {
        const lineEnd = source.indexOf("\n", end);
        const trailing = source.slice(end, lineEnd === -1 ? source.length : lineEnd);
        if (fenceLength !== 2 || trailing.trim().length > 0) {
          report(diagnostic(
            "TFM_MALFORMED_DIRECTIVE",
            "Leaf directives must use exactly two colons and occupy a complete block line.",
            spanOf(node),
          ));
        }
      } else if (node.type === "containerDirective") {
        childParentFence = fenceLength;
        if (parentFence !== undefined && fenceLength >= parentFence) {
          report(diagnostic(
            "TFM_INVALID_NESTED_FENCE",
            `Nested container ${node.name ?? "(unnamed)"} must use fewer colons than its outer container.`,
            spanOf(node),
          ));
        }
        const closing = closingFenceAtEnd(source, end, node.position?.end?.line ?? 1);
        const childContentEnd = Math.max(
          start,
          ...(node.children ?? []).map((child) => child.position?.end?.offset ?? start),
        );
        const parserRecognizedClosing = closing !== undefined && closing.offset >= childContentEnd;
        const sameContextMismatch = closing !== undefined &&
          !parserRecognizedClosing &&
          closing.length < fenceLength &&
          closing.column === (node.position?.start?.column ?? 1);
        if (!parserRecognizedClosing && !sameContextMismatch) {
          report(diagnostic(
            "TFM_UNCLOSED_CONTAINER",
            `Container ${node.name ?? "(unnamed)"} is missing a closing fence.`,
            spanOf(node),
          ));
        } else if (closing) {
          closingOffsets.add(closing.offset);
          if (closing.length < fenceLength) {
            report(diagnostic(
              "TFM_MISMATCHED_CONTAINER_FENCE",
              `Closing fence for ${node.name ?? "(unnamed)"} must contain at least ${fenceLength} colons.`,
              closing.span,
            ));
          }
        }
      }
    }

    for (const child of node.children ?? []) {
      pending.push({ node: child, parentFence: childParentFence });
    }
  }

  scanRejectedDirectiveLines(source, parsed, closingOffsets, codeRanges, report);
};

const validateRawAttributes = (
  source: string,
  start: number,
  node: MdNode,
  limits: { maxAttributeCount: number; maxAttributeLength: number },
  report: (diagnostic: TfmDiagnostic) => void,
): void => {
  if (node.type === "textDirective") return;
  const lineEnd = source.indexOf("\n", start);
  const opener = source.slice(start, lineEnd === -1 ? source.length : lineEnd);
  const attributeEnd = opener.lastIndexOf("}");
  const attributeStart = findAttributeStart(opener, attributeEnd);
  if (attributeStart === -1 || attributeEnd <= attributeStart) return;
  const body = opener.slice(attributeStart + 1, attributeEnd);
  const occurrences = rawAttributeOccurrences(body);
  if (occurrences.length > limits.maxAttributeCount) {
    report(diagnostic(
      "TFM_ATTRIBUTE_COUNT_LIMIT",
      `Directive has more than ${limits.maxAttributeCount} attribute occurrences.`,
      spanOf(node),
    ));
  }
  for (const { name, value } of occurrences) {
    if (name.length > limits.maxAttributeLength || value.length > limits.maxAttributeLength) {
      report(diagnostic(
        "TFM_ATTRIBUTE_LENGTH_LIMIT",
        `Attribute ${name.slice(0, 64)} exceeds the ${limits.maxAttributeLength} character limit.`,
        spanOf(node),
      ));
    }
  }
};

const findAttributeStart = (opener: string, end: number): number => {
  let quote: "\"" | "'" | undefined;
  let bracketDepth = 0;
  let candidate = -1;
  for (let index = 0; index < end; index += 1) {
    const char = opener[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]" && bracketDepth > 0) {
      bracketDepth -= 1;
    } else if (char === "{" && bracketDepth === 0) {
      candidate = index;
    }
  }
  return candidate;
};

const rawAttributeOccurrences = (body: string): Array<{ name: string; value: string }> => {
  const occurrences: Array<{ name: string; value: string }> = [];
  let index = 0;
  while (index < body.length) {
    while (/\s/.test(body[index] ?? "")) index += 1;
    if (!/[A-Za-z_:]/.test(body[index] ?? "")) {
      index += 1;
      continue;
    }
    const nameStart = index;
    while (/[\w:.-]/.test(body[index] ?? "")) index += 1;
    const name = body.slice(nameStart, index);
    while (/\s/.test(body[index] ?? "")) index += 1;
    let value = "";
    if (body[index] === "=") {
      index += 1;
      while (/\s/.test(body[index] ?? "")) index += 1;
      const quote = body[index] === "\"" || body[index] === "'" ? body[index] : undefined;
      if (quote) {
        index += 1;
        const valueStart = index;
        while (index < body.length && body[index] !== quote) {
          if (body[index] === "\\" && index + 1 < body.length) index += 2;
          else index += 1;
        }
        value = body.slice(valueStart, index);
        if (body[index] === quote) index += 1;
      } else {
        const valueStart = index;
        while (index < body.length && !/\s/.test(body[index] ?? "")) index += 1;
        value = body.slice(valueStart, index);
      }
    }
    occurrences.push({ name, value });
  }
  return occurrences;
};

const scanRejectedDirectiveLines = (
  source: string,
  parsed: ReadonlyMap<number, ParsedDirective>,
  closingOffsets: ReadonlySet<number>,
  codeRanges: readonly { start: number; end: number }[],
  report: (diagnostic: TfmDiagnostic) => void,
): void => {
  const lines = source.split(/(?<=\n)/);
  let sourceOffset = 0;
  const sortedCodeRanges = [...codeRanges].sort((left, right) => left.start - right.start);
  let codeRangeIndex = 0;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex] ?? "";
    const line = rawLine.replace(/\r?\n$/, "");
    const stripped = stripMarkdownPrefixes(line);
    while (sortedCodeRanges[codeRangeIndex]?.end <= sourceOffset) codeRangeIndex += 1;
    const codeRange = sortedCodeRanges[codeRangeIndex];
    if (codeRange && sourceOffset < codeRange.end && sourceOffset + rawLine.length > codeRange.start) {
      sourceOffset += rawLine.length;
      continue;
    }

    const absoluteStart = sourceOffset + stripped.offset;
    const closer = /^(:{3,})\s*$/.exec(stripped.content);
    if (closer) {
      if (!closingOffsets.has(absoluteStart)) {
        report(diagnostic(
          "TFM_UNEXPECTED_CONTAINER_CLOSE",
          "Container closing fence has no matching opener.",
          lineSpan(absoluteStart, (closer[1] ?? "").length, lineIndex, stripped.offset),
        ));
      }
      sourceOffset += rawLine.length;
      continue;
    }

    const fence = /^:{2,}/.exec(stripped.content);
    if (fence && !parsed.has(absoluteStart)) {
      report(diagnostic(
        "TFM_MALFORMED_DIRECTIVE",
        "Directive-looking content is not valid TFM directive syntax.",
        lineSpan(absoluteStart, line.length - stripped.offset, lineIndex, stripped.offset),
      ));
      sourceOffset += rawLine.length;
      continue;
    }

    const candidate = /^(:)([A-Za-z][\w-]*)/.exec(stripped.content);
    if (candidate && !parsed.has(absoluteStart)) {
      const colonCount = (candidate[1] ?? "").length;
      report(diagnostic(
        colonCount === 1 ? "TFM_UNSUPPORTED_INLINE_DIRECTIVE" : "TFM_MALFORMED_DIRECTIVE",
        colonCount === 1
          ? "Single-colon inline directives are not supported in TFM v1."
          : "Directive-looking content is not valid TFM directive syntax.",
        lineSpan(absoluteStart, line.length - stripped.offset, lineIndex, stripped.offset),
      ));
    }
    sourceOffset += rawLine.length;
  }
};

const closingFenceAtEnd = (
  source: string,
  end: number,
  endLine: number,
): { length: number; offset: number; column: number; span: TfmSpan } | undefined => {
  const lineStart = source.lastIndexOf("\n", Math.max(0, end - 1)) + 1;
  const physicalLine = source.slice(lineStart, end).replace(/\r$/, "");
  const stripped = stripMarkdownPrefixes(physicalLine);
  const match = /^(:{3,})\s*$/.exec(stripped.content);
  if (!match) return undefined;
  const offset = lineStart + stripped.offset;
  const length = (match[1] ?? "").length;
  return {
    length,
    offset,
    column: stripped.offset + 1,
    span: {
      start: offset,
      end: offset + length,
      startLine: endLine,
      startColumn: stripped.offset + 1,
      endLine,
      endColumn: stripped.offset + length + 1,
    },
  };
};

const stripMarkdownPrefixes = (line: string): { content: string; offset: number } => {
  let offset = 0;
  while (offset < line.length) {
    const before = offset;
    let spaces = 0;
    while (spaces < 3 && line[offset] === " ") {
      offset += 1;
      spaces += 1;
    }
    if (line[offset] === ">") {
      offset += 1;
      if (line[offset] === " ") offset += 1;
      continue;
    }
    const list = /^(?:[-+*]|\d{1,9}[.)])([ \t]+)/.exec(line.slice(offset));
    if (list) {
      offset += (list[0] ?? "").length;
      continue;
    }
    if (offset === before) break;
    return { content: line.slice(offset), offset };
  }
  return { content: line.slice(offset), offset };
};

const isDirective = (node: MdNode): node is MdNode & {
  type: "leafDirective" | "containerDirective" | "textDirective";
} => node.type === "leafDirective" || node.type === "containerDirective" || node.type === "textDirective";

const colonRunAt = (source: string, offset: number): number => /^:+/.exec(source.slice(offset))?.[0].length ?? 0;

const spanOf = (node: MdNode): TfmSpan => {
  const start = node.position?.start;
  const end = node.position?.end;
  return {
    start: start?.offset ?? 0,
    end: end?.offset ?? start?.offset ?? 0,
    startLine: start?.line ?? 1,
    startColumn: start?.column ?? 1,
    endLine: end?.line ?? start?.line ?? 1,
    endColumn: end?.column ?? start?.column ?? 1,
  };
};

const lineSpan = (
  start: number,
  length: number,
  zeroBasedLine: number,
  zeroBasedColumn: number,
): TfmSpan => ({
  start,
  end: start + length,
  startLine: zeroBasedLine + 1,
  startColumn: zeroBasedColumn + 1,
  endLine: zeroBasedLine + 1,
  endColumn: zeroBasedColumn + length + 1,
});

const diagnostic = (code: string, message: string, span: TfmSpan): TfmDiagnostic => ({
  code,
  severity: "error",
  message,
  span,
});
