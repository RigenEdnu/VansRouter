"use client";

import { useState } from "react";
import useCliToolLifecycle from "./useCliToolLifecycle";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import { rememberEndpoint } from "./cliEndpointPresets";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

function CodexExpandedSection({ activeProviders, apiKeys, applying, checkingCodex, cloudEnabled, codexStatus, customBaseUrl, getDisplayUrl, handleApplySettings, handleResetSettings, message, restoring, selectedApiKey, selectedModel, setCustomBaseUrl, setModalOpen, setSelectedApiKey, setSelectedModel, setShowInstallGuide, setShowManualConfigModal, setSubagentModalOpen, setSubagentModel, showInstallGuide, subagentModel, tailscaleEnabled, tailscaleUrl, tool, tunnelEnabled, tunnelPublicUrl }) {
  return (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checkingCodex && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Codex CLI...</span>
            </div>
          )}

          {!checkingCodex && codexStatus && !codexStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Codex CLI not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if VansAI is deployed on a remote server.</p>
                  </div>
                </div>
                <div>
                  <button
                    onClick={() => setShowInstallGuide(!showInstallGuide)}
                    className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>{showInstallGuide ? "Hide" : "Show"} installation instructions</span>
                    <span className={`material-symbols-outlined text-[14px] transition-transform ${showInstallGuide ? "rotate-180" : ""}`}>expand_more</span>
                  </button>
                </div>
              </div>

              {showInstallGuide && (
                <div className="flex flex-col gap-3 p-4 bg-surface-hover rounded-lg border border-border text-xs">
                  <p className="font-medium text-text-main">To install Codex CLI:</p>
                  <pre className="p-2 bg-sidebar rounded font-mono text-[11px] overflow-x-auto text-text-muted">
                    npm install -g @openai/codex
                  </pre>
                  <p className="text-text-muted">Or follow instructions at: <a href="https://github.com/openai/codex" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">github.com/openai/codex</a></p>
                </div>
              )}

              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </div>
          )}

          {!checkingCodex && codexStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Endpoint (selector) */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect currentUrl={codexStatus?.settings?.baseUrl || ""} value={customBaseUrl || getDisplayUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />
                </div>

                {/* API Key */}
                <ApiKeySelect
                  apiKeys={apiKeys}
                  selectedApiKey={selectedApiKey}
                  onApiKeyChange={setSelectedApiKey}
                  cloudEnabled={cloudEnabled}
                />

                {/* Model */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <input
                    type="text"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    placeholder="provider/model-id"
                    aria-label="Model"
                    className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                  />
                  <button type="button"
                    onClick={() => setModalOpen(true)}
                    disabled={!activeProviders?.length}
                    className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}
                  >
                    Select Model
                  </button>
                </div>

                {/* Subagent Model */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Subagent Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <div className="relative w-full min-w-0">
                    <input
                      type="text"
                      value={subagentModel}
                      onChange={(e) => setSubagentModel(e.target.value)}
                      placeholder={selectedModel || "provider/model-id (defaults to main model)"}
                      aria-label="Subagent model"
                      className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                    />
                    {subagentModel && (
                      <button type="button"
                        onClick={() => setSubagentModel("")}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors"
                        title="Clear (will use main model)"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    )}
                  </div>
                  <button type="button"
                    onClick={() => setSubagentModalOpen(true)}
                    disabled={!activeProviders?.length}
                    className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}
                  >
                    Select Model
                  </button>
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600 dark:text-green-400 dark:bg-green-500/20" : "bg-red-500/10 text-red-600 dark:text-red-400 dark:bg-red-500/20"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={(!selectedApiKey && (cloudEnabled && apiKeys.length > 0)) || !selectedModel} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={restoring} loading={restoring}>
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
  );
}


