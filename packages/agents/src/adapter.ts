import type {
  EffectContinuation,
  EffectHandler,
} from "@voyd-lang/js-host";

export const LLM_ADAPTER_ABI_VERSION = 1 as const;
export const LLM_EFFECT_ID = "tessyl.agents.llm.v1" as const;
export const LLM_HANDLER_KEYS = {
  respond: `${LLM_EFFECT_ID}::respond`,
  openStream: `${LLM_EFFECT_ID}::open_stream`,
  nextStream: `${LLM_EFFECT_ID}::next_stream`,
} as const;

export type LlmRole = { tag: "User" | "Assistant" | "System" };

export type LlmInputItem =
  | { tag: "Message"; role: LlmRole; content: string }
  | { tag: "ToolCall"; call_id: string; name: string; arguments: string }
  | { tag: "ToolOutput"; call_id: string; output: string };

export type LlmToolDefinition = {
  name: string;
  description: string;
  parameters_json: string;
  strict: boolean;
};

export type LlmModelRequest = {
  model: string;
  instructions: string;
  input: LlmInputItem[];
  input_delta: LlmInputItem[];
  tools: LlmToolDefinition[];
  continuation_token?: string | null;
};

export type LlmUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type LlmModelOutput =
  | { tag: "Text"; text: string }
  | { tag: "ToolCall"; call_id: string; name: string; arguments: string };

export type LlmModelResponse = {
  id: string;
  continuation_token?: string | null;
  output: LlmModelOutput[];
  usage: LlmUsage;
};

export type LlmError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type LlmResult =
  | { tag: "LlmSucceeded"; response: LlmModelResponse }
  | { tag: "LlmFailed"; error: LlmError };

export type LlmStreamEvent =
  | { tag: "Started"; response_id: string }
  | { tag: "TextDelta"; delta: string };

export type LlmStreamStep =
  | { tag: "Event"; cursor: string; event: LlmStreamEvent }
  | { tag: "Done"; response: LlmModelResponse };

export type LlmStreamResult =
  | { tag: "StreamSucceeded"; step: LlmStreamStep }
  | { tag: "StreamFailed"; error: LlmError };

export type LlmAdapterContext = {
  registerResourceCleanup: (cleanup: () => void | Promise<void>) => void;
};

export type LlmAdapter = {
  abiVersion: typeof LLM_ADAPTER_ABI_VERSION;
  respond: (
    request: LlmModelRequest,
    context: LlmAdapterContext,
  ) => LlmResult | Promise<LlmResult>;
  openStream: (
    request: LlmModelRequest,
    context: LlmAdapterContext,
  ) => LlmStreamResult | Promise<LlmStreamResult>;
  nextStream: (
    cursor: string,
    context: LlmAdapterContext,
  ) => LlmStreamResult | Promise<LlmStreamResult>;
};

export type LlmEffectHandlers = {
  [LLM_HANDLER_KEYS.respond]: EffectHandler<[unknown], unknown>;
  [LLM_HANDLER_KEYS.openStream]: EffectHandler<[unknown], unknown>;
  [LLM_HANDLER_KEYS.nextStream]: EffectHandler<[unknown], unknown>;
};

/**
 * Converts a typed provider implementation into the raw MessagePack handlers
 * used by the Voyd `Llm` effect. This is the versioned adapter ABI boundary.
 */
export const defineLlmHandlers = (adapter: LlmAdapter): LlmEffectHandlers => {
  if (adapter.abiVersion !== LLM_ADAPTER_ABI_VERSION) {
    throw new Error(
      `Unsupported LLM adapter ABI ${String(adapter.abiVersion)}; expected ${LLM_ADAPTER_ABI_VERSION}`,
    );
  }
  return {
    [LLM_HANDLER_KEYS.respond]: async (continuation, payload) =>
      continuation.tail(toWire(await adapter.respond(
        fromWire(payload) as LlmModelRequest,
        adapterContext(continuation),
      ))),
    [LLM_HANDLER_KEYS.openStream]: async (continuation, payload) =>
      continuation.tail(toWire(await adapter.openStream(
        fromWire(payload) as LlmModelRequest,
        adapterContext(continuation),
      ))),
    [LLM_HANDLER_KEYS.nextStream]: async (continuation, payload) =>
      continuation.tail(toWire(await adapter.nextStream(
        fromWire(payload) as string,
        adapterContext(continuation),
      ))),
  };
};

const adapterContext = (continuation: EffectContinuation): LlmAdapterContext => ({
  registerResourceCleanup: (cleanup) =>
    continuation.registerResourceCleanup?.(cleanup),
});

const fromWire = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(fromWire);
  if (!isRecord(value)) return value;

  const variant = value.$variant;
  if (variant === "None") return undefined;
  if (variant === "Some") return fromWire(value.value);

  return Object.fromEntries([
    ...(typeof variant === "string" ? [["tag", variant] as const] : []),
    ...Object.entries(value)
      .filter(([key]) => key !== "$variant")
      .map(([key, field]) => [key, fromWire(field)] as const),
  ]);
};

const toWire = (value: unknown): unknown => {
  if (value === undefined || value === null) return { $variant: "None" };
  if (Array.isArray(value)) return value.map(toWire);
  if (!isRecord(value)) return value;

  const tag = value.tag;
  return Object.fromEntries([
    ...(typeof tag === "string" ? [["$variant", tag] as const] : []),
    ...Object.entries(value)
      .filter(([key]) => key !== "tag")
      .map(([key, field]) => [
        key,
        key === "continuation_token"
          ? field === undefined || field === null
            ? { $variant: "None" }
            : { $variant: "Some", value: toWire(field) }
          : toWire(field),
      ] as const),
  ]);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
