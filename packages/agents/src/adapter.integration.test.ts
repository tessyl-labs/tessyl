import assert from "node:assert/strict";
import { it } from "node:test";
import type { EffectHandler } from "@voyd-lang/js-host";
import { createSdk } from "@voyd-lang/sdk";
import { defineLlmHandlers } from "./adapter.js";
import {
  createOpenAIResponsesAdapter,
  createOpenAIResponsesHandlers,
} from "./openai-responses.js";

const integrationFixture = createSdk().compile({
  entryPath: "./src/__fixtures__/agent-integration.voyd",
  roots: {
    src: "./src/__fixtures__",
    pkgDirs: ["../../node_modules/@tessyl/agents/voyd"],
  },
});

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

  const compiled = await compileIntegrationFixture();
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

it("executes pure and async-effect Voyd functions as model tools", async () => {
  const sentBodies: Record<string, any>[] = [];
  const llmHandlers = createOpenAIResponsesHandlers({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, any>;
      sentBodies.push(body);
      if (sentBodies.length === 1) {
        return Response.json({
          id: "resp_tools",
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "call_pure",
              name: "pure_tool",
              arguments: "{\"value\":\"pure\"}",
            },
            {
              type: "function_call",
              call_id: "call_async",
              name: "async_tool",
              arguments: "{\"value\":\"async\"}",
            },
          ],
          usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
        });
      }
      return Response.json({
        id: "resp_final",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Tools complete" }],
        }],
        usage: { input_tokens: 7, output_tokens: 2, total_tokens: 9 },
      });
    },
  });
  let asyncEffectCalls = 0;
  const asyncToolHandler: EffectHandler = async (
    continuation,
    value,
  ) => {
    assert.equal(value, 41);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    asyncEffectCalls += 1;
    return continuation.resume(42);
  };

  const compiled = await compileIntegrationFixture();
  const result = await compiled.run({
    entryName: "tool_answer",
    handlers: {
      ...llmHandlers,
      "tessyl.agents.test.async-tool::transform": asyncToolHandler,
    },
  });

  assert.equal(result, 84);
  assert.equal(asyncEffectCalls, 1);
  assert.equal(sentBodies.length, 2);
  assert.deepEqual(
    sentBodies[0]?.tools.map((toolDefinition: Record<string, unknown>) =>
      toolDefinition.name
    ),
    ["pure_tool", "async_tool"],
  );
  assert.deepEqual(sentBodies[1]?.input, [
    {
      type: "function_call_output",
      call_id: "call_pure",
      output: "pure-result",
    },
    {
      type: "function_call_output",
      call_id: "call_async",
      output: "async-result",
    },
  ]);
  assert.equal(sentBodies[1]?.previous_response_id, "resp_tools");
});

const compileIntegrationFixture = async () => {
  const compiled = await integrationFixture;
  if (!compiled.success) {
    assert.fail(compiled.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  return compiled;
};
