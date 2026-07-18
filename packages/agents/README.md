# `@tessyl/agents`

A minimal Voyd-native agent harness. The package owns the model/tool loop and
uses the versioned `tessyl.agents.llm.v1` effect as its provider boundary. Every model
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
use pkg::agents::{
  Llm,
  RunResult,
  agent,
  run,
  tool,
  tool_succeeded,
  user_message
}
use std::string::type::String

fn lookup(arguments_json: String)
  tool_succeeded("Voyd article")

pub fn answer(): (Llm, open) -> RunResult
  let librarian = agent(
    name: "librarian",
    instructions: "Maintain the article library.",
    model: "gpt-5.6",
    tools: [tool(
      name: "lookup_article",
      description: "Find an article by slug",
      parameters_json: "{\"type\":\"object\",\"properties\":{\"slug\":{\"type\":\"string\"}},\"required\":[\"slug\"],\"additionalProperties\":false}",
      strict: true,
      handler: lookup
    )]
  )

  run(librarian, input: [user_message("Find the Voyd article")])
```

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
