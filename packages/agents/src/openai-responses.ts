import {
  LLM_ADAPTER_ABI_VERSION,
  defineLlmHandlers,
  splitCompactionInput,
  type LlmAdapter,
  type LlmAdapterContext,
  type LlmCompactionRequest,
  type LlmCompactionResult,
  type LlmEffectHandlers,
  type LlmError,
  type LlmInputItem,
  type LlmModelOutput,
  type LlmModelRequest,
  type LlmModelResponse,
  type LlmResult,
  type LlmShape,
  type LlmShapeField,
  type LlmShapeNode,
  type LlmStreamResult,
  type LlmStreamStep,
  type LlmToolDefinition,
  type LlmUsage,
} from "./adapter.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_ERROR_BODY_CHARS = 8_192;
const OPENAI_PROVIDER_ITEM = "openai.responses";
const NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

type OpenAIResponse = {
  id?: unknown;
  status?: unknown;
  output?: unknown;
  usage?: unknown;
  error?: unknown;
  incomplete_details?: unknown;
};

type OpenAIEvent = {
  type?: unknown;
  code?: unknown;
  message?: unknown;
  delta?: unknown;
  response?: unknown;
  error?: unknown;
};

export type OpenAIResponsesOptions = {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  /** Provider label used in diagnostics. */
  providerName?: string;
  /** Prefix used for adapter-local streaming cursors. */
  streamCursorPrefix?: string;
  /**
   * Send `previous_response_id` and only the latest input delta on follow-up
   * turns. Disable this for OpenAI-compatible providers without stateful
   * Responses API support.
   */
  usePreviousResponseId?: boolean;
  /** Whether this provider supports POST /responses/compact. */
  supportsNativeCompaction?: boolean;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
};

export type OpenAIResponsesHandlers = LlmEffectHandlers;

type ActiveStream = {
  abort: AbortController;
  events: SseEvents;
  input: Record<string, unknown>[];
  replayBatches: ReplayBatch[];
  replayTokens: Set<string>;
  previousReplayToken?: string;
  usePreviousResponseId: boolean;
};

type ReplayBatch = { start: number; end: number };
type ReplayState = { items: Record<string, unknown>[]; batches: ReplayBatch[] };

type ResponsesRequestBody = Record<string, unknown> & {
  input: Record<string, unknown>[];
};

class ProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * Creates host handlers for the `Llm` Voyd effect using OpenAI's Responses API.
 * Each invocation owns its own stream registry, so handler sets are isolated.
 */
export const createOpenAIResponsesHandlers = (
  options: OpenAIResponsesOptions,
): OpenAIResponsesHandlers => defineLlmHandlers(createOpenAIResponsesAdapter(options));

