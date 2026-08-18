"use client";

import { useState, useEffect } from "react";
import { Card, Button } from "@/shared/components";
import { MEDIA_PROVIDER_KINDS, getProviderAlias } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { Row } from "./exampleShared";

const EXA_PRESETS = [
  {
    id: "coding",
    name: "Coding Agent (Fast & Highlights)",
    description: "Ideal for coding assistants searching for docs, errors, or APIs with highlights and code blocks.",
    config: {
      query: "Next.js 16 App Router server actions streaming",
      type: "fast",
      numResults: 5,
      includeDomains: ["nextjs.org", "github.com"],
      contents: {
        text: { maxCharacters: 1000, verbosity: "compact" },
        highlights: { query: "server actions streaming", numSentences: 2, highlightsPerUrl: 3 },
        extras: { links: 2, codeBlocks: 3 }
      }
    }
  },
  {
    id: "deep-research",
    name: "Deep Research with Summary",
    description: "Deep crawl across multiple queries with AI summaries and custom structured output schema.",
    config: {
      query: "Latest breakthroughs in AI reasoning models 2026",
      type: "deep",
      numResults: 5,
      additionalQueries: [
        "frontier AI reasoning architectures 2026",
        "test-time compute scaling laws"
      ],
      systemPrompt: "Synthesize findings focusing on test-time compute and verifiable domains.",
      contents: {
        text: true,
        summary: { query: "Key technical innovations and scaling results" },
        subpages: 2
      }
    }
  },
  {
    id: "livecrawl",
    name: "Live Web & Real-Time",
    description: "Bypasses cache to crawl real-time web contents with fallback timeout.",
    config: {
      query: "OpenAI latest announcement today",
      type: "instant",
      numResults: 3,
      contents: {
        text: { includeHtmlTags: false },
        livecrawl: "always",
        livecrawlTimeout: 5000,
        extras: { links: 5 }
      }
    }
  },
  {
    id: "hipaa",
    name: "HIPAA Compliant",
    description: "Strict HIPAA compliance mode with cache-only content.",
    config: {
      query: "Medical diagnostic AI benchmark protocols",
      type: "instant",
      numResults: 3,
      compliance: "hipaa",
      contents: {
        text: true,
        maxAgeHours: -1
      }
    }
  }
];

