const SEARCH_TYPES = new Set(["instant", "fast", "auto", "deep-lite", "deep", "deep-reasoning"]);
const CATEGORIES = new Set(["company", "people", "publication", "news", "personal site", "financial report"]);
const SECTION_NAMES = new Set(["header", "navigation", "banner", "body", "sidebar", "footer", "metadata"]);

export const EXA_SEARCH_PARAMETER_SCHEMA = {
  query: { type: "string", required: true },
  type: { type: "string", enum: ["instant", "fast", "auto", "deep-lite", "deep", "deep-reasoning"] },
  stream: { type: "boolean" },
  numResults: { type: "integer", min: 1, max: 100 },
  category: { type: "string", enum: ["company", "people", "publication", "news", "personal site", "financial report"], customValues: true },
  userLocation: { type: "string", format: "iso-3166-1-alpha-2" },
  includeDomains: { type: "string[]", maxItems: 1200 },
  excludeDomains: { type: "string[]", maxItems: 1200 },
  startPublishedDate: { type: "string", format: "date-time" },
  endPublishedDate: { type: "string", format: "date-time" },
  startCrawlDate: { type: "string", format: "date-time", deprecated: true },
  endCrawlDate: { type: "string", format: "date-time", deprecated: true },
  moderation: { type: "boolean" },
  additionalQueries: { type: "string[]", minItems: 1, maxItems: 10 },
  systemPrompt: { type: "string" },
  outputSchema: { type: "object", rootTypes: ["text", "object"], maxDepth: 2, maxProperties: 10 },
  compliance: { type: "string", enum: ["hipaa"] },
  context: { type: "boolean|object", deprecated: true },
  contents: {
    type: "object",
    properties: {
      text: { type: "boolean|object" },
      highlights: { type: "boolean|object" },
      summary: { type: "object" },
      context: { type: "boolean|object", deprecated: true },
      livecrawl: { type: "string", enum: ["never", "always", "fallback", "preferred"], deprecated: true },
      livecrawlTimeout: { type: "integer", min: 1, max: 90000 },
      maxAgeHours: { type: "integer", min: -1, max: 720 },
      subpages: { type: "integer", min: 0, max: 100 },
      subpageTarget: { type: "string|string[]", maxItems: 100 },
      extras: { type: "object", counters: ["links", "imageLinks", "richImageLinks", "richLinks", "codeBlocks"] },
    },
  },
};

function invalid(name, message) {
  throw new Error(`Exa ${name}: ${message}`);
}

function optionalString(value, name, max = Infinity) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim()) invalid(name, "must be a non-empty string");
  if (value.length > max) invalid(name, `must be at most ${max} characters`);
  return value;
}

function boundedInteger(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) invalid(name, `must be an integer from ${min} to ${max}`);
  return value;
}

function optionalBoolean(value, name) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") invalid(name, "must be boolean");
  return value;
}

function optionalDate(value, name) {
  const string = optionalString(value, name);
  if (string !== undefined && Number.isNaN(Date.parse(string))) invalid(name, "must be an ISO 8601 date");
  return string;
}

function domainList(value, name) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 1200 || value.some((item) => typeof item !== "string" || !item.trim())) {
    invalid(name, "must be an array of up to 1200 non-empty strings");
  }
  return value;
}

function stringList(value, name, maxItems, maxLength = Infinity) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems || value.some((item) => typeof item !== "string" || !item.trim() || item.length > maxLength)) {
    invalid(name, `must contain 1-${maxItems} non-empty strings`);
  }
  return value;
}

function contentText(value) {
  if (value === undefined || value === null || typeof value === "boolean") return value;
  if (!value || typeof value !== "object") invalid("contents.text", "must be boolean or object");
  if (value.maxCharacters !== undefined) boundedInteger(value.maxCharacters, "contents.text.maxCharacters", 1, 10000);
  optionalBoolean(value.includeHtmlTags, "contents.text.includeHtmlTags");
  if (value.verbosity !== undefined && !["compact", "standard", "full"].includes(value.verbosity)) invalid("contents.text.verbosity", "is invalid");
  for (const key of ["includeSections", "excludeSections"]) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key].some((section) => !SECTION_NAMES.has(section)))) invalid(`contents.text.${key}`, "contains an invalid section");
  }
  return value;
}

