import assert from "node:assert/strict";
import { it } from "node:test";
import { createSdk } from "@voyd-lang/sdk";
import { defineLlmHandlers } from "./adapter.js";
import {
  createOpenAIResponsesAdapter,
  createOpenAIResponsesHandlers,
} from "./openai-responses.js";

it("rejects adapters built for a different ABI version", () => {
  const adapter = createOpenAIResponsesAdapter({
    apiKey: "test-key",
    fetch: async () => Response.json({}),
  });

  assert.throws(
    () => defineLlmHandlers({ ...adapter, abiVersion: 2 as 1 }),
    /Unsupported LLM adapter ABI 2; expected 1/,
  );
});

it("runs the compiled Voyd harness through the JavaScript adapter boundary", async () => {
  let sentBody: Record<string, unknown> | undefined;
  const handlers = createOpenAIResponsesHandlers({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        id: "resp_integration",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Hello back" }],
        }],
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      });
    },
  });

  const compiled = await createSdk().compile({
    entryPath: "./src/__fixtures__/agent-integration.voyd",
    roots: {
      src: "./src/__fixtures__",
      pkgDirs: ["../../node_modules/@tessyl/agents/voyd"],
    },
  });
  if (!compiled.success) {
    assert.fail(compiled.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }

  const result = await compiled.run({ entryName: "answer", handlers });

  assert.deepEqual(sentBody, {
    model: "gpt-integration",
    instructions: "Answer briefly",
    input: [{ role: "user", content: "Hello from Voyd" }],
    tools: [],
    stream: false,
  });
  assert.equal(result, 42);
});