export const createOpenAIResponsesAdapter = (
  options: OpenAIResponsesOptions,
): LlmAdapter => {
  if (!options.apiKey) {
    throw new Error("OpenAI apiKey is required");
  }
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new Error("A Fetch API implementation is required");
  }
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const providerName = options.providerName ?? "OpenAI";
  const streamCursorPrefix = options.streamCursorPrefix ?? "openai";
  const usePreviousResponseId = options.usePreviousResponseId ?? true;
  const supportsNativeCompaction = options.supportsNativeCompaction ?? true;
  const streams = new Map<string, ActiveStream>();
  const replays = new Map<string, ReplayState>();
  let nextCursor = 1;

  const respond: LlmAdapter["respond"] = async (
    request,
    context,
  ) => {
    const abort = requestAbort(context, providerName, options.timeoutMs);
    try {
      const body = requestBody(request, false, usePreviousResponseId, replays);
      const response = await fetchImplementation(`${baseUrl}/responses`, {
        method: "POST",
        headers: headers(options),
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      const payload = await responsePayload(response, providerName);
      if (!response.ok) {
        throw apiError(response.status, payload, providerName);
      }
      const mappedResponse = mapResponse(payload, usePreviousResponseId, providerName);
      const mapped = request.retain_continuation
        ? mappedResponse
        : { ...mappedResponse, continuation_token: null };
      rememberReplay(
        replays,
        replayInput(request, body.input, usePreviousResponseId, replays),
        replayBatches(request, replays),
        payload,
        mapped,
      );
      if (request.continuation_token) replays.delete(request.continuation_token);
      if (mapped.continuation_token) {
        const token = mapped.continuation_token;
        context.registerResourceCleanup(() => {
          replays.delete(token);
        });
      }
      return llmSuccess(mapped);
    } catch (error) {
      return llmFailure(toLlmError(error, providerName, abort.signal));
    } finally {
      abort.abort();
    }
  };

  const compactNative: NonNullable<LlmAdapter["compactNative"]> = async (request, context) => {
    const abort = requestAbort(context, providerName, options.timeoutMs);
    try {
      const result = await requestNativeCompaction(
        request,
        fetchImplementation,
        baseUrl,
        options,
        providerName,
        replays,
        abort.signal,
      );
      if (result.tag === "CompactionSucceeded" && request.continuation_token) {
        replays.delete(request.continuation_token);
      }
      return result;
    } catch (error) {
      return compactionFailure(toLlmError(error, providerName, abort.signal));
    } finally {
      abort.abort();
    }
  };

  const discardContinuation: NonNullable<LlmAdapter["discardContinuation"]> = (token) => {
    replays.delete(token);
  };

  const preparePortableCompaction: NonNullable<
    LlmAdapter["preparePortableCompaction"]
  > = (request, prefix, suffix) => {
    if (!request.continuation_token || !replays.has(request.continuation_token)) {
      return { prefix, suffix };
    }
    const nativeWindow = nativeCompactionWindow(request, prefix, suffix, replays);
    return {
      prefix: nativeWindow.prefix.map(portableReplayItem),
      suffix: nativeWindow.suffix,
    };
  };

  const openStream: LlmAdapter["openStream"] = async (
    request,
    context,
  ) => {
    const abort = requestAbort(context, providerName, options.timeoutMs);
    try {
      const body = requestBody(request, true, usePreviousResponseId, replays);
      const replay = replayInput(request, body.input, usePreviousResponseId, replays);
      const batches = replayBatches(request, replays);
      const response = await fetchImplementation(`${baseUrl}/responses`, {
        method: "POST",
        headers: headers(options),
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!response.ok) {
        throw apiError(
          response.status,
          await responsePayload(response, providerName),
          providerName,
        );
      }
      if (!response.body) {
        throw new ProviderError(
          "empty_stream",
          `${providerName} returned an empty response stream`,
        );
      }
      const cursor = `${streamCursorPrefix}-${nextCursor++}`;
      const replayTokens = new Set<string>();
      streams.set(cursor, {
        abort,
        events: new SseEvents(response.body.getReader(), providerName),
        input: replay,
        replayBatches: batches,
        replayTokens,
        previousReplayToken: request.continuation_token ?? undefined,
        usePreviousResponseId,
      });
      context.registerResourceCleanup(() => {
        closeStream(streams, cursor);
        replayTokens.forEach((token) => replays.delete(token));
      });
      return await readStreamStep(streams, replays, cursor, providerName);
    } catch (error) {
      const failure = toLlmError(error, providerName, abort.signal);
      abort.abort();
      return streamFailure(failure);
    }
  };

  const nextStream: LlmAdapter["nextStream"] = async (
    cursor,
  ) => {
    const signal = streams.get(cursor)?.abort.signal;
    try {
      return await readStreamStep(streams, replays, cursor, providerName);
    } catch (error) {
      closeStream(streams, cursor);
      return streamFailure(toLlmError(error, providerName, signal));
    }
  };

  return {
    abiVersion: LLM_ADAPTER_ABI_VERSION,
    respond,
    ...(supportsNativeCompaction ? { compactNative } : {}),
    discardContinuation,
    preparePortableCompaction,
    openStream,
    nextStream,
  };
};

const requestBody = (
  request: LlmModelRequest,
  stream: boolean,
  usePreviousResponseId: boolean,
  replays: Map<string, ReplayState>,
) => {
  const replay = !usePreviousResponseId && request.continuation_token
    ? replays.get(request.continuation_token)
    : undefined;
  const input = replay
    ? [...replay.items, ...request.input_delta.map(mapInput)]
    : (usePreviousResponseId && request.continuation_token
      ? request.input_delta
      : request.input).map(mapInput);
  const body: ResponsesRequestBody = {
    model: request.model,
    input,
    tools: request.tools.map(mapTool),
    stream,
  };
  if (request.instructions) body.instructions = request.instructions;
  if (request.max_output_tokens && request.max_output_tokens > 0) {
    body.max_output_tokens = request.max_output_tokens;
  }
  if (usePreviousResponseId && request.continuation_token) {
    body.previous_response_id = request.continuation_token;
  }
  return body;
};

const replayInput = (
  request: LlmModelRequest,
  sentInput: Record<string, unknown>[],
  usePreviousResponseId: boolean,
  replays: Map<string, ReplayState>,
): Record<string, unknown>[] => {
  if (!usePreviousResponseId || !request.continuation_token) return sentInput;
  const previous = replays.get(request.continuation_token);
  return previous ? [...previous.items, ...sentInput] : request.input.map(mapInput);
};

const replayBatches = (
  request: LlmModelRequest,
  replays: Map<string, ReplayState>,
): ReplayBatch[] => request.continuation_token
  ? [...(replays.get(request.continuation_token)?.batches ?? [])]
  : [];

const rememberReplay = (
  replays: Map<string, ReplayState>,
  input: Record<string, unknown>[],
  priorBatches: ReplayBatch[],
  value: unknown,
  response: LlmModelResponse,
): void => {
  if (!response.continuation_token || !isRecord(value) || !Array.isArray(value.output)) {
    return;
  }
  const output = value.output.filter(isRecord);
  replays.set(response.continuation_token, {
    items: [...input, ...output],
    batches: output.length === 0
      ? priorBatches
      : [...priorBatches, { start: input.length, end: input.length + output.length }],
  });
};

const requestNativeCompaction = async (
  request: LlmCompactionRequest,
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: string,
  options: OpenAIResponsesOptions,
  providerName: string,
  replays: Map<string, ReplayState>,
  signal: AbortSignal,
): Promise<LlmCompactionResult> => {
  const { prefix, suffix } = splitCompactionInput(
    request.input,
    request.compaction.keep_recent_items,
    Math.max(0, request.compaction.trigger_tokens * 2),
  );
  if (prefix.length === 0) {
    return compactionFailure({
      code: "compaction_not_possible",
      message: "The context does not contain a completed prefix that can be compacted",
      retryable: false,
    });
  }
  const nativeWindow = nativeCompactionWindow(request, prefix, suffix, replays);
  const response = await fetchImplementation(`${baseUrl}/responses/compact`, {
    method: "POST",
    headers: headers(options),
    body: JSON.stringify({ model: request.model, input: nativeWindow.prefix }),
    signal,
  });
  const payload = await responsePayload(response, providerName);
  if (!response.ok) throw apiError(response.status, payload, providerName);
  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new ProviderError(
      "invalid_compaction_response",
      `${providerName} compaction response is missing its output`,
    );
  }
  const compacted = payload.output.filter(isRecord).map((item) => ({
    tag: "ProviderItem" as const,
    provider: OPENAI_PROVIDER_ITEM,
    data: JSON.stringify(item),
  }));
  if (compacted.length === 0) {
    throw new ProviderError(
      "empty_compaction",
      `${providerName} returned an empty compacted context`,
    );
  }
  return compactionSuccess(
    [...compacted, ...nativeWindow.suffix],
    mapUsage(payload.usage),
  );
};

const nativeCompactionWindow = (
  request: LlmCompactionRequest,
  prefix: LlmInputItem[],
  suffix: LlmInputItem[],
  replays: Map<string, ReplayState>,
): { prefix: Record<string, unknown>[]; suffix: LlmInputItem[] } => {
  const replay = request.continuation_token
    ? replays.get(request.continuation_token)
    : undefined;
  if (!replay) return { prefix: prefix.map(mapInput), suffix };
  const complete = [...replay.items, ...request.input_delta.map(mapInput)];
  const protectedTail = protectCanonicalTail(complete, replay.batches, suffix);
  if (
    protectedTail &&
    JSON.stringify(protectedTail.suffix).length <=
      Math.max(0, request.compaction.trigger_tokens * 2)
  ) {
    return protectedTail;
  }
  if (protectedTail) return { prefix: complete, suffix: [] };
  return { prefix: prefix.map(mapInput), suffix };
};

const protectCanonicalTail = (
  input: Record<string, unknown>[],
  batches: ReplayBatch[],
  suffix: LlmInputItem[],
): { prefix: Record<string, unknown>[]; suffix: LlmInputItem[] } | undefined => {
  if (suffix.length === 0) return { prefix: input, suffix: [] };
  const matched = new Array<number>(suffix.length);
  let rawIndex = input.length - 1;
  for (let suffixIndex = suffix.length - 1; suffixIndex >= 0; suffixIndex -= 1) {
    while (rawIndex >= 0 && !rawItemMatches(input[rawIndex], suffix[suffixIndex]!)) {
      rawIndex -= 1;
    }
    if (rawIndex < 0) return undefined;
    matched[suffixIndex] = rawIndex;
    rawIndex -= 1;
  }
  let cut = matched[0]!;
  for (const batch of batches) {
    if (matched.some((index) => index >= batch.start && index < batch.end)) {
      cut = Math.min(cut, batch.start);
    }
  }
  const protectedSuffix: LlmInputItem[] = [];
  let suffixIndex = 0;
  for (let index = cut; index < input.length; index += 1) {
    if (matched[suffixIndex] === index) {
      protectedSuffix.push(suffix[suffixIndex]!);
      suffixIndex += 1;
    } else {
      protectedSuffix.push({
        tag: "ProviderItem",
        provider: OPENAI_PROVIDER_ITEM,
        data: JSON.stringify(input[index]),
      });
    }
  }
  return { prefix: input.slice(0, cut), suffix: protectedSuffix };
};

const rawItemMatches = (
  raw: Record<string, unknown> | undefined,
  item: LlmInputItem,
): boolean => {
  if (!raw) return false;
  switch (item.tag) {
    case "Message":
      if (raw.role === item.role.tag.toLowerCase() && raw.content === item.content) return true;
      return item.role.tag === "Assistant" && raw.type === "message" &&
        Array.isArray(raw.content) && raw.content
          .filter((content) => isRecord(content) && (
            content.type === "output_text" || content.type === "refusal"
          ))
          .map((content) => content.type === "refusal" ? content.refusal : content.text)
          .filter((text): text is string => typeof text === "string")
          .join("") === item.content;
    case "ToolCall":
      return raw.type === "function_call" && raw.call_id === item.call_id &&
        raw.name === item.name && raw.arguments === item.arguments;
    case "ToolOutput":
      return raw.type === "function_call_output" && raw.call_id === item.call_id &&
        raw.output === item.output;
    case "ProviderItem":
      try {
        return item.provider === OPENAI_PROVIDER_ITEM &&
          JSON.stringify(raw) === JSON.stringify(JSON.parse(item.data));
      } catch {
        return false;
      }
  }
};

const portableReplayItem = (item: Record<string, unknown>): LlmInputItem => {
  if (
    typeof item.role === "string" &&
    (item.role === "user" || item.role === "assistant" || item.role === "system") &&
    typeof item.content === "string"
  ) {
    const role = item.role === "user"
      ? { tag: "User" as const }
      : item.role === "assistant"
      ? { tag: "Assistant" as const }
      : { tag: "System" as const };
    return { tag: "Message", role, content: item.content };
  }
  if (
    item.type === "function_call" &&
    typeof item.call_id === "string" &&
    typeof item.name === "string" &&
    typeof item.arguments === "string"
  ) {
    return {
      tag: "ToolCall",
      call_id: item.call_id,
      name: item.name,
      arguments: item.arguments,
    };
  }
  if (
    item.type === "function_call_output" &&
    typeof item.call_id === "string" &&
    typeof item.output === "string"
  ) {
    return { tag: "ToolOutput", call_id: item.call_id, output: item.output };
  }
  if (item.type === "message" && Array.isArray(item.content)) {
    const text = item.content
      .filter((content) => isRecord(content) && (
        content.type === "output_text" || content.type === "refusal"
      ))
      .map((content) => content.type === "refusal" ? content.refusal : content.text)
      .filter((value): value is string => typeof value === "string")
      .join("");
    if (text) {
      return { tag: "Message", role: { tag: "Assistant" }, content: text };
    }
  }
  return {
    tag: "ProviderItem",
    provider: OPENAI_PROVIDER_ITEM,
    data: JSON.stringify(item),
  };
};

const compactionSuccess = (
  input: LlmInputItem[],
  usage: LlmUsage,
): LlmCompactionResult => ({
  tag: "CompactionSucceeded",
  response: { input, continuation_token: null, usage },
});

const compactionFailure = (error: LlmError): LlmCompactionResult => ({
  tag: "CompactionFailed",
  error,
});

const mapInput = (item: LlmInputItem): Record<string, unknown> => {
  switch (item.tag) {
    case "Message":
      return {
        role: item.role.tag.toLowerCase(),
        content: item.content,
      };
    case "ToolCall":
      return {
        type: "function_call",
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
      };
    case "ToolOutput":
      return {
        type: "function_call_output",
        call_id: item.call_id,
        output: item.output,
      };
    case "ProviderItem": {
      if (item.provider !== OPENAI_PROVIDER_ITEM) {
        throw new ProviderError(
          "incompatible_provider_context",
          `OpenAI cannot consume compacted context from ${item.provider}`,
        );
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(item.data);
      } catch {
        throw new ProviderError(
          "invalid_provider_context",
          "OpenAI compacted context contains invalid JSON",
        );
      }
      if (!isRecord(parsed)) {
        throw new ProviderError(
          "invalid_provider_context",
          "OpenAI compacted context must contain a response item object",
        );
      }
      return parsed;
    }
  }
};

const mapTool = (tool: LlmToolDefinition): Record<string, unknown> => {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: shapeToJsonSchema(tool.parameters, tool.strict, tool.name),
    strict: tool.strict,
  };
};