export default function CodexToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  const {
    status: codexStatus, checking: checkingCodex, applying, restoring, message, dispatch,
    checkStatus, customBaseUrl, getDisplayUrl, getEffectiveBaseUrl,
    handleToggle, modelAliases, selectedApiKey, setCustomBaseUrl, setSelectedApiKey,
  } = useCliToolLifecycle({
    apiKeys, baseUrl, cloudEnabled, initialStatus, isExpanded, onToggle,
    statusEndpoint: "/api/cli-tools/codex-settings",
    getInitialApiKey: (status, keys) => {
      const token = status?.auth?.OPENAI_API_KEY;
      return token && keys?.some((key) => key.key === token) ? token : keys?.[0]?.key || "";
    },
  });
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedModelOverride, setSelectedModel] = useState(null);
  const selectedModel = selectedModelOverride ?? (() => {
    const modelMatch = codexStatus?.config?.match(/^model\s*=\s*"([^"]+)"/m);
    return modelMatch?.[1] || "";
  })();
  const [subagentModelOverride, setSubagentModel] = useState(null);
  const subagentModel = subagentModelOverride ?? (() => {
    const subagentScalar = codexStatus?.config?.match(/^default_subagent_model\s*=\s*"([^"]+)"/m);
    if (subagentScalar) return subagentScalar[1];
    const modelMatch = codexStatus?.config?.match(/\[agents\.subagent\]\s*\n\s*model\s*=\s*"([^"]+)"/m);
    return modelMatch?.[1] || "";
  })();
  const [modalOpen, setModalOpen] = useState(false);
  const [subagentModalOpen, setSubagentModalOpen] = useState(false);
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);

  const getConfigStatus = () => {
    if (!codexStatus?.installed) return null;
    if (!codexStatus.config) return "not_configured";
    const parsed = codexStatus.config.match(/base_url\s*=\s*"([^"]+)"/);
    const currentUrl = parsed ? parsed[1] : "";
    return matchKnownEndpoint(currentUrl, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const handleApplySettings = async () => {
    dispatch({ type: "APPLY_START" });
    try {
      // Use sk_VansRoute for localhost if no key, otherwise use selected key
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_VansRoute" : selectedApiKey);

      const res = await fetch("/api/cli-tools/codex-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          model: selectedModel,
          subagentModel: subagentModel || selectedModel
        }),
      });
      const data = await res.json();
      if (res.ok) {
        rememberEndpoint(getEffectiveBaseUrl(), { tunnelPublicUrl, tailscaleUrl });
        dispatch({ type: "APPLY_DONE", message: { type: "success", text: "Settings applied successfully!" } });
        checkStatus();
      } else {
        dispatch({ type: "APPLY_DONE", message: { type: "error", text: data.error || "Failed to apply settings" } });
      }
    } catch (error) {
      dispatch({ type: "APPLY_DONE", message: { type: "error", text: error.message } });
    }
  };

  const handleResetSettings = async () => {
    dispatch({ type: "RESTORE_START" });
    try {
      const res = await fetch("/api/cli-tools/codex-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "RESTORE_DONE", message: { type: "success", text: "Settings reset successfully!" } });
        setSelectedModel("");
        setSubagentModel("");
        checkStatus();
      } else {
        dispatch({ type: "RESTORE_DONE", message: { type: "error", text: data.error || "Failed to reset settings" } });
      }
    } catch (error) {
      dispatch({ type: "RESTORE_DONE", message: { type: "error", text: error.message } });
    }
  };

  const handleModelSelect = (model) => {
    setSelectedModel(model.value);
    // Auto-set subagent model if not set
    if (!subagentModel) {
      setSubagentModel(model.value);
    }
    setModalOpen(false);
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_VansRoute" : "<API_KEY_FROM_DASHBOARD>");

    const effectiveSubagentModel = subagentModel || selectedModel;

    const configContent = `# VansAI Configuration for Codex CLI
model = "${selectedModel}"
model_provider = "VansRoute"

[model_providers.VansRoute]
name = "VansAI"
base_url = "${getEffectiveBaseUrl()}"
wire_api = "responses"

[model_providers.VansRoute.http_headers]
Authorization = "Bearer ${keyToUse}"

[agents]
default_subagent_model = "${effectiveSubagentModel}"
`;

    return [
      {
        filename: "~/.codex/config.toml",
        content: configContent,
      },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <button type="button" className="flex w-full items-start justify-between gap-3 hover:cursor-pointer sm:items-center text-left" onClick={handleToggle} aria-expanded={isExpanded} aria-label="Toggle section">
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/codex.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">Not configured</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">Other</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </button>

      {isExpanded && <CodexExpandedSection
        activeProviders={activeProviders}
        apiKeys={apiKeys}
        applying={applying}
        checkingCodex={checkingCodex}
        cloudEnabled={cloudEnabled}
        codexStatus={codexStatus}
        customBaseUrl={customBaseUrl}
        getDisplayUrl={getDisplayUrl}
        handleApplySettings={handleApplySettings}
        handleResetSettings={handleResetSettings}
        message={message}
        restoring={restoring}
        selectedApiKey={selectedApiKey}
        selectedModel={selectedModel}
        setCustomBaseUrl={setCustomBaseUrl}
        setModalOpen={setModalOpen}
        setSelectedApiKey={setSelectedApiKey}
        setSelectedModel={setSelectedModel}
        setShowInstallGuide={setShowInstallGuide}
        setShowManualConfigModal={setShowManualConfigModal}
        setSubagentModalOpen={setSubagentModalOpen}
        setSubagentModel={setSubagentModel}
        showInstallGuide={showInstallGuide}
        subagentModel={subagentModel}
        tailscaleEnabled={tailscaleEnabled}
        tailscaleUrl={tailscaleUrl}
        tool={tool}
        tunnelEnabled={tunnelEnabled}
        tunnelPublicUrl={tunnelPublicUrl}
      />}

      <ModelSelectModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSelect={handleModelSelect} selectedModel={selectedModel} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Model for Codex CLI" />

      <ModelSelectModal isOpen={subagentModalOpen} onClose={() => setSubagentModalOpen(false)} onSelect={(model) => { setSubagentModel(model.value); setSubagentModalOpen(false); }} selectedModel={subagentModel} activeProviders={activeProviders} modelAliases={modelAliases} title="Select Subagent Model for Codex CLI" />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Codex CLI - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