export function ExaSearchExampleCard({ providerId }) {
  const providerAlias = getProviderAlias(providerId);
  const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === "webSearch");

  const [activePreset, setActivePreset] = useState("coding");
  const [requestJson, setRequestJson] = useState(() =>
    JSON.stringify(
      {
        provider: providerAlias,
        ...EXA_PRESETS[0].config
      },
      null,
      2
    )
  );

  const [apiKey, setApiKey] = useState("");
  const [useTunnel, setUseTunnel] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState("");
  const [tunnelEndpoint, setTunnelEndpoint] = useState("");
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [connections, setConnections] = useState([]);
  const [pinnedConnectionId, setPinnedConnectionId] = useState("");
  const { copied: copiedCurl, copy: copyCurl } = useCopyToClipboard();
  const { copied: copiedRes, copy: copyRes } = useCopyToClipboard();

  useEffect(() => {
    setLocalEndpoint(window.location.origin);
    fetch("/api/keys")
      .then((r) => r.json())
      .then((d) => {
        setApiKey((d.keys || []).find((k) => k.isActive !== false)?.key || "");
      })
      .catch(() => {});
    fetch("/api/tunnel/status")
      .then((r) => r.json())
      .then((d) => {
        if (d.publicUrl) setTunnelEndpoint(d.publicUrl);
      })
      .catch(() => {});
    fetch("/api/providers/client")
      .then((r) => r.json())
      .then((d) => {
        const conns = (d.connections || []).filter(
          (c) => c.provider === providerId && c.isActive !== false
        );
        setConnections(conns);
      })
      .catch(() => {});
  }, [providerId]);

  const endpoint = useTunnel ? tunnelEndpoint : localEndpoint;
  const apiPath = kindConfig?.endpoint?.path || "/v1/search";

  const handleSelectPreset = (presetId) => {
    setActivePreset(presetId);
    const preset = EXA_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      setRequestJson(
        JSON.stringify(
          {
            provider: providerAlias,
            ...preset.config
          },
          null,
          2
        )
      );
    }
  };

  let parsedBody = {};
  let jsonError = null;
  try {
    parsedBody = JSON.parse(requestJson);
  } catch (err) {
    jsonError = err.message;
  }

  const headersPreview = `-H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${apiKey || "YOUR_KEY"}"${
    pinnedConnectionId ? ` \\\n  -H "x-connection-id: ${pinnedConnectionId}"` : ""
  }`;

  const curlSnippet = `curl -X POST ${endpoint}${apiPath} \\
  ${headersPreview.replace(/\\\n  /g, "\\\n  ")} \\
  -d '${requestJson.replace(/'/g, "'\\''")}'`;

  const handleRun = async () => {
    if (jsonError) {
      setError(`Invalid JSON payload: ${jsonError}`);
      return;
    }
    setRunning(true);
    setError("");
    setResult(null);
    const start = Date.now();
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      if (pinnedConnectionId) headers["x-connection-id"] = pinnedConnectionId;

      const bodyToSend = {
        provider: providerAlias,
        ...parsedBody
      };

      const res = await fetch(`/api${apiPath}`, {
        method: "POST",
        headers,
        body: JSON.stringify(bodyToSend)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message || data?.error || `HTTP ${res.status}`);
        return;
      }

      const ctype = res.headers.get("content-type") || "";
      if (ctype.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
        }
        setResult({ data: { stream_text: buf }, latencyMs: Date.now() - start });
      } else {
        const data = await res.json();
        setResult({ data, latencyMs: Date.now() - start });
      }
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setRunning(false);
    }
  };

  const resultJson = result ? JSON.stringify(result.data, null, 2) : "";

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-lg font-semibold">Exa Search 1:1 Request Playground</h2>
          <p className="text-xs text-text-muted">
            Test all official Exa Search API parameters including deep search, highlights, livecrawl, and HIPAA compliance.
          </p>
        </div>
        <a
          href="https://exa.ai/docs/reference/search-api-guide-for-coding-agents"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-sm">open_in_new</span>
          Exa Docs
        </a>
      </div>

      <div className="flex flex-col gap-3">
        {/* Preset Tabs */}
        <Row label="Presets">
          <div className="flex flex-wrap gap-1.5">
            {EXA_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectPreset(preset.id)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                  activePreset === preset.id
                    ? "bg-primary text-white"
                    : "bg-sidebar hover:bg-border text-text-muted hover:text-text-main border border-border"
                }`}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </Row>

        {/* Endpoint */}
        <Row label="Endpoint">
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <span className="w-full min-w-0 flex-1 px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate">
              {endpoint}{apiPath}
            </span>
            {tunnelEndpoint && (
              <button
                onClick={() => setUseTunnel((v) => !v)}
                title={useTunnel ? "Using tunnel" : "Using local"}
                className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border shrink-0 transition-colors ${
                  useTunnel
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-text-muted hover:text-primary"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">wifi_tethering</span>
                Tunnel
              </button>
            )}
          </div>
        </Row>

        {/* API Key */}
        <Row label="API Key">
          <span className="px-3 py-1.5 text-sm font-mono text-text-main bg-sidebar rounded-lg truncate block">
            {apiKey ? (
              `${apiKey.slice(0, 8)}${"\u2022".repeat(Math.min(20, apiKey.length - 8))}`
            ) : (
              <span className="text-text-muted italic">No key configured</span>
            )}
          </span>
        </Row>

        {/* Connection picker */}
        {connections.length > 0 && (
          <Row label="Connection">
            <select
              value={pinnedConnectionId}
              onChange={(e) => setPinnedConnectionId(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            >
              <option value="">Auto (Round-robin / Failover)</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </Row>
        )}

        {/* Editable JSON Payload */}
        <Row label="Payload">
          <div className="flex flex-col gap-1 w-full">
            <textarea
              value={requestJson}
              onChange={(e) => setRequestJson(e.target.value)}
              rows={12}
              className={`w-full p-2.5 text-xs font-mono border rounded-lg bg-sidebar focus:outline-none focus:border-primary ${
                jsonError ? "border-red-500" : "border-border"
              }`}
            />
            {jsonError && (
              <span className="text-[11px] text-red-500 font-mono">Invalid JSON: {jsonError}</span>
            )}
          </div>
        </Row>

        {/* Action Button */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            size="sm"
            onClick={handleRun}
            disabled={running || !!jsonError}
            icon={running ? "sync" : "play_arrow"}
          >
            {running ? "Searching Exa..." : "Send Request"}
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 text-xs bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 rounded-lg">
            {error}
          </div>
        )}

        {/* cURL preview */}
        <div className="relative mt-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-text-muted">cURL Request</span>
            <button
              onClick={() => copyCurl(curlSnippet)}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">
                {copiedCurl ? "check" : "content_copy"}
              </span>
              {copiedCurl ? "Copied" : "Copy cURL"}
            </button>
          </div>
          <pre className="p-3 text-xs font-mono bg-sidebar border border-border rounded-lg overflow-x-auto text-text-main max-h-48">
            {curlSnippet}
          </pre>
        </div>

        {/* Response preview */}
        {result && (
          <div className="relative mt-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-text-muted">
                Response ({result.latencyMs}ms)
              </span>
              <button
                onClick={() => copyRes(resultJson)}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">
                  {copiedRes ? "check" : "content_copy"}
                </span>
                {copiedRes ? "Copied" : "Copy JSON"}
              </button>
            </div>
            <pre className="p-3 text-xs font-mono bg-sidebar border border-border rounded-lg overflow-x-auto text-text-main max-h-96">
              {resultJson}
            </pre>
          </div>
        )}
      </div>
    </Card>
  );
}
