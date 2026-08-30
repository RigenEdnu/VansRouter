import { describe, it, expect } from "vitest";
import { classifyKiroSocialPoll, getNextKiroSocialPollInterval } from "@/lib/oauth/kiroSocialPoll";
import { findKiroConnectionByIdentity } from "@/lib/oauth/kiroConnectionIdentity";

describe("kiroSocialPoll helper", () => {
  it("classifies pending and slow_down statuses", () => {
    expect(classifyKiroSocialPoll(true, 200, { status: "authorization_pending" })).toEqual({
      kind: "pending",
      error: "authorization_pending",
    });
    expect(classifyKiroSocialPoll(false, 400, { error: "slow_down" })).toEqual({
      kind: "pending",
      error: "slow_down",
    });
  });

  it("classifies error responses", () => {
    expect(classifyKiroSocialPoll(false, 403, { error: "access_denied" })).toEqual({
      kind: "error",
      error: "access_denied",
      status: 403,
    });
  });

  it("classifies success responses", () => {
    expect(
      classifyKiroSocialPoll(true, 200, {
        accessToken: "tok_123",
        refreshToken: "ref_123",
      })
    ).toEqual({ kind: "success" });
  });

  it("adjusts poll interval on slow_down", () => {
    expect(getNextKiroSocialPollInterval(5000, "authorization_pending")).toBe(5000);
    expect(getNextKiroSocialPollInterval(5000, "slow_down")).toBe(10000);
  });
});

describe("kiroConnectionIdentity helper", () => {
  it("matches connections by email", () => {
    const existing = [
      { id: "1", authType: "oauth", email: "user@example.com" },
      { id: "2", authType: "oauth", email: "other@example.com" },
    ];
    const match = findKiroConnectionByIdentity(existing, {
      authType: "oauth",
      email: "USER@EXAMPLE.COM",
    });
    expect(match?.id).toBe("1");
  });

  it("does not overwrite different account on shared profileArn", () => {
    const existing = [
      {
        id: "1",
        authType: "oauth",
        email: "first@example.com",
        providerSpecificData: { profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/p-1" },
      },
    ];
    const match = findKiroConnectionByIdentity(existing, {
      authType: "oauth",
      profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/p-1",
      email: "second@example.com",
    });
    expect(match).toBeNull();
  });
});
