import { OPENAI_BLOCK, CLAUDE_BLOCK, RESPONSES_ITEM } from "../translator/schema/blocks.js";
import { ROLE } from "../translator/schema/roles.js";

const SEP = "\n\n";

function hasPrompt(haystack, prompt) {
  if (!haystack || typeof haystack !== "string") return false;
  if (haystack === prompt) return true;
  return haystack.split(SEP).includes(prompt);
}

function dedupStringAppend(current, prompt) {
  if (!current) return prompt;
  if (hasPrompt(current, prompt)) return current;
  return `${current}${SEP}${prompt}`;
}

export function injectInstructionsSystem(body, prompt) {
  try {
    const current = body.instructions;
    if (typeof current !== "string" || hasPrompt(current, prompt)) return;

    try {
      body.instructions = current ? `${current}${SEP}${prompt}` : prompt;
    } catch (_) {}
  } catch (_) {}
}

export function injectChatSystem(body, prompt) {
  try {
    const messages = body.messages;
    if (!Array.isArray(messages) || containsPromptInMessages(messages, prompt)) return;

    let index = -1;
    try {
      index = messages.findIndex(
        message => message && (message.role === ROLE.SYSTEM || message.role === ROLE.DEVELOPER)
      );
    } catch (_) {
      return;
    }

    if (index >= 0) {
      appendChatMessage(messages[index], prompt);
      return;
    }

    try {
      messages.unshift({ role: ROLE.SYSTEM, content: prompt });
    } catch (_) {}
  } catch (_) {}
}

function containsPromptInMessages(messages, prompt) {
  try {
    for (const message of messages) {
      if (!message || (message.role !== ROLE.SYSTEM && message.role !== ROLE.DEVELOPER)) continue;

      const content = message.content;
      if (typeof content === "string" && hasPrompt(content, prompt)) return true;
      if (
        Array.isArray(content) &&
        content.some(part => part && typeof part.text === "string" && hasPrompt(part.text, prompt))
      ) {
        return true;
      }
    }
  } catch (_) {}

  return false;
}

function appendChatMessage(message, prompt) {
  try {
    if (!message || typeof message !== "object") return;

    const content = message.content;
    if (typeof content === "string") {
      const next = dedupStringAppend(content, prompt);
      if (next !== content) {
        try { message.content = next; } catch (_) {}
      }
      return;
    }

    if (Array.isArray(content)) {
      try {
        if (content.some(block => block && block.text === prompt)) return;
      } catch (_) {}
      try { content.push({ type: OPENAI_BLOCK.TEXT, text: prompt }); } catch (_) {}
      return;
    }

    try { message.content = prompt; } catch (_) {}
  } catch (_) {}
}

export function injectResponsesInputSystem(body, prompt) {
  try {
    const input = body.input;
    if (!Array.isArray(input) || containsPromptInResponsesInput(input, prompt)) return;

    let index = -1;
    try {
      index = input.findIndex(
        item => item && item.type === RESPONSES_ITEM.MESSAGE
          && (item.role === ROLE.SYSTEM || item.role === ROLE.DEVELOPER)
      );
    } catch (_) {
      return;
    }

    if (index >= 0) {
      appendResponsesMessage(input[index], prompt);
      return;
    }

    try {
      input.unshift({
        type: RESPONSES_ITEM.MESSAGE,
        role: ROLE.SYSTEM,
        content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: prompt }],
      });
    } catch (_) {}
  } catch (_) {}
}

function containsPromptInResponsesInput(input, prompt) {
  try {
    for (const item of input) {
      if (
        !item ||
        item.type !== RESPONSES_ITEM.MESSAGE ||
        (item.role !== ROLE.SYSTEM && item.role !== ROLE.DEVELOPER)
      ) continue;

      const content = item.content;
      if (typeof content === "string" && hasPrompt(content, prompt)) return true;
      if (
        Array.isArray(content) &&
        content.some(part => part && typeof part.text === "string" && hasPrompt(part.text, prompt))
      ) {
        return true;
      }
    }
  } catch (_) {}

  return false;
}

function appendResponsesMessage(message, prompt) {
  try {
    if (!message || typeof message !== "object") return;

    const content = message.content;
    if (typeof content === "string") {
      const next = dedupStringAppend(content, prompt);
      if (next !== content) {
        try { message.content = next; } catch (_) {}
      }
      return;
    }

    if (Array.isArray(content)) {
      try {
        if (content.some(block => block && block.text === prompt)) return;
      } catch (_) {}
      try { content.push({ type: RESPONSES_ITEM.INPUT_TEXT, text: prompt }); } catch (_) {}
      return;
    }

    try {
      message.content = [{ type: RESPONSES_ITEM.INPUT_TEXT, text: prompt }];
    } catch (_) {}
  } catch (_) {}
}

