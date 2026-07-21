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
    () => defineLlmHandlers({ ...adapter, abiVersion: 2 as 3 }),
    /Unsupported LLM adapter ABI 2; expected 3/,
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
              arguments:
                "{\"value\":\"pure\",\"payload\":{\"a\":20,\"b\":22},\"bonus\":1}",
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
  assert.deepEqual(sentBodies[0]?.tools[0], {
    type: "function",
    name: "pure_tool",
    description: "Call an ordinary Voyd function",
    parameters: {
      type: "object",
      properties: {
        value: {
          type: "string",
          description: "The mode the tool should execute.",
        },
        payload: {
          type: "object",
          properties: {
            a: { type: "integer" },
            b: { type: "integer" },
          },
          required: ["a", "b"],
          additionalProperties: false,
          description: "Integer inputs used by the nested record calculation.",
        },
        bonus: {
          type: "integer",
          description: "Increment added to the nested record calculation.",
        },
      },
      required: ["bonus", "payload", "value"],
      additionalProperties: false,
    },
    strict: true,
  });
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

it("runs native compaction through the Voyd adapter boundary", async () => {
  const requests: Array<{ url: string; body: Record<string, any> }> = [];
  const handlers = createOpenAIResponsesHandlers({
    apiKey: "test-key",
    fetch: async (input, init) => {
      const request = {
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, any>,
      };
      requests.push(request);
      if (requests.length === 1) {
        return Response.json({
          id: "resp_before_compaction",
          status: "completed",
          output: [{
            type: "function_call",
            call_id: "call_pure",
            name: "pure_tool",
            arguments: "{\"value\":\"pure\",\"payload\":{\"a\":20,\"b\":22},\"bonus\":1}",
          }],
          usage: { input_tokens: 1100, output_tokens: 3, total_tokens: 1103 },
        });
      }
      if (requests.length === 2) {
        return Response.json({
          id: "cmp_integration",
          object: "response.compaction",
          output: [{
            id: "cmp_item_integration",
            type: "compaction",
            encrypted_content: "opaque-integration-context",
          }],
          usage: { input_tokens: 9, output_tokens: 2, total_tokens: 11 },
        });
      }
      return Response.json({
        id: "resp_after_compaction",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Compaction complete" }],
        }],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      });
    },
  });

  const compiled = await compileIntegrationFixture();
  const result = await compiled.run({ entryName: "compacted_answer", handlers });

  assert.equal(result, 126);
  assert.deepEqual(requests.map((request) => request.url), [
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses/compact",
    "https://api.openai.com/v1/responses",
  ]);
  assert.deepEqual(requests[1]?.body.input, [
    { role: "user", content: "Use the tool" },
  ]);
  assert.deepEqual(requests[2]?.body.input, [
    {
      id: "cmp_item_integration",
      type: "compaction",
      encrypted_content: "opaque-integration-context",
    },
    {
      type: "function_call",
      call_id: "call_pure",
      name: "pure_tool",
      arguments: "{\"value\":\"pure\",\"payload\":{\"a\":20,\"b\":22},\"bonus\":1}",
    },
    {
      type: "function_call_output",
      call_id: "call_pure",
      output: "pure-result",
    },
  ]);
  assert.equal(requests[2]?.body.previous_response_id, undefined);
});

