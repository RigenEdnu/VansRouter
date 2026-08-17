import { describe, it, expect } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

/**
 * Two Kiro defects, both reproduced live against
 * runtime.us-east-1.kiro.dev/generateAssistantResponse.
 *
 * 1. Top-level `systemPrompt`. CodeWhisperer answers ANY payload carrying that
 *    field with 400 {"message":"Improperly formed request.",
 *    "reason":"REQUEST_BODY_INVALID"} — verified by sending the byte-identical
 *    payload with and without it (200 vs 400). The router sets it whenever the
 *    turn carries system text: a client `system` message, the `-thinking` budget
 *    prefix, or the `-agentic` prompt. So every real harness 400'd on its first
 *    turn while a bare "hello" still worked, and the per-account 429/error
 *    bookkeeping cooled the connection down after the retries.
 *
 *    Nothing is lost by dropping it: the same text already reaches the model
 *    through `contentPrefix`, which applyKiroSessionReplay folds into the
 *    session-start user message.
 *
 * 2. Region rewriting. The registry baseUrls are hardcoded us-east-1, and the
 *    old code regionalized them by substituting the region into each
 *    *.amazonaws.com host — producing `codewhisperer.<region>.amazonaws.com`,
 *    which does not resolve outside us-east-1. An IAM Identity Center account
 *    homed elsewhere must use the regional Amazon Q host instead.
 */
const CREDENTIALS = {
  providerSpecificData: {
    authMethod: "social",
    profileArn: "arn:aws:codewhisperer:us-east-1:1:profile/TEST",
  },
};

function openaiBody(overrides = {}) {
  return {
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "hi" },
    ],
    ...overrides,
  };
}

describe("Kiro payload omits the top-level systemPrompt (REQUEST_BODY_INVALID)", () => {
  it("openai -> kiro drops it while keeping the system text in the message content", () => {
    const payload = openaiToKiroRequest(
      "claude-opus-5-thinking-agentic",
      openaiBody(),
      true,
      CREDENTIALS
    );

    expect(payload).not.toHaveProperty("systemPrompt");

    // The directive still has to reach the model, otherwise thinking silently
    // turns off — assert the delivery path rather than just the absence.
    const content = payload.conversationState.currentMessage.userInputMessage.content;
    expect(content).toContain("<thinking_mode>");
    expect(content).toContain("[Context: Current time is");
  });

  it("claude -> kiro drops it too", () => {
    const payload = claudeToKiroRequest(
      "claude-opus-5-thinking-agentic",
      {
        system: "You are a helpful assistant.",
        messages: [{ role: "user", content: "hi" }],
      },
      true,
      CREDENTIALS
    );

    expect(payload).not.toHaveProperty("systemPrompt");
    expect(
      payload.conversationState.currentMessage.userInputMessage.content
    ).toContain("<thinking_mode>");
  });

  it("stays absent for a plain turn that carries no system text at all", () => {
    const payload = openaiToKiroRequest(
      "claude-sonnet-4.5",
      { messages: [{ role: "user", content: "hi" }] },
      true,
      CREDENTIALS
    );
    expect(payload).not.toHaveProperty("systemPrompt");
  });

  it("keeps the fields CodeWhisperer does accept", () => {
    const payload = openaiToKiroRequest("claude-sonnet-4.5", openaiBody(), true, CREDENTIALS);

    // agentContinuationId is what lets Kiro reuse an agent session across turns;
    // dropping it makes every turn look like a fresh conversation and re-bills
    // the whole history, so guard it here.
    expect(payload.conversationState.agentContinuationId).toBeTruthy();
    expect(payload.conversationState.chatTriggerType).toBe("MANUAL");
    expect(payload.profileArn).toBe(CREDENTIALS.providerSpecificData.profileArn);
  });
});

describe("KiroExecutor.getOrderedBaseUrls — non-us-east-1 uses the regional Amazon Q host", () => {
  const executor = new KiroExecutor();

  it("routes an eu-central-1 IdC account to q.<region> only", () => {
    const urls = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "idc", region: "eu-central-1" },
    });

    expect(urls).toEqual([
      "https://q.eu-central-1.amazonaws.com/generateAssistantResponse",
    ]);
  });

  it("never emits a codewhisperer.<region> host, which does not resolve", () => {
    for (const region of ["eu-central-1", "eu-west-1", "us-west-2", "ap-northeast-1"]) {
      const urls = executor.getOrderedBaseUrls({
        providerSpecificData: { authMethod: "idc", region },
      });
      for (const url of urls) {
        expect(url).not.toMatch(/codewhisperer\.(?!us-east-1)/);
      }
    }
  });

  it("applies regardless of auth method, since the region binds the endpoint", () => {
    for (const authMethod of ["idc", "api_key", "external_idp", "social", undefined]) {
      const urls = executor.getOrderedBaseUrls({
        providerSpecificData: { authMethod, region: "eu-central-1" },
      });
      expect(urls).toEqual([
        "https://q.eu-central-1.amazonaws.com/generateAssistantResponse",
      ]);
    }
  });

  it("leaves us-east-1, an unset region and blank whitespace on the registry list", () => {
    const baseUrls = executor.getBaseUrls();
    for (const region of ["us-east-1", undefined, "   "]) {
      expect(
        executor.getOrderedBaseUrls({
          providerSpecificData: { authMethod: "social", region },
        })
      ).toEqual(baseUrls);
    }
  });

  it("still puts the CodeWhisperer surface first for us-east-1 api-key auth", () => {
    const urls = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "api_key" },
    });
    expect(urls[0]).toMatch(/amazonaws\.com/);
  });

  it("trims a padded region before interpolating it into the host", () => {
    const urls = executor.getOrderedBaseUrls({
      providerSpecificData: { authMethod: "idc", region: "  eu-central-1  " },
    });
    expect(urls).toEqual([
      "https://q.eu-central-1.amazonaws.com/generateAssistantResponse",
    ]);
  });

  it("rejects unsafe regions before URL construction", () => {
    expect(() => executor.getOrderedBaseUrls({
      providerSpecificData: { region: "evil.com/x" },
    })).toThrow("Invalid region");
  });

  it.each(["us-gov-west-1", "cn-north-1"])("rejects unsupported AWS partition %s", (region) => {
    expect(() => executor.getOrderedBaseUrls({
      providerSpecificData: { region },
    })).toThrow(`Unsupported Kiro region: ${region}`);
  });

  it("does not duplicate a single regional endpoint as fallback", () => {
    expect(executor.getFallbackCount({
      providerSpecificData: { region: "eu-central-1" },
    })).toBe(1);
  });
});
