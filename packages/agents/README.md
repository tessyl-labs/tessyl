# `@tessyl/agents`

A minimal Voyd-native agent harness. The package owns the model/tool loop and
uses the versioned `tessyl.agents.llm.v3` effect as its provider boundary. Every model
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

## Context compaction

Configure compaction on the agent when a run may accumulate a large tool or
message transcript:

```voyd
let librarian = agent(
  name: "librarian",
  instructions: "Research the library and retain source identifiers.",
  model: "gpt-5.6",
  tools: [lookup],
  max_turns: 40,
  compaction: compaction(
    trigger_tokens: 100000,
    keep_recent_items: 6,
    instructions: "Retain claims, source identifiers, open questions, and next actions.",
    model: "checkpoint-model"
  )
)
```

The harness estimates the initial request size, then uses provider-reported
input and output usage when available. It checks pressure only at model-call
boundaries, after every tool call has a corresponding output. A compaction does
not consume an agent turn, but its token usage is included in `RunResult.usage`.
For opaque provider compaction items, the next-window estimate uses the
provider-reported compacted output tokens instead of treating encrypted payload
bytes as prompt text.

Adapters with a native compaction API may expose it as an optional capability.
Otherwise the SDK uses the adapter's ordinary `respond` operation to create a
portable checkpoint and retains a tool-pair-safe recent suffix itself. Native
compactors preserve the same recent suffix and may return opaque `ProviderItem`
values for the older prefix. `keep_recent_items` is an upper bound: the SDK also
caps the suffix relative to `trigger_tokens` and moves complete oversized tool
batches into the prefix. Portable checkpoints are replayed as assistant
context so researched or tool-sourced text cannot gain system priority. Normal
portable compaction summarizes the complete older prefix. Only the last-resort
context-limit recovery path bounds an oversized transcript excerpt before asking
the compactor model, preventing the recovery request from repeating the same
overflow. The checkpoint prompt includes the trusted agent instructions and
application checkpoint requirements, while transcript content remains explicitly
untrusted. Portable compactor calls are one-shot and do not retain unreachable
provider continuation snapshots. The SDK requests a checkpoint output budget and
deterministically bounds a provider that ignores it, reserving headroom for the
agent instructions, tools, and recent suffix; proactive requests are capped at
2,048 output tokens for broad provider compatibility. Before portable
compaction, adapters may materialize replay-only opaque reasoning as typed input,
so its conclusions reach the checkpoint before the old continuation is released.
Overflow recovery uses a
conservative output cap independent of `trigger_tokens`, since the context error
may mean that threshold was configured above the provider's actual window. The
same recovery envelope bounds trusted agent/checkpoint instructions and visible
transcript data. Opaque provider items remain typed; if they alone cannot fit the
envelope, recovery fails explicitly rather than silently flattening and losing
them. The SDK validates any
visible tool calls and outputs before replacing canonical history. Invalid
policies, invalid compacted contexts, and compaction failures are reported as
typed `AgentError` variants. A provider context-limit error triggers one
bounded compact-and-retry attempt when compaction is configured.

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
IDs, streamed server-sent events, and native `POST /v1/responses/compact`
compaction. Set `prefer_native: false` in the Voyd policy to request a semantic
checkpoint using the model instead. Supplying application-specific compaction
`instructions` also selects the portable path because opaque native compaction
cannot guarantee a custom checkpoint schema. Supplying a compaction `model`
selects that model for portable checkpoint generation; omit it to reuse the
agent model.

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
agent declares tools. Ollama does not expose the native compact endpoint, so
the SDK generates a portable assistant checkpoint with the configured model and
carries the unsummarized recent tool batch forward.

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
  async compactNative(request) {
    // Optional. Return opaque or otherwise canonical provider context from a
    // native compaction API. Omit this method to use the SDK fallback.
    return { tag: "CompactionFailed", error: {
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
