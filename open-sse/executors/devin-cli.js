/**
 * DevinCliExecutor — routes completions through the official Devin CLI binary
 * via the Agent Client Protocol (ACP) JSON-RPC 2.0 over stdio.
 *
 * Protocol flow:
 *   1. Spawn `devin acp --agent-type summarizer` (summarizer = no FS tools,
 *      pure text replies, safe for proxy use).
 *   2. Send: initialize → session/new (with model + cwd) → session/prompt.
 *   3. Receive: session/update notifications (streaming text deltas).
 *   4. Emit deltas as OpenAI-compatible SSE chunks.
 *   5. Kill subprocess on [DONE] or error.
 *
 * Auth: only server-side WINDSURF_API_KEY is passed when configured. If unset,
 * devin uses credentials stored by `devin auth login`.
 *
 * Binary discovery: CLI_DEVIN_BIN env → PATH lookup → platform installer paths.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { BaseExecutor } from "./base.js";
import { resolveDevinBin } from "../shared/cliResolver.js";

// ─── ACP JSON-RPC helper ────────────────────────────────────────────────────

function rpc(method, params, id) {
  const msg = { jsonrpc: "2.0", method, params };
  if (id !== undefined) msg.id = id;
  return JSON.stringify(msg) + "\n";
}

// ─── Multi-turn message → single prompt builder ─────────────────────────────

function buildPromptText(messages) {
  // Devin CLI (summarizer mode) receives a single text prompt.
  // Inline the whole conversation so the model has full context.
  const lines = [];
  for (const m of messages) {
    const role = String(m.role || "user");
    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p && typeof p === "object" && p.type === "text") {
          text += String(p.text || "");
        }
      }
    }
    if (!text.trim()) continue;
    if (role === "system") {
      lines.push(`[System]\n${text}`);
    } else if (role === "assistant") {
      lines.push(`[Assistant]\n${text}`);
    } else {
      lines.push(`[User]\n${text}`);
    }
  }
  return lines.join("\n\n") || "(empty)";
}

// ─── DevinCliExecutor ─────────────────────────────────────────────────────────

export class DevinCliExecutor extends BaseExecutor {
  constructor() {
    super("devin-cli", { id: "devin-cli", baseUrl: "devin://acp/stdio" });
  }

  buildUrl() {
    return "devin://acp/stdio";
  }

  buildHeaders() {
    return {};
  }

  transformRequest() {
    return null;
  }

  async execute({ model, body, credentials, signal, log }) {
    const b = body ?? {};
    const messages = Array.isArray(b.messages) ? b.messages : [];
    const promptText = buildPromptText(messages);
    const apiKey = process.env.WINDSURF_API_KEY || "";
    const devinBin = resolveDevinBin();

    log?.info?.("DEVIN", `devin acp → model=${model}, bin=${devinBin}`);

    let cancelStream;
    const sseStream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        let controllerClosed = false;
        const emit = (data) => {
          if (!controllerClosed) controller.enqueue(enc.encode(data));
        };
        const safeEnv = [
          "PATH", "HOME", "USERPROFILE", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR",
          "LANG", "LC_ALL", "XDG_CONFIG_HOME", "DEVIN_API_KEY", "WINDSURF_API_KEY",
        ];
        const env = Object.fromEntries(
          safeEnv.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]])
        );
        if (apiKey) env.WINDSURF_API_KEY = apiKey;
        const tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), "9router-devin-"));
        const timeoutLimit = Math.min(
          Math.max(Number.parseInt(process.env.DEVIN_CLI_TIMEOUT_MS || "120000", 10) || 120000, 1000),
          600000
        );

        const child = spawn(devinBin, ["acp", "--agent-type", "summarizer"], {
          cwd: tempCwd,
          env,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        });

        let spawnError = null;
        let stdinClosed = false;
        let killTimer = null;
        let timeoutTimer = null;

        const redact = (value) => {
          let text = String(value ?? "");
          for (const secret of [apiKey, env.DEVIN_API_KEY, env.WINDSURF_API_KEY]) {
            if (secret) text = text.split(secret).join("[REDACTED]");
          }
          return text;
        };

        // ── JSON-RPC state machine ──────────────────────────────────────────
        let idCounter = 1;
        let sessionId = null;
        let initDone = false;
        let sessionCreated = false;
        let promptSent = false;
        const pending = new Map();
        const responseId = `chatcmpl-devin-${Date.now()}`;
        const created = Math.floor(Date.now() / 1000);
        let roleEmitted = false;
        let totalText = "";
        let finished = false;
        const closeController = () => {
          if (controllerClosed) return;
          controllerClosed = true;
          try { controller.close(); } catch { /* already closed */ }
        };

        const sendRpc = (method, params) => {
          if (stdinClosed || child.stdin.destroyed) return null;
          const id = idCounter++;
          pending.set(id, method);
          try {
            child.stdin.write(rpc(method, params, id));
          } catch {
            pending.delete(id);
          }
          return id;
        };

        const cleanup = () => {
          clearTimeout(timeoutTimer);
          clearTimeout(killTimer);
          pending.clear();
          try { fs.rmSync(tempCwd, { recursive: true, force: true }); } catch { /* best effort */ }
        };

        const terminate = () => {
          if (!child.killed) child.kill("SIGTERM");
          clearTimeout(killTimer);
          killTimer = setTimeout(() => {
            if (!child.killed) child.kill("SIGKILL");
          }, 2000);
          killTimer.unref?.();
        };

        const finish = (error) => {
          if (finished) return;
          finished = true;

          if (error) {
            emit(
              `data: ${JSON.stringify({ error: { message: redact(error), type: "devin_cli_error" } })}\n\n`
            );
          } else {
            // Emit finish chunk
            emit(
              `data: ${JSON.stringify({
                id: responseId,
                object: "chat.completion.chunk",
                created,
                model,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                usage: {
                  prompt_tokens: Math.ceil(promptText.length / 4),
                  completion_tokens: Math.ceil(totalText.length / 4),
                  total_tokens: Math.ceil((promptText.length + totalText.length) / 4),
                  estimated: true,
                },
              })}\n\n`
            );
          }
          emit("data: [DONE]\n\n");

          // Gracefully close stdin → devin will exit
          try {
            if (!stdinClosed) {
              stdinClosed = true;
              child.stdin.end();
            }
          } catch {
            /* ignore */
          }

          terminate();
          cleanup();
          closeController();
        };

        child.on("error", (err) => {
          spawnError = err;
          const notFound = err.code === "ENOENT" || /not found/i.test(err.message);
          finish(notFound
            ? `Devin CLI not found: ${devinBin}. Install via https://cli.devin.ai or set CLI_DEVIN_BIN env var.`
            : `Devin CLI spawn error: ${redact(err.message)}`);
        });

        if (signal) {
          signal.addEventListener("abort", () => finish("Devin CLI request aborted"), { once: true });
        }
        timeoutTimer = setTimeout(() => finish(`Devin CLI timed out after ${timeoutLimit}ms`), timeoutLimit);
        timeoutTimer.unref?.();

        // ── stdout reader (NDJSON) ──────────────────────────────────────────
        let buffer = "";

        child.stdout.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          let nl;
          // Each ACP message is a newline-terminated JSON line
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;

            let msg;
            try {
              msg = JSON.parse(line);
            } catch {
              continue; // ignore non-JSON lines (banner text, etc.)
            }

            // ── Correlated JSON-RPC responses ─────────────────────────────
            if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
              const method = pending.get(msg.id);
              if (!method) {
                finish(`Devin ACP: unknown response id ${String(msg.id)}`);
                return;
              }
              pending.delete(msg.id);
              if (msg.error) {
                finish(`Devin ACP ${method} failed: ${msg.error.message || "protocol error"}`);
                return;
              }
              if (method === "session/prompt") {
                const res = msg.result || {};
                if (!roleEmitted) {
                  const content = extractResultText(res);
                  if (content) {
                    emit(
                      `data: ${JSON.stringify({
                        id: responseId,
                        object: "chat.completion.chunk",
                        created,
                        model,
                        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
                      })}\n\n`
                    );
                    roleEmitted = true;
                    totalText = content;
                    emit(
                      `data: ${JSON.stringify({
                        id: responseId,
                        object: "chat.completion.chunk",
                        created,
                        model,
                        choices: [{ index: 0, delta: { content }, finish_reason: null }],
                      })}\n\n`
                    );
                  }
                }
                const stopReason = res.stopReason || res.stop_reason;
                if (stopReason !== "cancelled" || stopReason === undefined) finish();
              } else if (method === "initialize") {
                initDone = true;
                sendRpc("session/new", { cwd: tempCwd, model: model || undefined });
              } else if (method === "session/new") {
                const res = msg.result || {};
                sessionId = res.sessionId || null;
                if (!sessionId) {
                  finish("Devin ACP: session/new returned no sessionId");
                  return;
                }
                sessionCreated = true;
                promptSent = true;
                sendRpc("session/prompt", {
                  sessionId,
                  content: [{ type: "text", text: promptText }],
                });
              }
              continue;
            }

            // ── Streaming notifications (session/update) ──────────────────
            if (msg.method === "session/update" || msg.method === "$/update") {
              const params = msg.params;
              if (!params) continue;

              const type = params.type;

              if (type === "message_delta" || type === "text_delta" || type === "content_delta") {
                const delta =
                  params.content || params.delta || params.text || "";
                if (delta) {
                  if (!roleEmitted) {
                    emit(
                      `data: ${JSON.stringify({
                        id: responseId,
                        object: "chat.completion.chunk",
                        created,
                        model,
                        choices: [
                          {
                            index: 0,
                            delta: { role: "assistant", content: "" },
                            finish_reason: null,
                          },
                        ],
                      })}\n\n`
                    );
                    roleEmitted = true;
                  }
                  totalText += delta;
                  emit(
                    `data: ${JSON.stringify({
                      id: responseId,
                      object: "chat.completion.chunk",
                      created,
                      model,
                      choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
                    })}\n\n`
                  );
                }
              } else if (type === "message_stop" || type === "stop" || type === "done") {
                // ACP may deliver the terminal notification before a fragmented
                // stdout write has been fully observed by Node.
                setTimeout(() => finish(), 100);
                return;
              } else if (type === "error") {
                finish(String(params.message || params.error || "Devin ACP error"));
                return;
              }
              continue;
            }

            // ── session/prompt final result (non-streaming path) ──────────
            if (promptSent && msg.result !== undefined && !msg.method && !finished) {
              const res = msg.result || undefined;
              // Extract text from result if we haven't streamed anything yet
              if (!roleEmitted && res) {
                const content = extractResultText(res);
                if (content) {
                  emit(
                    `data: ${JSON.stringify({
                      id: responseId,
                      object: "chat.completion.chunk",
                      created,
                      model,
                      choices: [
                        {
                          index: 0,
                          delta: { role: "assistant", content: "" },
                          finish_reason: null,
                        },
                      ],
                    })}\n\n`
                  );
                  totalText = content;
                  emit(
                    `data: ${JSON.stringify({
                      id: responseId,
                      object: "chat.completion.chunk",
                      created,
                      model,
                      choices: [{ index: 0, delta: { content }, finish_reason: null }],
                    })}\n\n`
                  );
                }
              }
              const stopReason = (res && res.stopReason) || "";
              if (stopReason && stopReason !== "cancelled") {
                finish();
              }
            }

            // ── Error responses ───────────────────────────────────────────
            if (msg.error) {
              finish(`Devin ACP error ${msg.error.code}: ${msg.error.message}`);
              return;
            }
          }
        });

        child.stderr.on("data", (chunk) => {
          log?.debug?.("DEVIN", `stderr: ${redact(chunk.toString("utf8")).slice(0, 200)}`);
        });

        child.on("close", (code) => {
          if (!finished) {
            if (code !== 0 && !spawnError) {
              finish(roleEmitted ? undefined : `Devin CLI exited with code ${code}`);
            } else {
              finish();
            }
          }
          cleanup();
        });

        cancelStream = () => finish("Devin CLI request cancelled");

        // ── Send initialize ───────────────────────────────────────────────
        sendRpc("initialize", {
          protocolVersion: "0.3",
          clientInfo: { name: "9router", version: "1.0" },
          capabilities: {},
        });
      },
      cancel() {
        cancelStream?.();
      },
    });

    return {
      response: new Response(sseStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }),
      url: "devin://acp/stdio",
      headers: {},
      transformedBody: { model, promptLength: promptText.length },
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Extract text from a final ACP session/prompt result object across common shapes.
function extractResultText(result) {
  // { message: { content: "..." } }
  // { messages: [{ content: "..." }] }
  // { content: "..." }
  // { text: "..." }
  if (typeof result.content === "string") return result.content;
  if (typeof result.text === "string") return result.text;
  const msg = result.message;
  if (msg && typeof msg.content === "string") return msg.content;
  const msgs = result.messages;
  if (Array.isArray(msgs)) {
    return msgs
      .filter((m) => m.role === "assistant")
      .map((m) => String(m.content || ""))
      .join("\n");
  }
  return "";
}

export { resolveDevinBin };
export default DevinCliExecutor;