it("uses portable compaction when application checkpoint instructions are present", async () => {
  const requests: Array<{ url: string; body: Record<string, any> }> = [];
  const handlers = createOpenAIResponsesHandlers({
    apiKey: "test-key",
    fetch: async (input, init) => {
      const request = {
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, any>,
      };
      requests.push(request);
      if (requests.length === 1) {
        return Response.json({
          id: "resp_before_checkpoint",
          status: "completed",
          output: [{
            type: "function_call",
            call_id: "call_pure",
            name: "pure_tool",
            arguments: "{\"value\":\"pure\",\"payload\":{\"a\":20,\"b\":22},\"bonus\":1}",
          }],
          usage: { input_tokens: 1100, output_tokens: 3, total_tokens: 1103 },
        });
      }
      if (requests.length === 2) {
        return Response.json({
          id: "resp_checkpoint",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Source-aware checkpoint" }],
          }],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        });
      }
      return Response.json({
        id: "resp_after_checkpoint",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Checkpoint complete" }],
        }],
        usage: { input_tokens: 6, output_tokens: 2, total_tokens: 8 },
      });
    },
  });

  const compiled = await compileIntegrationFixture();
  const result = await compiled.run({ entryName: "checkpointed_answer", handlers });

  assert.equal(result, 168);
  assert.deepEqual(requests.map((request) => request.url), [
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses",
  ]);
  assert.match(requests[1]?.body.instructions, /Retain source identifiers/);
  assert.deepEqual(requests[1]?.body.input, [
    { role: "user", content: "Use the tool" },
  ]);
  assert.deepEqual(requests[2]?.body.input, [
    {
      role: "assistant",
      content: "Compacted conversation checkpoint:\nSource-aware checkpoint",
    },
    {
      type: "function_call",
      call_id: "call_pure",
      name: "pure_tool",
      arguments: "{\"value\":\"pure\",\"payload\":{\"a\":20,\"b\":22},\"bonus\":1}",
    },
    {
      type: "function_call_output",
      call_id: "call_pure",
      output: "pure-result",
    },
  ]);
});

it("retries an overflowing proactive portable compactor with bounded full input", async () => {
  const requests: Array<{ url: string; body: Record<string, any> }> = [];
  const handlers = createOpenAIResponsesHandlers({
    apiKey: "test-key",
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, any>,
      });
      if (requests.length === 1) {
        return Response.json({
          id: "resp_before_portable_overflow",
          status: "completed",
          output: [{
            type: "function_call",
            call_id: "call_pure",
            name: "pure_tool",
            arguments: "{\"value\":\"pure\",\"payload\":{\"a\":20,\"b\":22},\"bonus\":1}",
          }],
          usage: { input_tokens: 1100, output_tokens: 3, total_tokens: 1103 },
        });
      }
      if (requests.length === 2) {
        return Response.json({
          error: {
            code: "context_length_exceeded",
            message: "The checkpoint input exceeds the context window",
          },
        }, { status: 400 });
      }
      if (requests.length === 3) {
        return Response.json({
          id: "resp_bounded_portable_checkpoint",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Bounded portable checkpoint" }],
          }],
          usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
        });
      }
      return Response.json({
        id: "resp_after_portable_overflow",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Checkpoint complete" }],
        }],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      });
    },
  });

  const compiled = await compileIntegrationFixture();
  const result = await compiled.run({ entryName: "checkpointed_answer", handlers });

  assert.equal(result, 168);
  assert.deepEqual(requests.map(({ url }) => url), [
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses",
  ]);
  assert.deepEqual(requests[1]?.body.input, [
    { role: "user", content: "Use the tool" },
  ]);
  assert.equal(requests[2]?.body.input.length, 3);
  assert.deepEqual(requests[3]?.body.input, [{
    role: "assistant",
    content: "Compacted conversation checkpoint:\nBounded portable checkpoint",
  }]);
});

