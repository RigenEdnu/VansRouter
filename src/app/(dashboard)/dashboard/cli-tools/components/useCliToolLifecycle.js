import { useCallback, useEffect, useReducer, useRef, useState } from "react";

const appendV1 = (url) => url?.endsWith("/v1") ? url : `${url}/v1`;

export function toolCardReducer(state, action) {
  switch (action.type) {
    case "CHECK_START": return { ...state, checking: true };
    case "CHECK_DONE": return { ...state, status: action.data, checking: false };
    case "APPLY_START": return { ...state, applying: true, message: null };
    case "APPLY_DONE": return { ...state, applying: false, message: action.message };
    case "RESTORE_START": return { ...state, restoring: true, message: null };
    case "RESTORE_DONE": return { ...state, restoring: false, message: action.message };
    default: return state;
  }
}

export function useCliToolLifecycle({ apiKeys, baseUrl, cloudEnabled, initialStatus, isExpanded, onToggle, statusEndpoint, getDefaultBaseUrl = appendV1, getInitialApiKey }) {
  const [state, dispatch] = useReducer(toolCardReducer, {
    status: initialStatus || null,
    checking: false,
    applying: false,
    restoring: false,
    message: null,
  });
  const [selectedApiKeyOverride, setSelectedApiKey] = useState(null);
  const [modelAliases, setModelAliases] = useState({});
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const statusFetchedRef = useRef(!!initialStatus);
  const aliasesFetchedRef = useRef(false);

  const fetchModelAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  }, []);

  const checkStatus = useCallback(async () => {
    dispatch({ type: "CHECK_START" });
    try {
      const res = await fetch(statusEndpoint);
      const data = await res.json();
      dispatch({ type: "CHECK_DONE", data });
    } catch (error) {
      dispatch({ type: "CHECK_DONE", data: { installed: false, error: error.message } });
    }
  }, [statusEndpoint]);

  const initializeCard = useCallback(async () => {
    if (!statusFetchedRef.current) {
      statusFetchedRef.current = true;
      await checkStatus();
    }
    if (!aliasesFetchedRef.current) {
      aliasesFetchedRef.current = true;
      await fetchModelAliases();
    }
  }, [checkStatus, fetchModelAliases]);

  const handleToggle = useCallback(() => {
    if (!isExpanded) initializeCard();
    onToggle();
  }, [isExpanded, initializeCard, onToggle]);

  useEffect(() => {
    if (isExpanded) initializeCard();
  }, [isExpanded, initializeCard]);

  const selectedApiKey = selectedApiKeyOverride ?? (getInitialApiKey ? getInitialApiKey(state.status, apiKeys) : (apiKeys?.length > 0 ? apiKeys[0].key : ""));
  const getEffectiveBaseUrl = useCallback(() => {
    const url = customBaseUrl || getDefaultBaseUrl(baseUrl);
    return url.endsWith("/v1") ? url : `${url}/v1`;
  }, [baseUrl, customBaseUrl, getDefaultBaseUrl]);
  const getDisplayUrl = useCallback(() => customBaseUrl || getDefaultBaseUrl(baseUrl), [baseUrl, customBaseUrl, getDefaultBaseUrl]);

  return {
    ...state,
    dispatch,
    checkStatus,
    customBaseUrl,
    fetchModelAliases,
    getDisplayUrl,
    getEffectiveBaseUrl,
    handleToggle,
    initializeCard,
    modelAliases,
    selectedApiKey,
    setCustomBaseUrl,
    setSelectedApiKey,
  };
}

export default useCliToolLifecycle;
