import {
  defineLlmHandlers,
  type LlmAdapter,
  type LlmEffectHandlers,
} from "./adapter.js";
import {
  createOpenAIResponsesAdapter,
  type OpenAIResponsesOptions,
} from "./openai-responses.js";

const DEFAULT_BASE_URL = "http://localhost:11434/v1";

export type OllamaOptions = Omit<
  OpenAIResponsesOptions,
  | "apiKey"
  | "organization"
  | "project"
  | "providerName"
  | "streamCursorPrefix"
  | "usePreviousResponseId"
> & {
  /** Used by remote or authenticated Ollama-compatible servers. */
  apiKey?: string;
};

export type OllamaHandlers = LlmEffectHandlers;

/**
 * Creates host handlers for a local or remote Ollama server. Ollama's
 * Responses API is stateless, so every follow-up sends the full transcript.
 */
export const createOllamaHandlers = (
  options: OllamaOptions = {},
): OllamaHandlers => defineLlmHandlers(createOllamaAdapter(options));

export const createOllamaAdapter = (
  options: OllamaOptions = {},
): LlmAdapter => createOpenAIResponsesAdapter({
  ...options,
  apiKey: options.apiKey ?? "ollama",
  baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
  providerName: "Ollama",
  streamCursorPrefix: "ollama",
  usePreviousResponseId: false,
});
