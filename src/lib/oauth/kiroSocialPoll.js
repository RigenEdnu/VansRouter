/**
 * Kiro Social Poll helper
 * Handles state transitions and classification for Kiro device-code social login
 */

/**
 * RFC 8628 requires every later device-code poll to retain a `slow_down`
 * increase. Keeping this transition pure makes the UI retry behaviour testable.
 *
 * @param {number} currentIntervalMs
 * @param {unknown} error
 * @returns {number}
 */
export function getNextKiroSocialPollInterval(currentIntervalMs, error) {
  return error === "slow_down" ? currentIntervalMs + 5000 : currentIntervalMs;
}

function errorCode(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "authorization_failed";
}

/**
 * Classifies the outcome of polling Kiro social device token
 *
 * @param {boolean} responseOk
 * @param {number} responseStatus
 * @param {object} data
 * @returns {{ kind: "pending", error: "authorization_pending" | "slow_down" } | { kind: "error", error: string, status: number } | { kind: "success" }}
 */
export function classifyKiroSocialPoll(responseOk, responseStatus, data) {
  if (!data) {
    return { kind: "error", error: "invalid_response", status: responseStatus || 500 };
  }

  const progress = data.error ?? data.status;
  if (progress === "authorization_pending" || progress === "slow_down") {
    return { kind: "pending", error: progress };
  }

  if (!responseOk || data.error) {
    const status = responseStatus >= 400 && responseStatus <= 599 ? responseStatus : 400;
    return { kind: "error", error: errorCode(data.error), status };
  }

  if (!data.accessToken && !data.refreshToken) {
    return { kind: "error", error: "invalid_token_response", status: 502 };
  }

  return { kind: "success" };
}
