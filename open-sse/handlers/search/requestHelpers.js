import { assertPublicUrl } from "../../../src/shared/utils/ssrfGuard.js";

export function getProviderSetting(params, key) {
  const fromOptions = params.providerOptions?.[key];
  if (typeof fromOptions === "string" && fromOptions.trim().length > 0) return fromOptions.trim();
  const fromProviderData = params.providerSpecificData?.[key];
  if (typeof fromProviderData === "string" && fromProviderData.trim().length > 0) return fromProviderData.trim();
  return undefined;
}

export async function resolveBaseUrl(config, params) {
  const override = getProviderSetting(params, "baseUrl");
  if (override) {
    let parsed;
    try { parsed = new URL(override); } catch { throw new Error(`Invalid baseUrl: ${override}`); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`Invalid baseUrl protocol: ${parsed.protocol}`);
    await assertPublicUrl(override);
  }
  return (override || config.baseUrl).replace(/\/+$/, "");
}