function contentHighlights(value) {
  if (value === undefined || value === null || typeof value === "boolean") return value;
  if (!value || typeof value !== "object") invalid("contents.highlights", "must be boolean or object");
  optionalString(value.query, "contents.highlights.query");
  if (value.maxCharacters !== undefined) boundedInteger(value.maxCharacters, "contents.highlights.maxCharacters", 1, 10000);
  if (value.numSentences !== undefined) boundedInteger(value.numSentences, "contents.highlights.numSentences", 1, 10000);
  if (value.highlightsPerUrl !== undefined) boundedInteger(value.highlightsPerUrl, "contents.highlights.highlightsPerUrl", 1, 10000);
  return value;
}

function contentSummary(value) {
  if (value === undefined || value === null) return value;
  if (!value || typeof value !== "object") invalid("contents.summary", "must be an object");
  optionalString(value.query, "contents.summary.query");
  if (value.schema !== undefined) validateOutputSchema(value.schema, "contents.summary.schema");
  return value;
}

function validateOutputSchema(schema, name = "outputSchema") {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) invalid(name, "must be an object");
  if (!["text", "object"].includes(schema.type)) invalid(name, "type must be text or object");
  let propertyCount = 0;
  const visit = (value, depth) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (depth > 2) invalid(name, "nesting depth must be at most 2");
    if (value.properties && typeof value.properties === "object" && !Array.isArray(value.properties)) {
      propertyCount += Object.keys(value.properties).length;
      if (propertyCount > 10) invalid(name, "supports at most 10 properties");
      for (const child of Object.values(value.properties)) visit(child, depth + 1);
    }
    if (value.items) visit(value.items, depth + 1);
    if (value.required !== undefined && (!Array.isArray(value.required) || value.required.some((key) => typeof key !== "string"))) {
      invalid(name, "required must be an array of strings");
    }
  };
  visit(schema, 0);
  return schema;
}

function contentContext(value, name = "contents.context") {
  if (value === undefined || value === null || typeof value === "boolean") return value;
  if (!value || typeof value !== "object") invalid(name, "must be boolean or object");
  if (value.maxCharacters !== undefined) boundedInteger(value.maxCharacters, `${name}.maxCharacters`, 1, 10000);
  return value;
}

function buildContents(options) {
  const contents = {};
  for (const key of ["text", "highlights", "summary", "context", "livecrawl", "livecrawlTimeout", "maxAgeHours", "subpages", "subpageTarget", "extras"]) {
    if (options[key] !== undefined) contents[key] = options[key];
  }
  if (contents.text !== undefined) contents.text = contentText(contents.text);
  if (contents.highlights !== undefined) contents.highlights = contentHighlights(contents.highlights);
  if (contents.summary !== undefined) contents.summary = contentSummary(contents.summary);
  if (contents.context !== undefined) contents.context = contentContext(contents.context);
  if (contents.livecrawl !== undefined && !["never", "always", "fallback", "preferred"].includes(contents.livecrawl)) invalid("contents.livecrawl", "is invalid");
  if (contents.livecrawlTimeout !== undefined) boundedInteger(contents.livecrawlTimeout, "contents.livecrawlTimeout", 1, 90000);
  if (contents.maxAgeHours !== undefined) boundedInteger(contents.maxAgeHours, "contents.maxAgeHours", -1, 720);
  if (contents.subpages !== undefined) boundedInteger(contents.subpages, "contents.subpages", 0, 100);
  if (contents.subpageTarget !== undefined) {
    if (typeof contents.subpageTarget === "string") optionalString(contents.subpageTarget, "contents.subpageTarget", 100);
    else stringList(contents.subpageTarget, "contents.subpageTarget", 100, 100);
  }
  if (contents.livecrawl !== undefined && contents.maxAgeHours !== undefined) invalid("contents", "livecrawl and maxAgeHours cannot be combined");
  if (contents.extras !== undefined) {
    if (!contents.extras || typeof contents.extras !== "object") invalid("contents.extras", "must be an object");
    contents.extras = { ...contents.extras };
    for (const key of ["links", "imageLinks", "richImageLinks", "richLinks", "codeBlocks"]) {
      if (contents.extras[key] !== undefined) boundedInteger(contents.extras[key], `contents.extras.${key}`, 0, 1000);
    }
  }
  return Object.keys(contents).length ? contents : undefined;
}