type JsonSchema = Record<string, unknown>;

const shapeToJsonSchema = (
  shape: LlmShape,
  strict: boolean,
  toolName: string,
): JsonSchema => {
  const definitions = new Map(shape.definitions.map((definition) => [
    definition.key,
    definition,
  ]));
  const resolvedRoot = resolveShapeNode(shape.root, definitions, new Set());
  if (resolvedRoot.tag !== "RecordShape") {
    throw new ProviderError(
      "invalid_tool_schema",
      `Tool ${toolName} parameters must resolve to a record shape`,
    );
  }

  const root = mapShapeNode(shape.root, definitions, strict, toolName);
  if (shape.definitions.length === 0) return root;
  const mappedDefinitions: Record<string, JsonSchema> = {};
  for (const definition of shape.definitions) {
    if (Object.hasOwn(mappedDefinitions, definition.key)) {
      throw new ProviderError(
        "invalid_tool_schema",
        `Tool ${toolName} contains duplicate shape definition ${definition.key}`,
      );
    }
    mappedDefinitions[definition.key] = withDescription(
      mapShapeNode(definition.shape, definitions, strict, toolName),
      definition.documentation,
    );
  }
  return { ...root, $defs: mappedDefinitions };
};

const mapShapeNode = (
  node: LlmShapeNode,
  definitions: Map<string, LlmShape["definitions"][number]>,
  strict: boolean,
  toolName: string,
): JsonSchema => {
  switch (node.tag) {
    case "BoolShape":
      return { type: "boolean" };
    case "I32Shape":
      return { type: "integer" };
    case "I64Shape":
      return {
        type: "integer",
        minimum: -Number.MAX_SAFE_INTEGER,
        maximum: Number.MAX_SAFE_INTEGER,
      };
    case "F32Shape":
    case "F64Shape":
      return { type: "number" };
    case "StringShape":
      return { type: "string" };
    case "UnitShape":
      return { type: "null" };
    case "ArrayShape":
      return {
        type: "array",
        items: mapShapeNode(node.element, definitions, strict, toolName),
      };
    case "RecordShape":
      return withDescription(
        objectSchema(node.fields, definitions, strict, toolName),
        node.documentation,
      );
    case "UnionShape":
      return withDescription({
        anyOf: node.variants.map((variant) => {
          if (variant.fields.some((field) => field.name === "tag")) {
            throw new ProviderError(
              "invalid_tool_schema",
              `Tool ${toolName} union variant ${variant.name} reserves field name tag`,
            );
          }
          const payload = objectSchema(
            variant.fields,
            definitions,
            strict,
            toolName,
            { tag: { type: "string", enum: [variant.name] } },
          );
          return withDescription(payload, variant.documentation);
        }),
      }, node.documentation);
    case "RefShape":
      if (!definitions.has(node.key)) {
        throw new ProviderError(
          "invalid_tool_schema",
          `Tool ${toolName} references unknown shape definition ${node.key}`,
        );
      }
      return { $ref: `#/$defs/${jsonPointerSegment(node.key)}` };
  }
};