export function injectClaudeSystem(body, prompt) {
  try {
    const system = body.system;
    if (typeof system === "string") {
      if (hasPrompt(system, prompt)) return;
      try { body.system = system ? `${system}${SEP}${prompt}` : prompt; } catch (_) {}
      return;
    }

    if (Array.isArray(system)) {
      try {
        if (system.some(block => block && block.text === prompt)) return;
      } catch (_) {}

      const block = { type: CLAUDE_BLOCK.TEXT, text: prompt };
      let lastCacheIndex = -1;
      try {
        for (let index = system.length - 1; index >= 0; index--) {
          if (system[index]?.cache_control) {
            lastCacheIndex = index;
            break;
          }
        }
      } catch (_) {}

      try {
        if (lastCacheIndex >= 0) system.splice(lastCacheIndex, 0, block);
        else system.push(block);
      } catch (_) {}
      return;
    }

    try { body.system = prompt; } catch (_) {}
  } catch (_) {}
}

export function injectGeminiSystem(body, prompt) {
  try {
    let target = body;
    try {
      if (body.request && typeof body.request === "object") target = body.request;
    } catch (_) {}

    let useSnakeCase = false;
    try {
      useSnakeCase = Object.prototype.hasOwnProperty.call(target, "system_instruction");
    } catch (_) {}

    const key = useSnakeCase ? "system_instruction" : "systemInstruction";
    let system;
    try { system = target[key]; } catch (_) {}

    if (system && Array.isArray(system.parts)) {
      try {
        if (system.parts.some(part => part && part.text === prompt)) return;
      } catch (_) {}
      try { system.parts.push({ text: prompt }); } catch (_) {}
      return;
    }

    try { target[key] = { parts: [{ text: prompt }] }; } catch (_) {}
  } catch (_) {}
}

export function injectKiroSystem(body, prompt) {
  try {
    let oldPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt : "";
    const conversationState = body.conversationState;
    let firstUser = conversationState && Array.isArray(conversationState.history)
      ? (conversationState.history.find(item => item && item.userInputMessage)?.userInputMessage ?? null)
      : null;
    if (!firstUser && conversationState?.currentMessage?.userInputMessage) {
      firstUser = conversationState.currentMessage.userInputMessage;
    }

    if (
      firstUser &&
      typeof firstUser.content === "string" &&
      oldPrompt &&
      !hasPrompt(oldPrompt, prompt)
    ) {
      const content = firstUser.content;
      if (content === oldPrompt || (content.startsWith(oldPrompt) && !content.startsWith(`${oldPrompt}${SEP}`))) {
        oldPrompt = "";
      }
    }
    if (oldPrompt && hasPrompt(oldPrompt, prompt)) return;

    const next = oldPrompt ? `${oldPrompt}${SEP}${prompt}` : prompt;
    let target = null;
    try {
      const history = Array.isArray(conversationState?.history) ? conversationState.history : null;
      if (history) {
        for (const item of history) {
          if (item?.userInputMessage) {
            target = item.userInputMessage;
            break;
          }
        }
      }
      if (!target && conversationState?.currentMessage?.userInputMessage) {
        target = conversationState.currentMessage.userInputMessage;
      }
    } catch (_) {}

    let systemPromptWritten = false;
    try {
      body.systemPrompt = next;
      systemPromptWritten = true;
    } catch (_) {}

    try {
      if (target) {
        const content = typeof target.content === "string" ? target.content : "";
        if (oldPrompt === "") {
          if (!content.startsWith(prompt) && !content.startsWith(next)) {
            try { target.content = content ? `${next}${SEP}${content}` : next; } catch (_) {}
          }
        } else if (content.startsWith(oldPrompt) && !content.startsWith(next)) {
          try { target.content = `${next}${content.slice(oldPrompt.length)}`; } catch (_) {}
        }
      }
    } catch (_) {}

    if (systemPromptWritten && target) {
      let converged = false;
      try {
        const content = target.content;
        converged = typeof content !== "string"
          || content.startsWith(next)
          || !content.startsWith(oldPrompt);
      } catch (_) {}
      if (!converged) {
        try { body.systemPrompt = oldPrompt; } catch (_) {}
      }
    }
  } catch (_) {}
}
