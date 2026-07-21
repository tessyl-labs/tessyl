import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmModelRequest } from "./adapter.js";
import { compactWithFallback } from "./adapter.js";
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
  retain_continuation: true,
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
      "tessyl.agents.llm.v3::compact",
      "tessyl.agents.llm.v3::next_stream",
      "tessyl.agents.llm.v3::open_stream",
      "tessyl.agents.llm.v3::respond",
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

  it("creates a portable fallback checkpoint without splitting a tool batch", async () => {
    let requestedUrl: string | undefined;
    let sentBody: Record<string, any> | undefined;
    const adapter = createOllamaAdapter({
      fetch: async (input, init) => {
        requestedUrl = String(input);
        sentBody = JSON.parse(String(init?.body)) as Record<string, any>;
        return Response.json({
          id: "resp_checkpoint",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Objective and sources retained." }],
          }],
          usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 },
        });
      },
    });
    const input: LlmModelRequest["input"] = [
      { tag: "Message", role: { tag: "User" }, content: "Research Voyd" },
      { tag: "ToolCall", call_id: "call_1", name: "search", arguments: "{}" },
      { tag: "ToolCall", call_id: "call_2", name: "read", arguments: "{}" },
      { tag: "ToolOutput", call_id: "call_1", output: "search results" },
      { tag: "ToolOutput", call_id: "call_2", output: "article" },
    ];

    const result = await compactWithFallback(adapter, {
      ...request,
      input,
      input_delta: input.slice(3),
      compaction: {
        trigger_tokens: 1000,
        keep_recent_items: 2,
        instructions: "Keep source identifiers and unresolved questions.",
        model: "checkpoint-model",
        prefer_native: true,
      },
      overflow_recovery: false,
    }, context);

    assert.equal(requestedUrl, "http://localhost:11434/v1/responses");
    assert.equal(sentBody?.model, "checkpoint-model");
    assert.match(sentBody?.instructions, /Keep source identifiers/);
    assert.match(sentBody?.instructions, /Maintain the library/);
    assert.deepEqual(sentBody?.input, [
      { role: "user", content: "Research Voyd" },
    ]);
    assert.deepEqual(result, {
      tag: "CompactionSucceeded",
      response: {
        input: [
          {
            tag: "Message",
            role: { tag: "Assistant" },
            content: "Compacted conversation checkpoint:\nObjective and sources retained.",
          },
          ...input.slice(1),
        ],
        continuation_token: null,
        usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 },
      },
    });
  });

  it("bounds oversized input before invoking the portable compactor", async () => {
    let sentBody: Record<string, any> | undefined;
    const adapter = createOllamaAdapter({
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body)) as Record<string, any>;
        return Response.json({
          id: "resp_bounded_checkpoint",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Bounded checkpoint" }],
          }],
          usage: {},
        });
      },
    });
    const oversized = "x".repeat(20_000);

    const result = await compactWithFallback(adapter, {
      ...request,
      instructions: "trusted-objective-".repeat(1_000),
      input: [{ tag: "ToolOutput", call_id: "call_large", output: oversized }],
      input_delta: [],
      compaction: {
        trigger_tokens: 100,
        keep_recent_items: 0,
        instructions: "",
        model: "",
        prefer_native: false,
      },
      overflow_recovery: true,
    }, context);

    assert.equal(sentBody?.input.length, 1);
    assert.equal(sentBody?.input[0]?.role, "assistant");
    assert.equal(sentBody?.max_output_tokens, 512);
    assert.match(sentBody?.input[0]?.content, /middle omitted/);
    assert.ok(sentBody?.input[0]?.content.length < 8_200);
    assert.match(sentBody?.instructions, /trusted instructions truncated/);
    assert.ok(sentBody?.instructions.length < 2_500);
    assert.equal(result.tag, "CompactionSucceeded");
  });

  it("preserves opaque provider items as typed recovery input", async () => {
    let sentBody: Record<string, any> | undefined;
    const adapter = createOllamaAdapter({
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body)) as Record<string, any>;
        return Response.json({
          id: "resp_opaque_recovery",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Opaque-aware checkpoint" }],
          }],
          usage: {},
        });
      },
    });
    const opaque = {
      id: "cmp_existing",
      type: "compaction",
      encrypted_content: "opaque-state",
    };

    const result = await compactWithFallback(adapter, {
      ...request,
      input: [
        {
          tag: "ProviderItem",
          provider: "openai.responses",
          data: JSON.stringify(opaque),
        },
        { tag: "Message", role: { tag: "Assistant" }, content: "x".repeat(20_000) },
      ],
      input_delta: [],
      overflow_recovery: true,
      compaction: {
        trigger_tokens: 100_000,
        keep_recent_items: 0,
        instructions: "",
        model: "",
        prefer_native: false,
      },
    }, context);

    assert.deepEqual(sentBody?.input[0], opaque);
    assert.equal(sentBody?.input[1]?.role, "assistant");
    assert.match(sentBody?.input[1]?.content, /middle omitted/);
    assert.equal(result.tag, "CompactionSucceeded");
  });

  it("fails explicitly when opaque state alone exceeds the recovery envelope", async () => {
    let fetchCalls = 0;
    const adapter = createOllamaAdapter({
      fetch: async () => {
        fetchCalls += 1;
        return Response.json({});
      },
    });

    const result = await compactWithFallback(adapter, {
      ...request,
      input: [{
        tag: "ProviderItem",
        provider: "openai.responses",
        data: JSON.stringify({
          type: "compaction",
          encrypted_content: "x".repeat(10_000),
        }),
      }],
      input_delta: [],
      overflow_recovery: true,
      compaction: {
        trigger_tokens: 100_000,
        keep_recent_items: 0,
        instructions: "",
        model: "",
        prefer_native: false,
      },
    }, context);

    assert.equal(fetchCalls, 0);
    assert.equal(result.tag, "CompactionFailed");
    if (result.tag === "CompactionFailed") {
      assert.equal(result.error.code, "opaque_context_too_large_for_recovery");
    }
  });

  it("does not truncate proactive portable compaction input", async () => {
    let sentBody: Record<string, any> | undefined;
    const adapter = createOllamaAdapter({
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body)) as Record<string, any>;
        return Response.json({
          id: "resp_full_checkpoint",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Full checkpoint" }],
          }],
          usage: {},
        });
      },
    });
    const fullTranscript = `begin-${"x".repeat(20_000)}-end`;

    await compactWithFallback(adapter, {
      ...request,
      input: [{ tag: "Message", role: { tag: "User" }, content: fullTranscript }],
      input_delta: [],
      overflow_recovery: false,
      compaction: {
        trigger_tokens: 100_000,
        keep_recent_items: 0,
        instructions: "",
        model: "",
        prefer_native: false,
      },
    }, context);

    assert.equal(sentBody?.input[0]?.content, fullTranscript);
    assert.equal(sentBody?.max_output_tokens, 2048);
  });

  it("bounds a verbose checkpoint even when the provider ignores its output limit", async () => {
    let sentBody: Record<string, any> | undefined;
    const adapter = createOllamaAdapter({
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body)) as Record<string, any>;
        return Response.json({
          id: "resp_verbose_checkpoint",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "x".repeat(5_000) }],
          }],
          usage: {},
        });
      },
    });

    const result = await compactWithFallback(adapter, {
      ...request,
      input: request.input.slice(0, 1),
      input_delta: request.input.slice(0, 1),
      overflow_recovery: false,
      compaction: {
        trigger_tokens: 100,
        keep_recent_items: 0,
        instructions: "",
        model: "",
        prefer_native: false,
      },
    }, context);

    assert.equal(sentBody?.max_output_tokens, 25);
    assert.equal(result.tag, "CompactionSucceeded");
    if (result.tag === "CompactionSucceeded") {
      const item = result.response.input[0];
      assert.equal(item?.tag, "Message");
      if (item?.tag === "Message") {
        assert.match(item.content, /checkpoint truncated/);
        assert.ok(item.content.length < 150);
      }
    }
  });

  it("moves an oversized recent tool pair into the compacted prefix", async () => {
    let sentBody: Record<string, any> | undefined;
    const adapter = createOllamaAdapter({
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body)) as Record<string, any>;
        return Response.json({
          id: "resp_large_suffix_checkpoint",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Large result checkpoint" }],
          }],
          usage: {},
        });
      },
    });
    const input: LlmModelRequest["input"] = [
      { tag: "Message", role: { tag: "User" }, content: "Read the source" },
      { tag: "ToolCall", call_id: "call_large", name: "read", arguments: "{}" },
      { tag: "ToolOutput", call_id: "call_large", output: "x".repeat(20_000) },
    ];

    const result = await compactWithFallback(adapter, {
      ...request,
      input,
      input_delta: input.slice(2),
      overflow_recovery: false,
      compaction: {
        trigger_tokens: 100,
        keep_recent_items: 2,
        instructions: "",
        model: "",
        prefer_native: false,
      },
    }, context);

    assert.equal(sentBody?.input.length, 3);
    assert.equal(result.tag, "CompactionSucceeded");
    if (result.tag === "CompactionSucceeded") {
      assert.equal(result.response.input.length, 1);
    }
  });

  it("discards the replaced replay after portable compaction", async () => {
    const sentBodies: Record<string, any>[] = [];
    const adapter = createOllamaAdapter({
      fetch: async (_input, init) => {
        sentBodies.push(JSON.parse(String(init?.body)) as Record<string, any>);
        if (sentBodies.length === 1) {
          return Response.json({
            id: "resp_old_replay",
            status: "completed",
            output: [
              {
                id: "reasoning_before_checkpoint",
                type: "reasoning",
                encrypted_content: "opaque-checkpoint-reasoning",
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
        if (sentBodies.length === 2) {
          return Response.json({
            id: "resp_one_shot_checkpoint",
            status: "completed",
            output: [{
              type: "message",
              content: [{ type: "output_text", text: "Portable checkpoint" }],
            }],
            usage: {},
          });
        }
        return Response.json({
          id: "resp_after_discard",
          status: "completed",
          output: [{
            type: "message",
            content: [{ type: "output_text", text: "Done" }],
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
    if (first.tag !== "LlmSucceeded") assert.fail("expected a tool response");
    const compacted = await compactWithFallback(adapter, {
      ...request,
      continuation_token: first.response.continuation_token,
      overflow_recovery: false,
      compaction: {
        trigger_tokens: 1000,
        keep_recent_items: 0,
        instructions: "",
        model: "",
        prefer_native: false,
      },
    }, context);
    assert.equal(compacted.tag, "CompactionSucceeded");
    if (compacted.tag !== "CompactionSucceeded") assert.fail("expected compaction");
    assert.deepEqual(sentBodies[1]?.input[1], {
      id: "reasoning_before_checkpoint",
      type: "reasoning",
      encrypted_content: "opaque-checkpoint-reasoning",
    });

    await adapter.respond({
      ...request,
      input: compacted.response.input,
      input_delta: compacted.response.input,
      continuation_token: first.response.continuation_token,
    }, context);

    assert.deepEqual(sentBodies[2]?.input, [{
      role: "assistant",
      content: "Compacted conversation checkpoint:\nPortable checkpoint",
    }]);
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