it("falls back when a provider rejects native compaction as unsupported", async () => {
  const urls: string[] = [];
  const handlers = createOpenAIResponsesHandlers({
    apiKey: "test-key",
    fetch: async (input) => {
      const url = String(input);
      urls.push(url);
      if (urls.length === 1) {
        return Response.json({
          id: "resp_tool",
          status: "completed",
          output: [{
            type: "function_call",
            call_id: "call_pure",
            name: "pure_tool",
            arguments: "{\"value\":\"pure\",\"payload\":{\"a\":20,\"b\":22},\"bonus\":1}",
          }],
          usage: { input_tokens: 1100, output_tokens: 3, total_tokens: 1103 },
        });
      }
      if (urls.length === 2) {
        return new Response("Native compaction is not supported", { status: 404 });
      }
      if (urls.length === 3) {
        return Response.json({
          id: "resp_fallback_checkpoint",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Fallback checkpoint" }],
          }],
          usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        });
      }
      return Response.json({
        id: "resp_final",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Compaction complete" }],
        }],
        usage: { input_tokens: 6, output_tokens: 2, total_tokens: 8 },
      });
    },
  });

  const compiled = await compileIntegrationFixture();
  const result = await compiled.run({ entryName: "compacted_answer", handlers });

  assert.equal(result, 126);
  assert.deepEqual(urls, [
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses/compact",
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses",
  ]);
});

it("uses bounded portable compaction to retry a context-limit failure", async () => {
  const requests: Array<{ url: string; body: Record<string, any> }> = [];
  const handlers = createOpenAIResponsesHandlers({
    apiKey: "test-key",
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, any>,
      });
      if (requests.length === 1) {
        return Response.json({
          error: {
            code: "context_length_exceeded",
            message: "The request exceeds the model context window",
          },
        }, { status: 400 });
      }
      if (requests.length === 2) {
        return Response.json({
          id: "resp_recovery_checkpoint",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Recovery checkpoint" }],
          }],
          usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
        });
      }
      return Response.json({
        id: "resp_recovered",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Recovered answer" }],
        }],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      });
    },
  });

  const compiled = await compileIntegrationFixture();
  const result = await compiled.run({ entryName: "recovered_answer", handlers });

  assert.equal(result, 210);
  assert.deepEqual(requests.map(({ url }) => url), [
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses",
  ]);
  assert.deepEqual(requests[1]?.body.input, [
    { role: "user", content: "An oversized request" },
  ]);
  assert.deepEqual(requests[2]?.body.input, [{
    role: "assistant",
    content: "Compacted conversation checkpoint:\nRecovery checkpoint",
  }]);
});

it("falls back to bounded portable recovery when native compaction is too large", async () => {
  const requests: Array<{ url: string; body: Record<string, any> }> = [];
  const handlers = createOpenAIResponsesHandlers({
    apiKey: "test-key",
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, any>,
      });
      if (requests.length === 1) {
        return Response.json({
          id: "resp_native_overflow",
          status: "completed",
          output: [{
            type: "function_call",
            call_id: "call_pure",
            name: "pure_tool",
            arguments: "{\"value\":\"pure\",\"payload\":{\"a\":20,\"b\":22},\"bonus\":1}",
          }],
          usage: { input_tokens: 1100, output_tokens: 3, total_tokens: 1103 },
        });
      }
      if (requests.length === 2) {
        return Response.json({
          error: {
            code: "context_length_exceeded",
            message: "The compact input exceeds the context window",
          },
        }, { status: 400 });
      }
      if (requests.length === 3) {
        return Response.json({
          id: "resp_native_overflow_checkpoint",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Recovered native checkpoint" }],
          }],
          usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
        });
      }
      return Response.json({
        id: "resp_native_overflow_final",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Compaction complete" }],
        }],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
      });
    },
  });

  const compiled = await compileIntegrationFixture();
  const result = await compiled.run({ entryName: "compacted_answer", handlers });

  assert.equal(result, 126);
  assert.deepEqual(requests.map(({ url }) => url), [
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses/compact",
    "https://api.openai.com/v1/responses",
    "https://api.openai.com/v1/responses",
  ]);
  assert.deepEqual(requests[3]?.body.input, [{
    role: "assistant",
    content: "Compacted conversation checkpoint:\nRecovered native checkpoint",
  }]);
});

const compileIntegrationFixture = async () => {
  const compiled = await integrationFixture;
  if (!compiled.success) {
    assert.fail(compiled.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  return compiled;
};
