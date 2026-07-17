import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

class VoydCompilationError extends Error {}

export function compilationError(diagnostics) {
  return new VoydCompilationError(diagnostics.map(formatDiagnostic).join("\n"));
}

export function errorMessage(error) {
  if (error instanceof VoydCompilationError) return error.message;
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

export function formatDiagnostic(diagnostic) {
  const context = sourceContext(diagnostic.span);
  const location = context
    ? context.path + ":" + context.line + ":" + context.column
    : fallbackLocation(diagnostic.span);
  const phase = diagnostic.phase ? " [" + diagnostic.phase + "]" : "";
  const header = location + " " + diagnostic.severity.toUpperCase() + phase +
    " " + diagnostic.code + ": " + diagnostic.message;
  if (!context) return header;

  const gutter = String(context.line);
  const padding = " ".repeat(gutter.length);
  const marker = " ".repeat(context.column - 1) + "^".repeat(context.length);
  return [
    header,
    padding + " |",
    gutter + " | " + context.text,
    padding + " | " + marker,
  ].join("\n");
}

function sourceContext(span) {
  if (!span) return;
  const path = isAbsolute(span.file) ? span.file : resolve(span.file);
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    return;
  }

  const start = clamp(span.start, source.length);
  const end = clamp(Math.max(span.end, start + 1), source.length);
  const lineStart = source.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextLine = source.indexOf("\n", start);
  const lineEnd = nextLine < 0 ? source.length : nextLine;
  return {
    path,
    line: source.slice(0, lineStart).split("\n").length,
    column: start - lineStart + 1,
    length: Math.max(1, Math.min(end, lineEnd) - start),
    text: source.slice(lineStart, lineEnd),
  };
}

function fallbackLocation(span) {
  if (!span) return "voyd";
  const path = isAbsolute(span.file) ? span.file : resolve(span.file);
  return path + ":" + span.start + "-" + span.end;
}

function clamp(value, max) {
  return Math.max(0, Math.min(value, max));
}