export function buildExaBody(params) {
  const options = params.exaOptions || params.providerOptions?.exa || {};
  const parsedDomains = parseDomains(params.domainFilter);
  const explicitType = options.type;
  const requestedType = explicitType ?? (params.searchType === "web" || params.searchType === "news" ? "auto" : params.searchType);
  const body = {
    query: params.query,
    type: requestedType || "auto",
    numResults: options.numResults ?? params.maxResults,
  };
  if (explicitType !== undefined && !SEARCH_TYPES.has(explicitType)) invalid("type", "is invalid");
  if (!SEARCH_TYPES.has(body.type)) invalid("type", "is invalid");
  boundedInteger(body.numResults, "numResults", 1, 100);
  if (options.category !== undefined) {
    const category = optionalString(options.category, "category");
    if (!CATEGORIES.has(category) && category.length > 100) invalid("category", "is too long");
    body.category = category;
  } else if (params.searchType === "news") {
    body.category = "news";
  }
  if (options.userLocation !== undefined) {
    const location = optionalString(options.userLocation, "userLocation");
    if (!/^[A-Za-z]{2}$/.test(location)) invalid("userLocation", "must be a two-letter ISO country code");
    body.userLocation = location.toUpperCase();
  }
  for (const key of ["includeDomains", "excludeDomains"]) {
    const list = domainList(options[key] ?? (key === "includeDomains" ? parsedDomains.includes : parsedDomains.excludes), key);
    if (list?.length) body[key] = list;
  }
  for (const key of ["startPublishedDate", "endPublishedDate"]) {
    const date = optionalDate(options[key], key);
    if (date) body[key] = date;
  }
  for (const key of ["startCrawlDate", "endCrawlDate"]) {
    const date = optionalDate(options[key], key);
    if (date) body[key] = date;
  }
  if (options.context !== undefined) body.context = contentContext(options.context, "context");
  const moderation = optionalBoolean(options.moderation, "moderation");
  if (moderation !== undefined) body.moderation = moderation;
  const additionalQueries = stringList(options.additionalQueries, "additionalQueries", 10);
  if (additionalQueries) {
    if (!body.type.startsWith("deep")) invalid("additionalQueries", "requires a deep search type");
    body.additionalQueries = additionalQueries;
  }
  for (const key of ["systemPrompt", "compliance"]) {
    const value = optionalString(options[key], key);
    if (value) body[key] = value;
  }
  if (body.compliance && body.compliance !== "hipaa") invalid("compliance", "must be hipaa");
  if (options.outputSchema !== undefined) {
    body.outputSchema = validateOutputSchema(options.outputSchema);
  }
  const stream = optionalBoolean(options.stream, "stream");
  if (stream !== undefined) body.stream = stream;
  if (stream === true && !body.outputSchema) invalid("stream", "requires outputSchema");
  const contentsOptions = { highlights: true, ...(options.contents || {}) };
  for (const key of ["text", "highlights", "summary", "context", "livecrawl", "livecrawlTimeout", "maxAgeHours", "subpages", "subpageTarget", "extras"]) {
    if (options[`contents.${key}`] !== undefined) contentsOptions[key] = options[`contents.${key}`];
  }
  const contents = buildContents(contentsOptions);
  if (contents) body.contents = contents;
  if ((body.category === "company" || body.category === "people") && (body.excludeDomains || body.startPublishedDate || body.endPublishedDate)) invalid("category", "does not support excludeDomains or publication dates");
  if (body.compliance === "hipaa" && (
    !["instant", "fast"].includes(body.type)
    || body.contents?.maxAgeHours !== -1
    || body.contents?.summary !== undefined
    || body.contents?.livecrawl !== undefined
  )) invalid("compliance", "hipaa requires instant/fast, cache-only content, and no summary/livecrawl");
  return body;
}

function parseDomains(domainFilter) {
  const includes = [];
  const excludes = [];
  for (const value of domainList(domainFilter, "domainFilter") || []) (value.startsWith("-") ? excludes : includes).push(value.startsWith("-") ? value.slice(1) : value);
  return { includes, excludes };
}
