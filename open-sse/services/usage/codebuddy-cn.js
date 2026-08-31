/**
 * CodeBuddy CN usage handler
 *
 * Shared by the "codebuddy-cn" and "codebuddy-intl" providers. Both billing
 * endpoints return the same Tencent-shaped payload.
 *
 * Quota lives behind a Tencent billing endpoint (POST, payload wrapped twice
 * under data.Response.Data). It mixes two credit types that must NOT be merged:
 *
 *  - Refill / base ("基础体验包"): a recurring allowance whose cycle resets long
 *    before the resource itself expires (CycleEndTime << DeductionEndTime). The
 *    live numbers live in the *Cycle* fields (e.g. CycleCapacityUsed 6.54 / 500)
 *    and resetAt is the next monthly refresh.
 *  - Bonus ("活动赠送包"): one-shot credits that run a single cycle and then
 *    expire for good (CycleEndTime == DeductionEndTime). Numbers live in the
 *    plain Capacity fields.
 *
 * We surface one quota row per package — a cadence label (Monthly/Weekly/Daily)
 * for refill packs, "Bonus Pack N" for bonus packs (soonest-expiring first).
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { PROVIDERS } from "../../providers/index.js";
import { U, parseResetTime } from "./shared.js";

const PROVIDER_ID = "codebuddy-cn";

function providerLabel(providerId) {
  return providerId === "codebuddy-intl" ? "CodeBuddy Intl" : "CodeBuddy CN";
}

// Prefer the *Precise string fields (exact), fall back to the numeric ones.
function num(precise, plain) {
  const n = Number(precise ?? plain);
  return Number.isFinite(n) ? n : 0;
}

// Label a refill pack by its cycle length (Monthly is the common CodeBuddy case).
function refillCadence(acc) {
  const start = parseResetTime(acc.CycleStartTime);
  const end = parseResetTime(acc.CycleEndTime);
  if (start && end) {
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000;
    if (days <= 1.5) return "Daily";
    if (days <= 10) return "Weekly";
  }
  return "Monthly";
}

export function parseCodeBuddyUsage(json, providerId = PROVIDER_ID) {
  const label = providerLabel(providerId);
  if (json?.code !== 0) {
    return { message: `${label} quota error: ${json?.msg || "unknown"}` };
  }

  const accounts = json?.data?.Response?.Data?.Accounts;
  if (!Array.isArray(accounts)) {
    return { message: `${label} connected. Usage payload malformed.` };
  }
  if (accounts.length === 0) {
    return { message: `${label} connected. No credit package found.` };
  }

  const cycleEndMs = (acc) => {
    const r = parseResetTime(acc.CycleEndTime);
    return r ? new Date(r).getTime() : Number.POSITIVE_INFINITY;
  };
  const deductionEndMs = (acc) => {
    const r = parseResetTime(acc.DeductionEndTime);
    return r ? new Date(r).getTime() : Number.NEGATIVE_INFINITY;
  };
  // Refill packs roll into a new cycle before the resource expires; bonus packs
  // end exactly at expiry. >2d gap between cycle end and validity end = refill.
  const REFILL_GAP_MS = 2 * 24 * 60 * 60 * 1000;
  const isRefill = (acc) => {
    const ce = cycleEndMs(acc);
    const de = deductionEndMs(acc);
    return Number.isFinite(ce) && Number.isFinite(de) && de - ce > REFILL_GAP_MS;
  };
  const byExpiry = (a, b) => cycleEndMs(a) - cycleEndMs(b);

  const refills = accounts.filter(isRefill).sort(byExpiry);
  const bonuses = accounts.filter((a) => !isRefill(a)).sort(byExpiry);

  const quotas = {};
  // Refill packs first: cadence-labelled, using the *Cycle* balance and
  // resetting at the next refresh.
  const seenRefill = {};
  refills.forEach((acc) => {
    const base = refillCadence(acc);
    seenRefill[base] = (seenRefill[base] || 0) + 1;
    const name = seenRefill[base] > 1 ? `${base} ${seenRefill[base]}` : base;
    quotas[name] = {
      used: num(acc.CycleCapacityUsedPrecise, acc.CycleCapacityUsed),
      total: num(acc.CycleCapacitySizePrecise, acc.CycleCapacitySize),
      resetAt: parseResetTime(acc.CycleEndTime),
      unlimited: false,
      recurring: true,
    };
  });
  // Bonus packs: use the lifetime Capacity balance; resetAt is the expiry.
  // These are one-shot credits, so mark recurring:false.
  bonuses.forEach((acc, i) => {
    quotas[`Bonus Pack ${i + 1}`] = {
      used: num(acc.CapacityUsedPrecise, acc.CapacityUsed),
      total: num(acc.CapacitySizePrecise, acc.CapacitySize),
      resetAt: parseResetTime(acc.CycleEndTime),
      unlimited: false,
      recurring: false,
    };
  });

  const basePkg = refills[0] || accounts[0] || {};
  const plan = basePkg.PackageName || basePkg.SubProductName || "CodeBuddy";
  return { plan, quotas };
}

async function getCodeBuddyUsage(providerId, accessToken, apiKey, providerSpecificData, proxyOptions = null) {
  const label = providerLabel(providerId);
  const token = accessToken || apiKey;
  if (!token) {
    return { message: `${label} credential not available.` };
  }

  try {
    const response = await proxyAwareFetch(U(providerId).url, {
      method: "POST",
      headers: {
        ...(PROVIDERS[providerId]?.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: `${label} credential invalid or expired.` };
    }
    if (!response.ok) {
      return { message: `${label} quota API error (${response.status}).` };
    }

    return parseCodeBuddyUsage(await response.json(), providerId);
  } catch (error) {
    return { message: `${label} error: ${error.message}` };
  }
}

export async function getCodeBuddyCnUsage(accessToken, apiKey, providerSpecificData, proxyOptions = null) {
  return getCodeBuddyUsage(PROVIDER_ID, accessToken, apiKey, providerSpecificData, proxyOptions);
}

export async function getCodeBuddyIntlUsage(accessToken, apiKey, providerSpecificData, proxyOptions = null) {
  return getCodeBuddyUsage("codebuddy-intl", accessToken, apiKey, providerSpecificData, proxyOptions);
}
