import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOpenAIResponsesAdapter,
} from "./openai-responses.js";
import type { LlmModelRequest } from "./adapter.js";

const addParameters = {
  root: {
    tag: "RecordShape" as const,
    name: "add",
    fields: [
      {
        name: "a",
        shape: { tag: "F64Shape" as const },
        optional: false,
        documentation: "First number.",
      },
      {
        name: "b",
        shape: { tag: "F64Shape" as const },
        optional: false,
        documentation: "Second number.",
      },
    ],
  },
  definitions: [],
};

const request: LlmModelRequest = {
  model: "gpt-test",
  instructions: "Be concise",
  input: [
    { tag: "Message", role: { tag: "User" }, content: "What is 1 + 2?" },
  ],
  input_delta: [
    { tag: "Message", role: { tag: "User" }, content: "What is 1 + 2?" },
  ],
  tools: [
    {
      name: "add",
      description: "Add numbers",
      parameters: addParameters,
      strict: true,
    },
  ],
  retain_continuation: true,
};

describe("OpenAI Responses handlers", () => {
  it("maps requests, text, tool calls, and usage", async () => {
    let sentBody: Record<string, any> | undefined;
    let sentHeaders: Headers | undefined;
    const fetchMock: typeof fetch = async (_input, init) => {
      sentBody = JSON.parse(String(init?.body));
      sentHeaders = new Headers(init?.headers);
      return Response.json({
        id: "resp_1",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "I will calculate it." }],
          },
          {
            type: "function_call",
            call_id: "call_1",
            name: "add",
            arguments: "{\"a\":1,\"b\":2}",
          },
        ],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      });
    };
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      organization: "org_test",
      project: "proj_test",
      fetch: fetchMock,
    });

    const value = await adapter.respond(request, context);

    assert.equal(sentHeaders?.get("authorization"), "Bearer test-key");
    assert.equal(sentHeaders?.get("openai-organization"), "org_test");
    assert.equal(sentHeaders?.get("openai-project"), "proj_test");
    assert.deepEqual(sentBody, {
      model: "gpt-test",
      instructions: "Be concise",
      input: [{ role: "user", content: "What is 1 + 2?" }],
      tools: [{
        type: "function",
        name: "add",
        description: "Add numbers",
        parameters: {
          type: "object",
          properties: {
            a: { type: "number", description: "First number." },
            b: { type: "number", description: "Second number." },
          },
          required: ["a", "b"],
          additionalProperties: false,
        },
        strict: true,
      }],
      stream: false,
    });
    assert.deepEqual(value, {
      tag: "LlmSucceeded",
      response: {
        id: "resp_1",
        continuation_token: "resp_1",
        output: [
          { tag: "Text", text: "I will calculate it." },
          {
            tag: "ToolCall",
            call_id: "call_1",
            name: "add",
            arguments: "{\"a\":1,\"b\":2}",
          },
        ],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      },
    });
  });

  it("maps optional fields to nullable required properties in strict mode", async () => {
    let sentBody: Record<string, any> | undefined;
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body));
        return Response.json({ id: "resp_optional", output: [], usage: {} });
      },
    });

    await adapter.respond({
      ...request,
      tools: [{
        name: "lookup",
        description: "Lookup",
        strict: true,
        parameters: {
          root: {
            tag: "RecordShape",
            name: "lookup",
            fields: [{
              name: "limit",
              optional: true,
              shape: { tag: "I32Shape" },
            }],
          },
          definitions: [],
        },
      }],
    }, context);

    assert.deepEqual(sentBody?.tools[0].parameters, {
      type: "object",
      properties: {
        limit: { anyOf: [{ type: "integer" }, { type: "null" }] },
      },
      required: ["limit"],
      additionalProperties: false,
    });
  });

  it("advertises the exact integer range accepted by i64 tool decoding", async () => {
    let sentBody: Record<string, any> | undefined;
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body));
        return Response.json({ id: "resp_i64", output: [], usage: {} });
      },
    });

    await adapter.respond({
      ...request,
      tools: [{
        name: "count",
        description: "Count",
        strict: true,
        parameters: {
          root: {
            tag: "RecordShape",
            name: "count",
            fields: [{
              name: "value",
              optional: false,
              shape: { tag: "I64Shape" },
            }],
          },
          definitions: [],
        },
      }],
    }, context);

    assert.deepEqual(sentBody?.tools[0].parameters.properties.value, {
      type: "integer",
      minimum: -Number.MAX_SAFE_INTEGER,
      maximum: Number.MAX_SAFE_INTEGER,
    });
  });

  it("uses the continuation token for tool output turns", async () => {
    let sentBody: Record<string, any> | undefined;
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body));
        return Response.json({ id: "resp_2", output: [], usage: {} });
      },
    });

    await adapter.respond({
      ...request,
      continuation_token: "resp_1",
      input: [
        ...request.input,
        { tag: "ToolCall" as const, call_id: "call_1", name: "add", arguments: "{}" },
        { tag: "Message" as const, role: { tag: "Assistant" as const }, content: "Working" },
        { tag: "ToolOutput" as const, call_id: "call_1", output: "3" },
      ],
      input_delta: [
        { tag: "ToolOutput", call_id: "call_1", output: "3" },
      ],
    }, context);

    assert.equal(sentBody?.previous_response_id, "resp_1");
    assert.deepEqual(sentBody?.input, [{
      type: "function_call_output",
      call_id: "call_1",
      output: "3",
    }]);
  });

  it("does not retain continuation state for one-shot requests", async () => {
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async () => Response.json({
        id: "resp_one_shot",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "Checkpoint" }],
        }],
        usage: {},
      }),
    });

    const result = await adapter.respond({
      ...request,
      retain_continuation: false,
    }, context);

    assert.equal(result.tag, "LlmSucceeded");
    if (result.tag === "LlmSucceeded") {
      assert.equal(result.response.continuation_token, null);
    }
  });

  it("compacts native OpenAI context with opaque response items intact", async () => {
    const requestedUrls: string[] = [];
    const sentBodies: Record<string, any>[] = [];
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async (input, init) => {
        requestedUrls.push(String(input));
        sentBodies.push(JSON.parse(String(init?.body)) as Record<string, any>);
        if (requestedUrls.length === 1) {
          return Response.json({
            id: "resp_tool",
            status: "completed",
            output: [
              {
                id: "reasoning_1",
                type: "reasoning",
                encrypted_content: "opaque-reasoning",
              },
              {
                id: "fc_1",
                type: "function_call",
                status: "completed",
                call_id: "call_1",
                name: "add",
                arguments: "{}",
              },
            ],
            usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
          });
        }
        return Response.json({
          id: "cmp_1",
          object: "response.compaction",
          output: [{
            id: "cmp_item_1",
            type: "compaction",
            encrypted_content: "opaque-compaction",
          }],
          usage: { input_tokens: 16, output_tokens: 2, total_tokens: 18 },
        });
      },
    });

    const first = await adapter.respond(request, context);
    assert.equal(first.tag, "LlmSucceeded");
    if (first.tag !== "LlmSucceeded") assert.fail("expected tool response");

    assert.ok(adapter.compactNative);
    const compacted = await adapter.compactNative({
      ...request,
      continuation_token: first.response.continuation_token,
      input: [
        ...request.input,
        { tag: "ToolCall", call_id: "call_1", name: "add", arguments: "{}" },
        { tag: "ToolOutput", call_id: "call_1", output: "3" },
      ],
      input_delta: [{ tag: "ToolOutput", call_id: "call_1", output: "3" }],
      compaction: {
        trigger_tokens: 1000,
        keep_recent_items: 2,
        instructions: "",
        model: "",
        prefer_native: true,
      },
      overflow_recovery: false,
    }, context);

    assert.deepEqual(requestedUrls, [
      "https://api.openai.com/v1/responses",
      "https://api.openai.com/v1/responses/compact",
    ]);
    assert.deepEqual(sentBodies[1], {
      model: "gpt-test",
      input: [
        { role: "user", content: "What is 1 + 2?" },
      ],
    });
    assert.deepEqual(compacted, {
      tag: "CompactionSucceeded",
      response: {
        input: [
          {
            tag: "ProviderItem",
            provider: "openai.responses",
            data: JSON.stringify({
              id: "cmp_item_1",
              type: "compaction",
              encrypted_content: "opaque-compaction",
            }),
          },
          {
            tag: "ProviderItem",
            provider: "openai.responses",
            data: JSON.stringify({
              id: "reasoning_1",
              type: "reasoning",
              encrypted_content: "opaque-reasoning",
            }),
          },
          { tag: "ToolCall", call_id: "call_1", name: "add", arguments: "{}" },
          { tag: "ToolOutput", call_id: "call_1", output: "3" },
        ],
        continuation_token: null,
        usage: { input_tokens: 16, output_tokens: 2, total_tokens: 18 },
      },
    });
  });

  it("compacts an entire atomic response batch when opaque reasoning exceeds the suffix budget", async () => {
    const sentBodies: Record<string, any>[] = [];
    const largeReasoning = "r".repeat(5_000);
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async (_input, init) => {
        sentBodies.push(JSON.parse(String(init?.body)) as Record<string, any>);
        if (sentBodies.length === 1) {
          return Response.json({
            id: "resp_large_reasoning",
            status: "completed",
            output: [
              {
                id: "reasoning_large",
                type: "reasoning",
                encrypted_content: largeReasoning,
              },
              {
                type: "function_call",
                call_id: "call_1",
                name: "add",
                arguments: "{}",
              },
            ],
            usage: {},
          });
        }
        return Response.json({
          id: "cmp_large_reasoning",
          object: "response.compaction",
          output: [{
            id: "cmp_large_reasoning_item",
            type: "compaction",
            encrypted_content: "opaque-compaction",
          }],
          usage: { input_tokens: 1500, output_tokens: 20, total_tokens: 1520 },
        });
      },
    });
    const first = await adapter.respond(request, context);
    assert.equal(first.tag, "LlmSucceeded");
    if (first.tag !== "LlmSucceeded") assert.fail("expected tool response");

    assert.ok(adapter.compactNative);
    const compacted = await adapter.compactNative({
      ...request,
      continuation_token: first.response.continuation_token,
      input: [
        ...request.input,
        { tag: "ToolCall", call_id: "call_1", name: "add", arguments: "{}" },
        { tag: "ToolOutput", call_id: "call_1", output: "3" },
      ],
      input_delta: [{ tag: "ToolOutput", call_id: "call_1", output: "3" }],
      overflow_recovery: false,
      compaction: {
        trigger_tokens: 1000,
        keep_recent_items: 2,
        instructions: "",
        model: "",
        prefer_native: true,
      },
    }, context);

    assert.equal(sentBodies[1]?.input.length, 4);
    assert.equal(sentBodies[1]?.input[1]?.encrypted_content, largeReasoning);
    assert.equal(compacted.tag, "CompactionSucceeded");
    if (compacted.tag === "CompactionSucceeded") {
      assert.equal(compacted.response.input.length, 1);
    }
  });

  it("maps complete tool transcripts for stateless providers", async () => {
    let sentBody: Record<string, any> | undefined;
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body));
        return Response.json({ id: "resp_stateless", output: [], usage: {} });
      },
    });

    await adapter.respond({
      ...request,
      input: [
        ...request.input,
        { tag: "ToolCall", call_id: "call_1", name: "add", arguments: "{}" },
        { tag: "ToolOutput", call_id: "call_1", output: "3" },
      ],
    }, context);

    assert.deepEqual(sentBody?.input, [
      { role: "user", content: "What is 1 + 2?" },
      { type: "function_call", call_id: "call_1", name: "add", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "3" },
    ]);
    assert.equal(sentBody?.previous_response_id, undefined);
  });

  it("returns typed retryable API errors", async () => {
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async () => Response.json(
        { error: { code: "rate_limit_exceeded", message: "Slow down" } },
        { status: 429 },
      ),
    });

    assert.deepEqual(
      await adapter.respond(request, context),
      {
        tag: "LlmFailed",
        error: {
          code: "rate_limit_exceeded",
          message: "Slow down",
          retryable: true,
        },
      },
    );
  });

  it("rejects incomplete terminal responses instead of returning partial output", async () => {
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async () => Response.json({
        id: "resp_incomplete",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{
          type: "message",
          content: [{ type: "output_text", text: "partial" }],
        }],
      }),
    });

    const result = await adapter.respond(request, context);

    assert.equal(result.tag, "LlmFailed");
    if (result.tag === "LlmFailed") {
      assert.equal(result.error.code, "response_incomplete");
      assert.equal(result.error.retryable, true);
    }
  });

  it("surfaces completed refusal content as model text", async () => {
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async () => Response.json({
        id: "resp_refusal",
        status: "completed",
        output: [{
          type: "message",
          content: [{ type: "refusal", refusal: "I cannot help with that." }],
        }],
        usage: {},
      }),
    });

    const result = await adapter.respond(request, context);

    assert.equal(result.tag, "LlmSucceeded");
    if (result.tag === "LlmSucceeded") {
      assert.deepEqual(result.response.output, [{
        tag: "Text",
        text: "I cannot help with that.",
      }]);
    }
  });

  it("classifies request timeouts as retryable", async () => {
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      timeoutMs: 1,
      fetch: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
    });

    const result = await adapter.respond(request, context);

    assert.deepEqual(result, {
      tag: "LlmFailed",
      error: {
        code: "request_timeout",
        message: "OpenAI request timed out",
        retryable: true,
      },
    });
  });

  it("classifies transient fetch failures as retryable network errors", async () => {
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    assert.deepEqual(await adapter.respond(request, context), {
      tag: "LlmFailed",
      error: { code: "network_error", message: "fetch failed", retryable: true },
    });
  });

  it("streams fragmented SSE deltas through cursors", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"type":"response.created","response":{"id":"resp_stream"}}\n',
      '\ndata: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp_stream",',
      '"output":[{"type":"message","content":[{"type":"output_text","text":"Hello"}]}],',
      '"usage":{"input_tokens":2,"output_tokens":1,"total_tokens":3}}}\n\n',
    ];
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async () => new Response(new ReadableStream({
        start(controller) {
          chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
          controller.close();
        },
      }), { headers: { "content-type": "text/event-stream" } }),
    });

    const started = await adapter.openStream(request, context);
    assert.equal(started.tag, "StreamSucceeded");
    if (started.tag !== "StreamSucceeded" || started.step.tag !== "Event") {
      assert.fail("expected the stream to start with an event");
    }
    assert.equal(started.step.event.tag, "Started");
    const cursor = started.step.cursor;

    const first = await adapter.nextStream(cursor, context);
    const second = await adapter.nextStream(cursor, context);
    const done = await adapter.nextStream(cursor, context);

    if (first.tag !== "StreamSucceeded" || first.step.tag !== "Event") {
      assert.fail("expected the first delta event");
    }
    if (second.tag !== "StreamSucceeded" || second.step.tag !== "Event") {
      assert.fail("expected the second delta event");
    }
    if (done.tag !== "StreamSucceeded" || done.step.tag !== "Done") {
      assert.fail("expected the completed response");
    }
    assert.deepEqual(first.step.event, { tag: "TextDelta", delta: "Hel" });
    assert.deepEqual(second.step.event, { tag: "TextDelta", delta: "lo" });
    assert.deepEqual(done.step.response.output, [{ tag: "Text", text: "Hello" }]);

    assert.deepEqual(
      await adapter.nextStream(cursor, context),
      {
        tag: "StreamFailed",
        error: {
          code: "invalid_stream_cursor",
          message: "The model stream is no longer active",
          retryable: false,
        },
      },
    );
  });

  it("preserves request_timeout after a stream has started", async () => {
    const encoder = new TextEncoder();
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      timeoutMs: 25,
      fetch: async (_input, init) => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            'data: {"type":"response.created","response":{"id":"resp_timeout"}}\n\n',
          ));
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        },
      })),
    });

    const started = await adapter.openStream(request, context);
    if (started.tag !== "StreamSucceeded" || started.step.tag !== "Event") {
      assert.fail("expected a started stream event");
    }

    assert.deepEqual(await adapter.nextStream(started.step.cursor, context), {
      tag: "StreamFailed",
      error: {
        code: "request_timeout",
        message: "OpenAI request timed out",
        retryable: true,
      },
    });
  });

  it("preserves provider codes and messages from streaming error events", async () => {
    const encoder = new TextEncoder();
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            'data: {"type":"error","code":"server_error","message":"Try again"}\n\n',
          ));
          controller.close();
        },
      })),
    });

    assert.deepEqual(await adapter.openStream(request, context), {
      tag: "StreamFailed",
      error: { code: "server_error", message: "Try again", retryable: true },
    });
  });

  it("preserves terminal stream failure and incomplete metadata", async () => {
    const cases = [
      {
        event: {
          type: "response.failed",
          response: { error: { code: "server_error", message: "Try later" } },
        },
        expected: { code: "server_error", message: "Try later", retryable: true },
      },
      {
        event: {
          type: "response.incomplete",
          response: { incomplete_details: { reason: "max_output_tokens" } },
        },
        expected: {
          code: "response_incomplete",
          message: "max_output_tokens",
          retryable: true,
        },
      },
    ];

    for (const testCase of cases) {
      const encoder = new TextEncoder();
      const adapter = createOpenAIResponsesAdapter({
        apiKey: "test-key",
        fetch: async () => new Response(new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify(testCase.event)}\n\n`,
            ));
            controller.close();
          },
        })),
      });

      assert.deepEqual(await adapter.openStream(request, context), {
        tag: "StreamFailed",
        error: testCase.expected,
      });
    }
  });

  it("rejects non-record tool shapes before sending a request", async () => {
    let called = false;
    const adapter = createOpenAIResponsesAdapter({
      apiKey: "test-key",
      fetch: async () => {
        called = true;
        return Response.json({});
      },
    });

    const value = await adapter.respond({
      ...request,
      tools: [{
        ...request.tools[0],
        parameters: { root: { tag: "StringShape" }, definitions: [] },
      }],
    }, context);

    assert.equal(called, false);
    assert.equal(value.tag, "LlmFailed");
    assert.equal(value.error.code, "invalid_tool_schema");
  });
});

const context = { registerResourceCleanup: () => undefined };
