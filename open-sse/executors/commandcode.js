import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { inspectAndWrapCommandCodeResponse, parseCommandCodeError } from "./commandcodeResponse.js";

/**
 * CommandCodeExecutor — talks to https://api.commandcode.ai/alpha/generate
 *
 * Auth: Bearer <user_xxx> API key (stored as the connection's apiKey).
 * Adds the per-request `x-session-id` header expected by CommandCode upstream.
 */
export class CommandCodeExecutor extends BaseExecutor {
  constructor() {
    super("commandcode", PROVIDERS.commandcode);
  }

  transformRequest(model, body, stream, credentials) {
    body.stream = true;
    return body;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...(this.config.headers || {}),
      "x-session-id": randomUUID(),
    };

    const token = credentials?.apiKey || credentials?.accessToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async execute(opts) {
    const result = await super.execute(opts);
    if (!result?.response?.ok || !result.response.body) return result;
    result.response = await inspectAndWrapCommandCodeResponse(result.response, opts.model);
    return result;
  }

  parseError(response, bodyText) {
    let parsed = null;
    try { parsed = JSON.parse(bodyText || "{}"); } catch { parsed = null; }
    const errObj = parsed?.error || parsed;
    const msg = errObj?.message || parsed?.message || bodyText || response.statusText;
    const status = Number(errObj?.code || errObj?.statusCode || response.status) || response.status;
    return { status, message: msg || `CommandCode upstream error: ${response.status}` };
  }
}

export { inspectAndWrapCommandCodeResponse, parseCommandCodeError };