const objectSchema = (
  fields: LlmShapeField[],
  definitions: Map<string, LlmShape["definitions"][number]>,
  strict: boolean,
  toolName: string,
  initialProperties: Record<string, JsonSchema> = {},
): JsonSchema => {
  const properties = { ...initialProperties };
  for (const field of fields) {
    if (Object.hasOwn(properties, field.name)) {
      throw new ProviderError(
        "invalid_tool_schema",
        `Tool ${toolName} contains duplicate field ${field.name}`,
      );
    }
    const fieldSchema = withDescription(
      mapShapeNode(field.shape, definitions, strict, toolName),
      field.documentation,
    );
    properties[field.name] = strict && field.optional
      ? { anyOf: [fieldSchema, { type: "null" }] }
      : fieldSchema;
  }
  return {
    type: "object",
    properties,
    required: [
      ...Object.keys(initialProperties),
      ...fields.filter((field) => strict || !field.optional).map((field) => field.name),
    ],
    additionalProperties: false,
  };
};

const resolveShapeNode = (
  node: LlmShapeNode,
  definitions: Map<string, LlmShape["definitions"][number]>,
  visited: Set<string>,
): LlmShapeNode => {
  if (node.tag !== "RefShape") return node;
  if (visited.has(node.key)) return node;
  const definition = definitions.get(node.key);
  if (!definition) return node;
  visited.add(node.key);
  return resolveShapeNode(definition.shape, definitions, visited);
};

