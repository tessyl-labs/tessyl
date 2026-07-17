export type NativeErrorCode =
  | "unsupported_version"
  | "invalid_artifact"
  | "resource_limit"
  | "timeout"
  | "trap"
  | "protocol_violation"
  | "disposed"
  | "configuration"
  | "compile_failed";

export class TessylNativeError extends Error {
  readonly code: NativeErrorCode;
  readonly phase: "configuration" | "compile" | "initialize" | "run";
  readonly recoverable: boolean;

  constructor(options: {
    code: NativeErrorCode;
    phase: TessylNativeError["phase"];
    message: string;
    recoverable?: boolean;
    cause?: unknown;
  }) {
    super(options.message.slice(0, 240), { cause: options.cause });
    this.name = "TessylNativeError";
    this.code = options.code;
    this.phase = options.phase;
    this.recoverable = options.recoverable ?? false;
  }
}
