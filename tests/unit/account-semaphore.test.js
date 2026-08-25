import { describe, it, expect } from "vitest";

import {
  acquire,
  markBlocked,
  getAccountSemaphoreStats,
  isSemaphoreCapacityError,
  buildAccountSemaphoreKey,
  resolveAccountSemaphoreKey,
  resolveAccountSemaphoreMaxConcurrency,
  SemaphoreCapacityError,
} from "../../open-sse/services/accountSemaphore.js";

describe("AccountSemaphore", () => {
  describe("buildAccountSemaphoreKey", () => {
    it("builds a provider:accountKey:proxyHash string", () => {
      // Proxy-aware: key includes proxy hash suffix (:direct when no proxy)
      expect(buildAccountSemaphoreKey({ provider: "kimchi", accountKey: "acc-1" })).toBe("kimchi:acc-1:direct");
    });

    it("stringifies non-string values", () => {
      expect(buildAccountSemaphoreKey({ provider: 42, accountKey: null })).toBe("42:null:direct");
    });
  });

  describe("acquire", () => {
    it("returns a release function when concurrency is not reached", async () => {
      const key = buildAccountSemaphoreKey({ provider: "acquire-test-1", accountKey: "acc" });
      const release = await acquire(key, { maxConcurrency: 1 });
      expect(typeof release).toBe("function");
      release();
    });

    it("queues the second request when at concurrency cap", async () => {
      const key = buildAccountSemaphoreKey({ provider: "acquire-test-2", accountKey: "acc" });
      const release1 = await acquire(key, { maxConcurrency: 1 });
      try {
        // Second acquire should time out (we have 50ms timeout)
        await expect(
          acquire(key, { maxConcurrency: 1, timeoutMs: 50 })
        ).rejects.toThrow(SemaphoreCapacityError);
      } finally {
        release1();
      }
    });

    it("drains queued requests after release", async () => {
      const key = buildAccountSemaphoreKey({ provider: "acquire-test-3", accountKey: "acc" });
      const release1 = await acquire(key, { maxConcurrency: 1 });
      const promise2 = acquire(key, { maxConcurrency: 1, timeoutMs: 500 });
      release1();
      const release2 = await promise2;
      release2();
    });

    it("bypasses when maxConcurrency is 0 or null", async () => {
      const key1 = buildAccountSemaphoreKey({ provider: "acquire-bypass-1", accountKey: "acc" });
      const key2 = buildAccountSemaphoreKey({ provider: "acquire-bypass-2", accountKey: "acc" });
      const release1 = await acquire(key1, { maxConcurrency: 0 });
      const release2 = await acquire(key2, { maxConcurrency: null });
      release1();
      release2();
    });

    it("throws SemaphoreCapacityError when queue is full", async () => {
      const key = buildAccountSemaphoreKey({ provider: "acquire-test-queue", accountKey: "acc" });
      const release1 = await acquire(key, { maxConcurrency: 1 });
      try {
        // Fill the queue (maxQueueSize defaults to 20)
        // First entry is already in the queue (waiting)
        await expect(
          acquire(key, { maxConcurrency: 1, timeoutMs: 0, maxQueueSize: 1 })
        ).rejects.toThrow(SemaphoreCapacityError);
      } finally {
        release1();
      }
    });
  });

  describe("markBlocked", () => {
    it("blocks new acquires on the gate for the given duration", async () => {
      const key = buildAccountSemaphoreKey({ provider: "mark-blocked-1", accountKey: "acc" });
      const release = await acquire(key, { maxConcurrency: 1 });
      try {
        markBlocked(key, 100);
        // New acquire should queue because gate is blocked
        await expect(
          acquire(key, { maxConcurrency: 1, timeoutMs: 30 })
        ).rejects.toThrow(SemaphoreCapacityError);
      } finally {
        release();
      }
    });

    it("wakes queued waiters automatically when the block expires", async () => {
      const key = buildAccountSemaphoreKey({ provider: "mark-blocked-wake", accountKey: "acc" });
      const release = await acquire(key, { maxConcurrency: 1 });
      let granted = false;
      markBlocked(key, 80);
      const second = acquire(key, { maxConcurrency: 1, timeoutMs: 5000 }).then((rel) => {
        granted = true;
        return rel;
      });
      // Slot frees up but the gate is blocked — waiter must stay queued.
      release();
      await new Promise((r) => setTimeout(r, 30));
      expect(granted).toBe(false);
      // Granted by the block-expiry wake timer alone — no further acquire() call.
      const release2 = await second;
      expect(granted).toBe(true);
      release2();
    });
  });

  describe("isSemaphoreCapacityError", () => {
    it("returns true for SemaphoreCapacityError instances", () => {
      const err = new SemaphoreCapacityError("test", 100);
      expect(isSemaphoreCapacityError(err)).toBe(true);
    });

    it("returns false for other errors", () => {
      expect(isSemaphoreCapacityError(new Error("other"))).toBe(false);
      expect(isSemaphoreCapacityError("string")).toBe(false);
      expect(isSemaphoreCapacityError(null)).toBe(false);
    });
  });

  describe("getAccountSemaphoreStats", () => {
    it("returns stats for active gates", async () => {
      const key = buildAccountSemaphoreKey({ provider: "stats-test", accountKey: "acc" });
      const release = await acquire(key, { maxConcurrency: 2 });
      try {
        const stats = getAccountSemaphoreStats();
        const gate = stats.find(s => s.key === key);
        expect(gate).toBeDefined();
        expect(gate.running).toBe(1);
        expect(gate.maxConcurrency).toBe(2);
      } finally {
        release();
      }
    });
  });

  describe("idle gate cleanup", () => {
    it("deletes the gate once all slots are released and the queue is empty", async () => {
      const key = buildAccountSemaphoreKey({ provider: "cleanup-test", accountKey: "acc" });
      const release = await acquire(key, { maxConcurrency: 1 });
      expect(getAccountSemaphoreStats().some(s => s.key === key)).toBe(true);
      release();
      // Wait for the immediate cleanup timer to fire.
      await new Promise(r => setTimeout(r, 20));
      expect(getAccountSemaphoreStats().some(s => s.key === key)).toBe(false);
    });
  });

  describe("resolveAccountSemaphoreKey", () => {
    it("returns null when provider is missing", () => {
      expect(resolveAccountSemaphoreKey({ provider: null, connectionId: "x" })).toBe(null);
    });

    it("returns null when connectionId is missing", () => {
      expect(resolveAccountSemaphoreKey({ provider: "kimchi", connectionId: null })).toBe(null);
    });

    it("returns provider:connectionId when both present", () => {
      expect(
        resolveAccountSemaphoreKey({ provider: "kimchi", connectionId: "acc-7" })
      ).toBe("kimchi:acc-7:direct");
    });
  });

  describe("resolveAccountSemaphoreMaxConcurrency", () => {
    it("returns 3 as default when not configured", () => {
      expect(resolveAccountSemaphoreMaxConcurrency(null)).toBe(3);
      expect(resolveAccountSemaphoreMaxConcurrency({})).toBe(3);
    });

    it("returns null when maxConcurrency is explicitly 0", () => {
      expect(resolveAccountSemaphoreMaxConcurrency({ providerSpecificData: { maxConcurrency: 0 } })).toBe(null);
    });

    it("returns null when maxConcurrency is explicitly null", () => {
      expect(resolveAccountSemaphoreMaxConcurrency({ providerSpecificData: { maxConcurrency: null } })).toBe(null);
    });

    it("returns the configured value when positive", () => {
      expect(resolveAccountSemaphoreMaxConcurrency({ providerSpecificData: { maxConcurrency: 5 } })).toBe(5);
    });
  });
});
