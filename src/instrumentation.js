// Next.js instrumentation hook — runs on server startup (Node.js runtime only).
// Reactivates Kimchi provider connections whose monthly quota was exhausted
// once the cooldown (start of new month) has passed, and schedules an hourly
// re-check so reactivation happens even if the process runs across month boundaries.

// Force Node.js runtime so webpack does not try to bundle better-sqlite3 for
// an environment without Node built-ins (fs/path) during `next dev`.
export const runtime = "nodejs";

const REACTIVATION_INTERVAL_MS = 3600_000; // 1 hour

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync");
    startModelCatalogSync();
  }

  // Skip in development: `next dev` bundles instrumentation with webpack and
  // cannot resolve Node built-ins (fs/os) pulled in by better-sqlite3 and some
  // provider registries. Production/standalone builds use the Node runtime and
  // keep those packages external.
  if (process.env.NODE_ENV === "development") return;
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { reactivateExpiredKimchiAccounts } = await import(
    "./sse/services/kimchiQuotaReactivation.js"
  );

  // Run once immediately on startup. Errors are swallowed so a failing DB
  // (e.g. not yet initialized) does not crash the server boot.
  reactivateExpiredKimchiAccounts().catch((e) => {
    // Use console to avoid coupling to the logger which may not be ready yet.
    console.warn("[instrumentation] Kimchi quota reactivation on startup failed:", e?.message || e);
  });

  // Re-check every hour. `.unref?.()` so the timer does not keep the process alive.
  const timer = setInterval(() => {
    reactivateExpiredKimchiAccounts().catch((e) => {
      console.warn("[instrumentation] Kimchi quota reactivation tick failed:", e?.message || e);
    });
  }, REACTIVATION_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
}
