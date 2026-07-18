# `@tessyl/agents`

A minimal Voyd-native agent harness. The package owns the model/tool loop and
uses the versioned `tessyl.agents.llm.v2` effect as its provider boundary. Every model
request includes the complete transcript, so adapters can be stateful or
stateless; provider continuation tokens are an optional optimization.

## Voyd API

Because Voyd package names are unscoped, configure the compiler to search the
scoped npm package's bundled `voyd` directory. With a normal npm installation:

```ts
import { createSdk } from "@voyd-lang/sdk";

const compiled = await createSdk().compile({
  entryPath: "./src/main.voyd",
  roots: {
    src: "./src",
    pkgDirs: ["./node_modules/@tessyl/agents/voyd"],
  },
});
```

The Voyd module can then use `pkg::agents`:

```voyd
use pkg::agents::all
use std::string::type::String

@tool(
  name: "lookup_article",
  description: "Find an article by slug"
)
fn lookup(
  /// The stable slug of the article to find.
  slug: String
) -> ToolResult
  if slug.equals("voyd") then:
    tool_succeeded("Voyd article")
  else:
    tool_failed("Article not found")

pub fn answer(): (Llm, open) -> RunResult
  let librarian = agent(
    name: "librarian",
    instructions: "Maintain the article library.",
    model: "gpt-5.6",
    tools: [lookup]
  )

  run(librarian, input: [user_message("Find the Voyd article")])
```

`@tool` wraps an ordinary typed Voyd function as a `ToolFactory`. It derives a
provider-neutral `Shape` from the parameter types, uses parameter doc comments
as field descriptions, validates and decodes model arguments, and calls the
function. The optional `description` and `strict` arguments default to `""` and
`true`; `name` is required. Tool functions may perform effects, including host
effects whose handlers return promises.

The generated Shape is serialized only at the host boundary. Provider adapters
receive it as structured `parameters`, so adapter authors can translate the
same tool declaration to their provider's schema without embedding JSON Schema
in Voyd source.

Use `run_streamed` with an `on_event` function to receive `Started` and
`TextDelta` events. The harness accumulates usage and stops at the configured
`max_turns` bound.

## OpenAI Responses adapter

Create the host handlers and pass them to the Voyd runtime:

```ts
import { createOpenAIResponsesHandlers } from "@tessyl/agents/openai-responses";

const handlers = createOpenAIResponsesHandlers({
  apiKey: process.env.OPENAI_API_KEY!,
});

await compiled.run({ entryName: "answer", handlers });
```

The adapter uses `POST /v1/responses`, function tools, response continuation
IDs, and streamed server-sent events.

## Ollama adapter

Ollama 0.13.3 or newer exposes a compatible Responses API. Start Ollama and
make sure the model used by the Voyd agent is installed—for example, if the
agent's `model` is `"qwen3.6"`:

```sh
ollama pull qwen3.6
ollama serve
```

Then use the dedicated stateless adapter:

```ts
import { createOllamaHandlers } from "@tessyl/agents/ollama";

const handlers = createOllamaHandlers();
await compiled.run({ entryName: "answer", handlers });
```

The default endpoint is `http://localhost:11434/v1`; no API key is required
for a local Ollama server. Override the connection settings for another local
or remote server:

```ts
const handlers = createOllamaHandlers({
  baseUrl: process.env.OLLAMA_BASE_URL,
  apiKey: process.env.OLLAMA_API_KEY,
  timeoutMs: 180_000,
});
```

Keep the `/v1` suffix on `baseUrl`. Ollama does not support Responses API
continuation IDs, so this adapter deliberately sends the complete agent
transcript on every tool turn. Use a model with tool-calling support when the
agent declares tools.

## Custom provider adapters

Implement the typed, versioned adapter contract and let `defineLlmHandlers`
handle the raw MessagePack representation used by the Voyd effect:

Each request exposes the complete conversation in `input` and the items added
since the continuation token in `input_delta`. Stateless providers use the full
transcript; stateful providers can send the explicit delta with their token.

```ts
import {
  LLM_ADAPTER_ABI_VERSION,
  defineLlmHandlers,
  type LlmAdapter,
} from "@tessyl/agents/adapter";

const provider: LlmAdapter = {
  abiVersion: LLM_ADAPTER_ABI_VERSION,
  async respond(request) {
    // Translate the complete provider-neutral request.
    return { tag: "LlmFailed", error: {
      code: "not_implemented",
      message: `Adapter ABI ${LLM_ADAPTER_ABI_VERSION}`,
      retryable: false,
    } };
  },
  async openStream(request) {
    return { tag: "StreamFailed", error: {
      code: "not_implemented", message: request.model, retryable: false,
    } };
  },
  async nextStream(cursor) {
    return { tag: "StreamFailed", error: {
      code: "invalid_cursor", message: cursor, retryable: false,
    } };
  },
};

const handlers = defineLlmHandlers(provider);
```
