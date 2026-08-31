// Shared system-prompt injector: appends an instruction into the system message of
// the final request body, dispatching by format so it works for translated and
// native-passthrough flows. Used by caveman.js and ponytail.js.

import { FORMATS } from "../translator/formats.js";
import {
  injectChatSystem,
  injectClaudeSystem,
  injectGeminiSystem,
  injectInstructionsSystem,
  injectKiroSystem,
  injectResponsesInputSystem,
} from "./formatInjectors.js";

export function injectSystemPrompt(body, format, prompt) {
  try {
    if (!body || !prompt || typeof body !== "object") return;
    if (isKiroBody(body) || format === FORMATS.KIRO) {
      injectKiroSystem(body, prompt);
      return;
    }
    if (format === FORMATS.CLAUDE) {
      injectClaudeSystem(body, prompt);
      return;
    }
    if (format === FORMATS.GEMINI || format === FORMATS.GEMINI_CLI
      || format === FORMATS.VERTEX || format === FORMATS.ANTIGRAVITY) {
      injectGeminiSystem(body, prompt);
      return;
    }
    if (typeof body.instructions === "string") {
      injectInstructionsSystem(body, prompt);
      return;
    }
    if (Array.isArray(body.messages)) {
      injectChatSystem(body, prompt);
      return;
    }
    if (Array.isArray(body.input)) injectResponsesInputSystem(body, prompt);
  } catch (_) {
    // fail-open
  }
}

function isKiroBody(body) {
  if (!body || typeof body !== "object" || typeof body.systemPrompt !== "string") return false;
  const cs = body.conversationState;
  return !!cs && typeof cs === "object" && (Array.isArray(cs.history) || !!(cs.currentMessage && typeof cs.currentMessage === "object"));
}