const withDescription = (
  schema: JsonSchema,
  documentation: string | undefined,
): JsonSchema => documentation ? { ...schema, description: documentation.trim() } : schema;

const jsonPointerSegment = (value: string): string =>
  value.replaceAll("~", "~0").replaceAll("/", "~1");

const mapResponse = (
  value: unknown,
  usePreviousResponseId: boolean,
  providerName: string,
): LlmModelResponse => {
  if (!isRecord(value)) {
    throw new ProviderError(
      "invalid_response",
      `${providerName} returned a non-object response`,
    );
  }
  const response = value as OpenAIResponse;
  if (response.status === "failed" || response.status === "incomplete") {
    const error = isRecord(response.error) ? response.error : {};
    const code = typeof error.code === "string"
      ? error.code
      : response.status === "incomplete" ? "response_incomplete" : "response_failed";
    throw new ProviderError(
      code,
      providerMessage(response) ?? `${providerName} response ${response.status}`,
      response.status === "incomplete" || retryableProviderCode(code),
    );
  }
  if (typeof response.id !== "string") {
    throw new ProviderError("invalid_response", `${providerName} response is missing its id`);
  }
  if (!Array.isArray(response.output)) {
    throw new ProviderError("invalid_response", `${providerName} response is missing its output`);
  }

  const output: LlmModelOutput[] = [];
  for (const item of response.output) {
    if (!isRecord(item) || typeof item.type !== "string") continue;
    if (item.type === "message" && Array.isArray(item.content)) {
      const text = item.content
        .filter((content) => isRecord(content) && (
          content.type === "output_text" || content.type === "refusal"
        ))
        .map((content) => content.type === "refusal" ? content.refusal : content.text)
        .filter((text): text is string => typeof text === "string")
        .join("");
      if (text) output.push({ tag: "Text", text });
    }
    if (
      item.type === "function_call" &&
      typeof item.call_id === "string" &&
      typeof item.name === "string" &&
      typeof item.arguments === "string"
    ) {
      output.push({
        tag: "ToolCall",
        call_id: item.call_id,
        name: item.name,
        arguments: item.arguments,
      });
    }
  }

  return {
    id: response.id,
    continuation_token: usePreviousResponseId || output.some((item) => item.tag === "ToolCall")
      ? response.id
      : null,
    output,
    usage: mapUsage(response.usage),
  };
};

