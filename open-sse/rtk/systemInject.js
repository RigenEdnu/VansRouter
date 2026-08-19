// Shared system-prompt injector: appends an instruction into the system message of
// the final request body, dispatching by format so it works for translated and
// native-passthrough flows. Used by caveman.js and ponytail.js.

import { FORMATS } from "../translator/formats.js";

const SEP = "\n\n";

export function injectSystemPrompt(body, format, prompt) {
  if (!body || !prompt) return;

  switch (format) {
    case FORMATS.CLAUDE:
      injectClaudeSystem(body, prompt);
      return;
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.VERTEX:
    case FORMATS.ANTIGRAVITY:
      // Antigravity wraps Gemini shape in body.request → injectGeminiSystem handles it
      injectGeminiSystem(body, prompt);
      return;
    case FORMATS.KIRO:
      injectKiroSystem(body, prompt);
      return;
    case FORMATS.OPENAI_RESPONSES:
    case FORMATS.OPENAI_RESPONSE:
    case FORMATS.CODEX:
      injectResponsesSystem(body, prompt);
      return;
    default:
      // OpenAI and OpenAI-shaped formats (chat completions / ollama / cursor)
      injectMessagesSystem(body, prompt);
  }
}

// Kiro shape: top-level systemPrompt or conversationState.currentMessage.userInputMessage.content
function injectKiroSystem(body, prompt) {
  if (typeof body.systemPrompt === "string" && body.systemPrompt.trim()) {
    body.systemPrompt = `${body.systemPrompt}${SEP}${prompt}`;
    return;
  }
  const message = body.conversationState?.currentMessage?.userInputMessage;
  if (message) {
    message.content = [message.content, prompt].filter(Boolean).join(SEP);
  } else {
    body.systemPrompt = prompt;
  }
}

// OpenAI Responses API (e.g. Codex/GPT-5.6 / /v1/responses):
// Top-level string `instructions` is the primary system/instruction mechanism.
// If absent, we append or set top-level `instructions`. Unshifting untyped `{role, content}`
// into `input[]` triggers: "Unknown parameter: 'input[0].content'".
function injectResponsesSystem(body, prompt) {
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    body.instructions = `${body.instructions}${SEP}${prompt}`;
  } else {
    body.instructions = prompt;
  }
}

// OpenAI Chat Completions: messages[]
function injectMessagesSystem(body, prompt) {
  // If request happens to have instructions (e.g. from direct caller), append to it
  if (typeof body.instructions === "string") {
    body.instructions = body.instructions
      ? `${body.instructions}${SEP}${prompt}`
      : prompt;
    return;
  }

  const arr = Array.isArray(body.messages) ? body.messages
    : Array.isArray(body.input) ? body.input
    : null;
  if (!arr) return;

  const idx = arr.findIndex(m => m && (m.role === "system" || m.role === "developer"));
  if (idx >= 0) {
    appendToOpenAIMessage(arr[idx], prompt);
  } else {
    arr.unshift({ role: "system", content: prompt });
  }
}

function appendToOpenAIMessage(msg, prompt) {
  if (typeof msg.content === "string") {
    msg.content = `${msg.content}${SEP}${prompt}`;
  } else if (Array.isArray(msg.content)) {
    // Standard OpenAI chat content parts use {type: "text", text: "..."}
    msg.content.push({ type: "text", text: prompt });
  } else {
    msg.content = prompt;
  }
}

// Claude shape: body.system as string | array of {type:"text", text}
// Insert before the last cache_control block to keep injection inside the cached prefix.
function injectClaudeSystem(body, prompt) {
  if (typeof body.system === "string" && body.system.length > 0) {
    body.system = `${body.system}${SEP}${prompt}`;
    return;
  }
  if (Array.isArray(body.system)) {
    const block = { type: "text", text: prompt };
    let lastCacheIdx = -1;
    for (let i = body.system.length - 1; i >= 0; i--) {
      if (body.system[i]?.cache_control) { lastCacheIdx = i; break; }
    }
    if (lastCacheIdx >= 0) {
      body.system.splice(lastCacheIdx, 0, block);
    } else {
      body.system.push(block);
    }
    return;
  }
  body.system = prompt;
}

// Gemini shape: body.system_instruction | body.systemInstruction | body.request.systemInstruction
// Each shape: { parts: [{ text }] }
function injectGeminiSystem(body, prompt) {
  const target = body.request && typeof body.request === "object" ? body.request : body;
  const useSnake = Object.prototype.hasOwnProperty.call(target, "system_instruction");
  const key = useSnake ? "system_instruction" : "systemInstruction";
  const sys = target[key];
  if (sys && Array.isArray(sys.parts)) {
    sys.parts.push({ text: prompt });
    return;
  }
  target[key] = { parts: [{ text: prompt }] };
}
