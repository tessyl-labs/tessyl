const encoder = new TextEncoder();

export const canonicalJson = (value: unknown): string => {
  const seen = new Set<object>();
  const visit = (current: unknown): unknown => {
    if (current === null || typeof current !== "object") {
      if (typeof current === "number" && !Number.isFinite(current)) {
        throw new TypeError("canonical JSON rejects non-finite numbers");
      }
      return current;
    }
    if (seen.has(current)) throw new TypeError("canonical JSON rejects cycles");
    seen.add(current);
    try {
      if (Array.isArray(current)) return current.map(visit);
      if (current instanceof Uint8Array) return Array.from(current);
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, visit(entry)]),
      );
    } finally {
      seen.delete(current);
    }
  };
  return JSON.stringify(visit(value));
};

export const sha256 = async (value: Uint8Array | string): Promise<string> => {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const encodedJson = (value: unknown): Uint8Array => encoder.encode(canonicalJson(value));
