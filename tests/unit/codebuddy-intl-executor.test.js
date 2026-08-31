import { describe, expect, it, vi, beforeEach } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";
import { parseCodeBuddyUsage } from "../../open-sse/services/usage/codebuddy-cn.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

const REQUIRED_SYSTEM_PROMPT = "You are CodeBuddy Code.";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function usageConnection() {
  return { provider: "codebuddy-intl", accessToken: "token" };
}

describe("CodeBuddyIntlExecutor request transform", () => {
  const executor = new CodeBuddyIntlExecutor();

  it("prepends the required prompt while preserving client messages", () => {
    const system = { role: "system", content: "Client system" };
    const developer = { role: "developer", content: [{ type: "text", text: "Rules" }] };
    const user = { role: "user", content: "Hello" };
    const assistant = { role: "assistant", content: [{ type: "text", text: "Hi" }] };

    const out = executor.transformRequest("glm-5.2", {
      messages: [system, developer, user, assistant],
    }, false, {});

    expect(out.stream).toBe(true);
    expect(out.messages).toEqual([
      { role: "system", content: REQUIRED_SYSTEM_PROMPT },
      system,
      developer,
      { ...user, content: [{ type: "text", text: "Hello" }] },
      assistant,
    ]);
  });

  it("preserves typed user content and assistant/tool messages", () => {
    const user = { role: "user", content: [{ type: "text", text: "Hello" }, { type: "image_url", image_url: { url: "x" } }] };
    const assistant = { role: "assistant", content: "Hi", tool_calls: [{ id: "call_1", type: "function" }] };
    const tool = { role: "tool", tool_call_id: "call_1", content: [{ type: "text", text: "result" }] };

    const out = executor.transformRequest("glm-5.2", { messages: [user, assistant, tool] }, false, {});

    expect(out.messages).toEqual([
      { role: "system", content: REQUIRED_SYSTEM_PROMPT },
      user,
      assistant,
      tool,
    ]);
  });

  it("does not mutate the input body or messages", () => {
    const body = {
      messages: [
        { role: "system", content: "Client system" },
        { role: "user", content: "Hello" },
      ],
    };
    const original = structuredClone(body);

    executor.transformRequest("glm-5.2", body, false, {});

    expect(body).toEqual(original);
  });

  it("does not duplicate an existing required prompt", () => {
    const out = executor.transformRequest("glm-5.2", {
      messages: [
        { role: "system", content: REQUIRED_SYSTEM_PROMPT },
        { role: "system", content: "Client system" },
        { role: "developer", content: "Rules" },
      ],
    }, false, {});

    expect(out.messages).toEqual([
      { role: "system", content: REQUIRED_SYSTEM_PROMPT },
      { role: "system", content: "Client system" },
      { role: "developer", content: "Rules" },
    ]);
  });
});

describe("CodeBuddy Intl usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["codebuddy-cn", "CodeBuddy CN"],
    ["codebuddy-intl", "CodeBuddy Intl"],
  ])("parses %s payloads with ISO and numeric reset times", (providerId, label) => {
    const result = parseCodeBuddyUsage({
      code: 0,
      data: { Response: { Data: { Accounts: [{
        PackageName: label,
        CycleStartTime: "2026-08-01T00:00:00Z",
        CycleEndTime: "2026-09-01T00:00:00Z",
        DeductionEndTime: String(Date.parse("2026-12-01T00:00:00Z")),
        CycleCapacityUsed: 2,
        CycleCapacitySize: 100,
      }] } } },
    }, providerId);

    expect(result.plan).toBe(label);
    expect(result.quotas.Monthly).toMatchObject({
      used: 2,
      total: 100,
      resetAt: "2026-09-01T00:00:00.000Z",
      recurring: true,
    });
  });

  it.each([
    ["codebuddy-cn", "CodeBuddy CN"],
    ["codebuddy-intl", "CodeBuddy Intl"],
  ])("distinguishes malformed from empty %s payloads", (providerId, label) => {
    expect(parseCodeBuddyUsage({ code: 0 }, providerId).message)
      .toBe(`${label} connected. Usage payload malformed.`);
    expect(parseCodeBuddyUsage({
      code: 0,
      data: { Response: { Data: { Accounts: [] } } },
    }, providerId).message).toBe(`${label} connected. No credit package found.`);
  });

  it("uses the Intl billing endpoint and parses the mocked response", async () => {
    proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        code: 0,
        data: {
          Response: {
            Data: {
              Accounts: [{
                PackageName: "CodeBuddy Intl",
                CycleStartTime: "2026-08-01T00:00:00Z",
                CycleEndTime: "2026-09-01T00:00:00Z",
                DeductionEndTime: String(Date.parse("2026-12-01T00:00:00Z")),
                CycleCapacityUsed: 2,
                CycleCapacitySize: 100,
              }],
            },
          },
        },
      }),
    });

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    const result = await getUsageForProvider({ provider: "codebuddy-intl", accessToken: "token" });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://www.codebuddy.ai/v2/billing/meter/get-user-resource",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
        body: "{}",
      }),
      null
    );
    expect(result.plan).toBe("CodeBuddy Intl");
    expect(result.quotas.Monthly).toMatchObject({ used: 2, total: 100, recurring: true });
  });

  it("returns an auth error for 401", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({}, 401));

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    const result = await getUsageForProvider(usageConnection());

    expect(result.message).toMatch(/invalid or expired/i);
  });

  it("distinguishes malformed from empty fetched payloads", async () => {
    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ code: 0 }));
    const malformed = await getUsageForProvider(usageConnection());
    expect(malformed.message).toMatch(/usage payload malformed/i);

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: { Response: { Data: { Accounts: [] } } },
    }));
    const empty = await getUsageForProvider(usageConnection());
    expect(empty.message).toMatch(/no credit package found/i);
  });

  it("marks bonus packages as non-recurring", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      code: 0,
      data: {
        Response: {
          Data: {
            Accounts: [{
              PackageName: "Bonus",
              CycleEndTime: "2026-09-15T00:00:00Z",
              DeductionEndTime: String(Date.parse("2026-09-15T00:00:00Z")),
              CapacityUsed: 12,
              CapacitySize: 100,
            }],
          },
        },
      },
    }));

    const { getUsageForProvider } = await import("../../open-sse/services/usage.js");
    const result = await getUsageForProvider(usageConnection());

    expect(result.quotas["Bonus Pack 1"]).toMatchObject({
      used: 12,
      total: 100,
      recurring: false,
    });
  });
});
