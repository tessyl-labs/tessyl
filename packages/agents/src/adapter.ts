import type {
  EffectContinuation,
  EffectHandler,
} from "@voyd-lang/js-host";

export const LLM_ADAPTER_ABI_VERSION = 2 as const;
export const LLM_EFFECT_ID = "tessyl.agents.llm.v2" as const;
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
  parameters: LlmShape;
  strict: boolean;
};

export type LlmShape = {
  root: LlmShapeNode;
  definitions: LlmShapeDefinition[];
};

export type LlmShapeDefinition = {
  key: string;
  name: string;
  shape: LlmShapeNode;
  documentation?: string;
};

export type LlmShapeField = {
  name: string;
  shape: LlmShapeNode;
  optional: boolean;
  documentation?: string;
};

export type LlmShapeVariant = {
  name: string;
  documentation?: string;
  fields: LlmShapeField[];
};

export type LlmShapeNode =
  | { tag: "BoolShape" }
  | { tag: "I32Shape" }
  | { tag: "I64Shape" }
  | { tag: "F32Shape" }
  | { tag: "F64Shape" }
  | { tag: "StringShape" }
  | { tag: "UnitShape" }
  | { tag: "ArrayShape"; element: LlmShapeNode }
  | {
    tag: "RecordShape";
    name: string;
    documentation?: string;
    fields: LlmShapeField[];
  }
  | {
    tag: "UnionShape";
    name: string;
    documentation?: string;
    variants: LlmShapeVariant[];
  }
  | { tag: "RefShape"; key: string };

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
        decodeModelRequest(payload),
        adapterContext(continuation),
      ))),
    [LLM_HANDLER_KEYS.openStream]: async (continuation, payload) =>
      continuation.tail(toWire(await adapter.openStream(
        decodeModelRequest(payload),
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

const decodeModelRequest = (payload: unknown): LlmModelRequest => {
  const request = fromWire(payload);
  if (!isRecord(request) || !Array.isArray(request.tools)) {
    throw new Error("Invalid LLM request payload");
  }
  const tools = request.tools.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.name !== "string" ||
      typeof value.parameters_shape !== "string"
    ) {
      throw new Error("Invalid LLM tool definition payload");
    }
    const { parameters_shape: serializedShape, ...definition } = value;
    return {
      ...definition,
      parameters: parseShape(serializedShape, value.name),
    } as LlmToolDefinition;
  });
  return { ...request, tools } as LlmModelRequest;
};

const parseShape = (source: string, toolName: string): LlmShape => {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`Tool ${toolName} has an invalid serialized Shape`);
  }
  if (!isShape(value)) {
    throw new Error(`Tool ${toolName} has an invalid serialized Shape`);
  }
  return value;
};

const isShape = (value: unknown): value is LlmShape =>
  isRecord(value) &&
  isShapeNode(value.root, 0) &&
  Array.isArray(value.definitions) &&
  value.definitions.every((definition) =>
    isRecord(definition) &&
    typeof definition.key === "string" &&
    typeof definition.name === "string" &&
    optionalString(definition.documentation) &&
    isShapeNode(definition.shape, 0)
  );

const isShapeNode = (value: unknown, depth: number): value is LlmShapeNode => {
  if (!isRecord(value) || typeof value.tag !== "string" || depth > 100) {
    return false;
  }
  switch (value.tag) {
    case "BoolShape":
    case "I32Shape":
    case "I64Shape":
    case "F32Shape":
    case "F64Shape":
    case "StringShape":
    case "UnitShape":
      return true;
    case "ArrayShape":
      return isShapeNode(value.element, depth + 1);
    case "RecordShape":
      return typeof value.name === "string" &&
        optionalString(value.documentation) &&
        isShapeFields(value.fields, depth + 1);
    case "UnionShape":
      return typeof value.name === "string" &&
        optionalString(value.documentation) &&
        Array.isArray(value.variants) &&
        value.variants.every((variant) =>
          isRecord(variant) &&
          typeof variant.name === "string" &&
          optionalString(variant.documentation) &&
          isShapeFields(variant.fields, depth + 1)
        );
    case "RefShape":
      return typeof value.key === "string";
    default:
      return false;
  }
};

const isShapeFields = (value: unknown, depth: number): value is LlmShapeField[] =>
  Array.isArray(value) && value.every((field) =>
    isRecord(field) &&
    typeof field.name === "string" &&
    typeof field.optional === "boolean" &&
    optionalString(field.documentation) &&
    isShapeNode(field.shape, depth + 1)
  );

const optionalString = (value: unknown): boolean =>
  value === undefined || typeof value === "string";

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
