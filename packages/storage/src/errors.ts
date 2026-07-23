import type { StorageErrorCode } from "./contracts.js";

const RETRYABLE_CODES = new Set<StorageErrorCode>(["unavailable", "timeout", "internal"]);

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly retryable: boolean;
  readonly operation: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: StorageErrorCode, message: string, options: {
    retryable?: boolean;
    operation?: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  } = {}) {
    super(message, { cause: options.cause });
    this.name = "StorageError";
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code);
    this.operation = options.operation ?? "storage";
    this.details = Object.freeze({ ...(options.details ?? {}) });
  }

}

export const asStorageError = (error: unknown, operation: string): StorageError => {
  if (error instanceof StorageError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new StorageError("cancelled", "Operation was cancelled", { operation, cause: error, retryable: false });
  }
  if (error instanceof Error && /timeout/i.test(error.message)) {
    return new StorageError("timeout", "Storage operation timed out", { operation, cause: error });
  }
  return new StorageError("internal", "Storage backend failed", { operation, cause: error });
};
