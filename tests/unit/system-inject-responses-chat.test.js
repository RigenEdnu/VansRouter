import { describe, expect, it } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("systemInject - OpenAI Responses & Chat regression (#106 / #2497)", () => {
  it("injects typed message for openai-responses when input array is present", () => {
    const body = {
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "respond tersely");

    expect(body.input[0]).toEqual({
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: "respond tersely" }],
    });
    expect(body.input[1]).toEqual({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hello" }],
    });
  });

  it("appends to existing top-level instructions for openai-responses", () => {
    const body = {
      instructions: "base instructions",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "respond tersely");

    expect(body.instructions).toBe("base instructions\n\nrespond tersely");
  });

  it("injects {type: 'text'} when chat system content is an array", () => {
    const body = {
      messages: [
        { role: "system", content: [{ type: "text", text: "base" }] },
        { role: "user", content: "hello" },
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI, "respond tersely");

    expect(body.messages[0].content).toEqual([
      { type: "text", text: "base" },
      { type: "text", text: "respond tersely" },
    ]);
  });

  it("unshifts a standard {role: 'system', content: string} when chat has no system message", () => {
    const body = {
      messages: [{ role: "user", content: "hello" }],
    };

    injectSystemPrompt(body, FORMATS.OPENAI, "respond tersely");

    expect(body.messages[0]).toEqual({ role: "system", content: "respond tersely" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hello" });
  });
});
