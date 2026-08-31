import { commandCodeToOpenAIResponse } from "../translator/response/commandcode-to-openai.js";
import { SSE_DONE } from "../utils/sseConstants.js";

export function parseCommandCodeError(event) {
  if (!event || typeof event !== "object") {
    return { statusCode: 503, message: "CommandCode upstream error", type: "server_error" };
  }

  const errVal = event.error ?? event.message ?? "unknown";
  let message = "";
  let statusCode = null;
  let type = "server_error";

  if (typeof errVal === "object" && errVal !== null) {
    message = errVal.message || errVal.error || JSON.stringify(errVal);
    if (errVal.statusCode && Number.isInteger(Number(errVal.statusCode))) {
      statusCode = Number(errVal.statusCode);
    } else if (errVal.status && Number.isInteger(Number(errVal.status))) {
      statusCode = Number(errVal.status);
    }
    if (errVal.type) type = errVal.type;
  } else if (typeof errVal === "string") {
    message = errVal;
  } else {
    message = JSON.stringify(errVal);
  }

  if (event.statusCode && Number.isInteger(Number(event.statusCode))) statusCode = Number(event.statusCode);

  if (!statusCode || statusCode < 400 || statusCode > 599) {
    const lower = message.toLowerCase();
    if (lower.includes("rate limit") || lower.includes("too many requests")) {
      statusCode = 429; type = "rate_limit_error";
    } else if (lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("authentication")) {
      statusCode = 401; type = "authentication_error";
    } else if (lower.includes("payment required") || lower.includes("billing")) {
      statusCode = 402; type = "billing_error";
    } else if (lower.includes("quota") || lower.includes("forbidden") || lower.includes("permission")) {
      statusCode = 403; type = "permission_error";
    } else if (lower.includes("not found")) {
      statusCode = 404; type = "invalid_request_error";
    } else if (lower.includes("unavailable") || lower.includes("overloaded") || lower.includes("server error")) {
      statusCode = 503; type = "server_error";
    } else statusCode = 503;
  }

  return { statusCode, message, type };
}

export async function inspectAndWrapCommandCodeResponse(originalResponse, model) {
  const reader = originalResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const bufferedLines = [];
  let detectedError = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        const trimmed = buffer.trim();
        if (trimmed) {
          try {
            const jsonStr = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
            const parsed = JSON.parse(jsonStr);
            if (parsed?.type === "error") detectedError = parsed;
            else bufferedLines.push(trimmed);
          } catch { bufferedLines.push(trimmed); }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      let stopLoop = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const jsonStr = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
        if (!jsonStr || jsonStr === "[DONE]") { bufferedLines.push(trimmed); stopLoop = true; break; }
        let event;
        try { event = JSON.parse(jsonStr); } catch { bufferedLines.push(trimmed); continue; }
        if (event?.type === "error") { detectedError = event; stopLoop = true; break; }
        bufferedLines.push(trimmed);
        if (["text-delta", "reasoning-delta", "tool-input-start", "tool-call", "finish", "finish-step"].includes(event?.type)) {
          stopLoop = true; break;
        }
      }
      if (stopLoop) break;
    }
  } catch {
    try { reader.releaseLock(); } catch { /* ignore */ }
    return originalResponse;
  }

  if (detectedError) {
    try { await reader.cancel(); } catch { /* ignore */ }
    const { statusCode, message, type } = parseCommandCodeError(detectedError);
    return new Response(JSON.stringify({ error: { message: `[CommandCode error: ${message}]`, type, code: statusCode } }), {
      status: statusCode,
      statusText: statusCode === 503 ? "Service Unavailable" : (statusCode === 429 ? "Too Many Requests" : "Bad Gateway"),
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  return wrapNdjsonAsOpenAISse(createReplayedStream(bufferedLines, buffer, reader), model, originalResponse);
}

function createReplayedStream(bufferedLines, remainingBuffer, reader) {
  const encoder = new TextEncoder();
  let replayed = false;
  return new ReadableStream({
    async pull(controller) {
      if (!replayed) {
        replayed = true;
        let prefix = bufferedLines.join("\n");
        if (prefix && remainingBuffer) prefix += "\n" + remainingBuffer;
        else if (remainingBuffer) prefix = remainingBuffer;
        else if (prefix) prefix += "\n";
        if (prefix) controller.enqueue(encoder.encode(prefix));
      }
      try {
        const { value, done } = await reader.read();
        if (done) controller.close(); else controller.enqueue(value);
      } catch (err) { controller.error(err); }
    },
    async cancel(reason) { try { await reader.cancel(reason); } catch { /* ignore */ } },
  });
}

function wrapNdjsonAsOpenAISse(streamBody, model, originalResponse = null) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const state = { model };
  const emitChunks = (chunks, controller) => {
    if (!chunks) return;
    for (const c of (Array.isArray(chunks) ? chunks : [chunks])) {
      if (c != null) controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
    }
  };
  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) { const trimmed = line.trim(); if (trimmed) emitChunks(commandCodeToOpenAIResponse(trimmed, state), controller); }
    },
    flush(controller) {
      const trimmed = buffer.trim();
      if (trimmed) emitChunks(commandCodeToOpenAIResponse(trimmed, state), controller);
      controller.enqueue(encoder.encode(SSE_DONE));
    },
  });
  return new Response(streamBody.pipeThrough(transform), {
    status: originalResponse?.status || 200,
    statusText: originalResponse?.statusText || "OK",
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", ...(originalResponse?.headers ? Object.fromEntries(originalResponse.headers.entries()) : {}), "content-type": "text/event-stream" },
  });
}