const mapUsage = (value: unknown): LlmUsage => {
  const usage = isRecord(value) ? value : {};
  return {
    input_tokens: integer(usage.input_tokens),
    output_tokens: integer(usage.output_tokens),
    total_tokens: integer(usage.total_tokens),
  };
};

const readStreamStep = async (
  streams: Map<string, ActiveStream>,
  replays: Map<string, ReplayState>,
  cursor: string,
  providerName: string,
): Promise<LlmStreamResult> => {
  const active = streams.get(cursor);
  if (!active) {
    return streamFailure({
      code: "invalid_stream_cursor",
      message: "The model stream is no longer active",
      retryable: false,
    });
  }

  while (true) {
    const event = await active.events.next();
    if (!event) {
      closeStream(streams, cursor);
      throw new ProviderError(
        "incomplete_stream",
        `${providerName} closed the stream before a completed response`,
        true,
      );
    }
    if (event.type === "response.created" && isRecord(event.response)) {
      const responseId = event.response.id;
      if (typeof responseId === "string") {
        return streamSuccess({
          tag: "Event",
          cursor,
          event: { tag: "Started", response_id: responseId },
        });
      }
    }
    if (
      (event.type === "response.output_text.delta" || event.type === "response.refusal.delta") &&
      typeof event.delta === "string"
    ) {
      return streamSuccess({
        tag: "Event",
        cursor,
        event: { tag: "TextDelta", delta: event.delta },
      });
    }
    if (event.type === "response.completed") {
      closeStream(streams, cursor);
      const mapped = mapResponse(
        event.response,
        active.usePreviousResponseId,
        providerName,
      );
      rememberReplay(
        replays,
        active.input,
        active.replayBatches,
        event.response,
        mapped,
      );
      if (active.previousReplayToken) replays.delete(active.previousReplayToken);
      if (mapped.continuation_token) active.replayTokens.add(mapped.continuation_token);
      return streamSuccess({
        tag: "Done",
        response: mapped,
      });
    }
    if (event.type === "response.failed" || event.type === "response.incomplete") {
      closeStream(streams, cursor);
      const response = isRecord(event.response) ? event.response : {};
      const error = isRecord(response.error) ? response.error : {};
      const code = typeof error.code === "string"
        ? error.code
        : event.type === "response.incomplete" ? "response_incomplete" : "response_failed";
      throw new ProviderError(
        code,
        providerMessage(event.response) ?? `${providerName} emitted ${event.type}`,
        event.type === "response.incomplete" || retryableProviderCode(code),
      );
    }
    if (event.type === "error") {
      closeStream(streams, cursor);
      const code = typeof event.code === "string" ? event.code : "stream_error";
      throw new ProviderError(
        code,
        providerMessage(event) ?? `${providerName} stream failed`,
        retryableProviderCode(code),
      );
    }
  }
};

