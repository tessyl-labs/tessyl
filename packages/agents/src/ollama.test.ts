import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmModelRequest } from "./adapter.js";
import { createOllamaAdapter, createOllamaHandlers } from "./ollama.js";

const request: LlmModelRequest = {
  model: "qwen3.6",
  instructions: "Maintain the library.",
  input: [
    { tag: "Message", role: { tag: "User" }, content: "Find the Voyd article" },
    {
      tag: "ToolCall",
      call_id: "call_1",
      name: "lookup_article",
      arguments: "{\"slug\":\"voyd\"}",
    },
    { tag: "ToolOutput", call_id: "call_1", output: "Voyd article" },
  ],
  input_delta: [
    { tag: "ToolOutput", call_id: "call_1", output: "Voyd article" },
  ],
  tools: [],
  continuation_token: "ignored-by-ollama",
};

describe("Ollama adapter", () => {
  it("uses local Responses API defaults and full stateless transcripts", async () => {
    let requestedUrl: string | undefined;
    let sentBody: Record<string, unknown> | undefined;
    let sentHeaders: Headers | undefined;
    const adapter = createOllamaAdapter({
      fetch: async (input, init) => {
        requestedUrl = String(input);
        sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        sentHeaders = new Headers(init?.headers);
        return Response.json({
          id: "resp_ollama",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Found it" }],
          }],
          usage: { input_tokens: 12, output_tokens: 2, total_tokens: 14 },
        });
      },
    });

    const result = await adapter.respond(request, context);

    assert.equal(requestedUrl, "http://localhost:11434/v1/responses");
    assert.equal(sentHeaders?.get("authorization"), "Bearer ollama");
    assert.equal(sentBody?.previous_response_id, undefined);
    assert.deepEqual(sentBody?.input, [
      { role: "user", content: "Find the Voyd article" },
      {
        type: "function_call",
        call_id: "call_1",
        name: "lookup_article",
        arguments: "{\"slug\":\"voyd\"}",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "Voyd article",
      },
    ]);
    assert.equal(result.tag, "LlmSucceeded");
    if (result.tag === "LlmSucceeded") {
      assert.equal(result.response.continuation_token, null);
      assert.deepEqual(result.response.output, [{ tag: "Text", text: "Found it" }]);
    }
  });

  it("creates effect handlers without configuration", () => {
    assert.deepEqual(Object.keys(createOllamaHandlers()).sort(), [
      "tessyl.agents.llm.v2::next_stream",
      "tessyl.agents.llm.v2::open_stream",
      "tessyl.agents.llm.v2::respond",
    ]);
  });

  it("replays opaque reasoning across stateless tool turns", async () => {
    const sentBodies: Record<string, any>[] = [];
    const adapter = createOllamaAdapter({
      fetch: async (_input, init) => {
        sentBodies.push(JSON.parse(String(init?.body)) as Record<string, any>);
        if (sentBodies.length === 1) {
          return Response.json({
            id: "resp_tool",
            status: "completed",
            output: [
              {
                id: "reasoning_1",
                type: "reasoning",
                encrypted_content: "opaque-qwen-reasoning",
                summary: [{ type: "summary_text", text: "I should use the lookup tool." }],
              },
              {
                type: "function_call",
                call_id: "call_1",
                name: "lookup_article",
                arguments: "{\"slug\":\"voyd\"}",
              },
            ],
            usage: {},
          });
        }
        return Response.json({
          id: "resp_final",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Found it" }],
          }],
          usage: {},
        });
      },
    });

    const first = await adapter.respond({
      ...request,
      input: request.input.slice(0, 1),
      input_delta: request.input.slice(0, 1),
      continuation_token: null,
    }, context);
    assert.equal(first.tag, "LlmSucceeded");
    if (first.tag !== "LlmSucceeded") assert.fail("expected the tool response");
    assert.equal(first.response.continuation_token, "resp_tool");

    const second = await adapter.respond({
      ...request,
      continuation_token: first.response.continuation_token,
    }, context);

    assert.equal(second.tag, "LlmSucceeded");
    assert.equal(sentBodies[1]?.previous_response_id, undefined);
    assert.deepEqual(sentBodies[1]?.input, [
      { role: "user", content: "Find the Voyd article" },
      {
        id: "reasoning_1",
        type: "reasoning",
        encrypted_content: "opaque-qwen-reasoning",
        summary: [{ type: "summary_text", text: "I should use the lookup tool." }],
      },
      {
        type: "function_call",
        call_id: "call_1",
        name: "lookup_article",
        arguments: "{\"slug\":\"voyd\"}",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "Voyd article",
      },
    ]);
  });

  it("identifies Ollama in provider diagnostics", async () => {
    const adapter = createOllamaAdapter({
      fetch: async () => new Response("not json"),
    });

    const result = await adapter.respond(request, context);

    assert.equal(result.tag, "LlmFailed");
    if (result.tag === "LlmFailed") {
      assert.match(result.error.message, /^Ollama returned non-JSON data/);
    }
  });
});

const context = { registerResourceCleanup: () => undefined };
