import { getProviderSetting, resolveBaseUrl } from "./requestHelpers.js";

export async function buildXquikRequest(config, params) {
  const apiKey = params.token;
  if (!apiKey) throw new Error("Xquik requires an API key");

  const queryType = getProviderSetting(params, "queryType");
  if (queryType && !["Latest", "Top"].includes(queryType)) {
    throw new Error("Xquik queryType must be Latest or Top");
  }

  const qp = new URLSearchParams({ q: params.query, limit: String(params.maxResults) });
  const cursor = getProviderSetting(params, "cursor");
  if (cursor) qp.set("cursor", cursor);
  if (queryType) qp.set("queryType", queryType);
  if (params.language) qp.set("language", params.language);

  const baseUrl = await resolveBaseUrl(config, params);
  return {
    url: `${baseUrl}?${qp}`,
    init: { method: "GET", headers: { Accept: "application/json", "x-api-key": apiKey } },
  };
}