class SseEvents {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #decoder = new TextDecoder();
  #buffer = "";
  readonly #providerName: string;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>, providerName: string) {
    this.#reader = reader;
    this.#providerName = providerName;
  }

  async next(): Promise<OpenAIEvent | undefined> {
    while (true) {
      const boundary = this.#buffer.search(/\r?\n\r?\n/);
      if (boundary >= 0) {
        const separator = this.#buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? "\n\n";
        const block = this.#buffer.slice(0, boundary);
        this.#buffer = this.#buffer.slice(boundary + separator.length);
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        try {
          const parsed: unknown = JSON.parse(data);
          if (isRecord(parsed)) return parsed as OpenAIEvent;
        } catch {
          throw new ProviderError(
            "invalid_stream_event",
            `${this.#providerName} returned malformed SSE data`,
          );
        }
        continue;
      }

      const chunk = await this.#reader.read();
      if (chunk.done) {
        this.#buffer += this.#decoder.decode();
        if (this.#buffer.trim()) this.#buffer += "\n\n";
        else return undefined;
      } else {
        this.#buffer += this.#decoder.decode(chunk.value, { stream: true });
      }
    }
  }
}

const headers = (options: OpenAIResponsesOptions): Record<string, string> => ({
  "content-type": "application/json",
  authorization: `Bearer ${options.apiKey}`,
  ...(options.organization ? { "openai-organization": options.organization } : {}),
  ...(options.project ? { "openai-project": options.project } : {}),
});

const requestAbort = (
  context: LlmAdapterContext,
  providerName: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): AbortController => {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(new ProviderError(
    "request_timeout",
    `${providerName} request timed out`,
    true,
  )), timeoutMs);
  context.registerResourceCleanup(() => {
    clearTimeout(timeout);
    abort.abort();
  });
  abort.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
  return abort;
};

const responsePayload = async (
  response: Response,
  providerName: string,
): Promise<unknown> => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    if (!response.ok) return { message: text };
    throw new ProviderError(
      "invalid_response",
      `${providerName} returned non-JSON data: ${text.slice(0, MAX_ERROR_BODY_CHARS)}`,
      response.status >= 500,
    );
  }
};

const apiError = (
  status: number,
  payload: unknown,
  providerName: string,
): ProviderError => {
  const message = providerMessage(payload) ?? `${providerName} request failed with HTTP ${status}`;
  const code = isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string"
    ? payload.error.code
    : `http_${status}`;
  return new ProviderError(
    code,
    message.slice(0, MAX_ERROR_BODY_CHARS),
    status === 408 || status === 409 || status === 429 || status >= 500,
  );
};

const providerMessage = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;
  if (typeof value.message === "string") return value.message;
  if (typeof value.reason === "string") return value.reason;
  return providerMessage(value.error) ?? providerMessage(value.incomplete_details);
};

const retryableProviderCode = (code: string): boolean =>
  code === "server_error" || code === "rate_limit_exceeded" || code === "timeout";

const toLlmError = (
  error: unknown,
  providerName: string,
  signal?: AbortSignal,
): LlmError => {
  if (signal?.aborted && signal.reason instanceof ProviderError) {
    const reason = signal.reason;
    return { code: reason.code, message: reason.message, retryable: reason.retryable };
  }
  if (error instanceof ProviderError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "request_aborted",
      message: `${providerName} request was aborted`,
      retryable: true,
    };
  }
  if (error instanceof TypeError || isNetworkError(error)) {
    return {
      code: "network_error",
      message: error instanceof Error ? error.message : `${providerName} network request failed`,
      retryable: true,
    };
  }
  return {
    code: "provider_error",
    message: error instanceof Error ? error.message : `Unknown ${providerName} provider error`,
    retryable: false,
  };
};

const isNetworkError = (error: unknown): boolean => {
  if (!isRecord(error) || typeof error.code !== "string") return false;
  return NETWORK_ERROR_CODES.has(error.code);
};

const closeStream = (streams: Map<string, ActiveStream>, cursor: string): void => {
  const active = streams.get(cursor);
  if (!active) return;
  streams.delete(cursor);
  active.abort.abort();
};

const llmSuccess = (response: LlmModelResponse): LlmResult => ({
  tag: "LlmSucceeded",
  response,
});

const llmFailure = (error: LlmError): LlmResult => ({
  tag: "LlmFailed",
  error,
});

const streamSuccess = (step: LlmStreamStep): LlmStreamResult => ({
  tag: "StreamSucceeded",
  step,
});

const streamFailure = (error: LlmError): LlmStreamResult => ({
  tag: "StreamFailed",
  error,
});

const integer = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : 0;

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
