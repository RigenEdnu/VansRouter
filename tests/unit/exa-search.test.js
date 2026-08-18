import { describe, expect, it } from "vitest";
import { buildExaBody } from "../../open-sse/handlers/search/exa.js";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";

describe("Exa Search API contract", () => {
  it("uses Bearer authentication required by the coding-agent API guide", async () => {
    const request = await buildSearchRequest({ id: "exa", baseUrl: "https://api.exa.ai/search" }, {
      query: "test",
      maxResults: 1,
      searchType: "instant",
      token: "exa-secret",
    });
    expect(request.init.headers.Authorization).toBe("Bearer exa-secret");
    expect(request.init.headers["x-api-key"]).toBeUndefined();
    expect(JSON.parse(request.init.body).contents).toEqual({ highlights: true });
  });

  it("maps the complete request shape into Exa camelCase JSON", () => {
    const body = buildExaBody({
      query: "AI releases",
      maxResults: 10,
      exaOptions: {
        type: "deep",
        category: "publication",
        userLocation: "us",
        includeDomains: ["exa.ai/docs"],
        startPublishedDate: "2026-01-01T00:00:00Z",
        endPublishedDate: "2026-08-01T00:00:00Z",
        moderation: true,
        additionalQueries: ["AI model releases"],
        systemPrompt: "Prefer primary sources",
        outputSchema: { type: "text", description: "summary" },
        stream: true,
        startCrawlDate: "2026-01-01T00:00:00Z",
        endCrawlDate: "2026-08-01T00:00:00Z",
        context: { maxCharacters: 2000 },
        contents: {
          text: { maxCharacters: 1000, verbosity: "compact" },
          highlights: { query: "release", maxCharacters: 500 },
          summary: { query: "main result" },
          maxAgeHours: 0,
          subpages: 2,
          subpageTarget: ["docs", "reference"],
          extras: { links: 2, imageLinks: 1, codeBlocks: 1 },
        },
      },
    });

    expect(body).toEqual(expect.objectContaining({
      query: "AI releases",
      type: "deep",
      numResults: 10,
      category: "publication",
      userLocation: "US",
      includeDomains: ["exa.ai/docs"],
      startPublishedDate: "2026-01-01T00:00:00Z",
      endPublishedDate: "2026-08-01T00:00:00Z",
      startCrawlDate: "2026-01-01T00:00:00Z",
      endCrawlDate: "2026-08-01T00:00:00Z",
      context: { maxCharacters: 2000 },
      moderation: true,
      additionalQueries: ["AI model releases"],
      stream: true,
    }));
    expect(body.contents).toEqual(expect.objectContaining({
      text: { maxCharacters: 1000, verbosity: "compact" },
      highlights: { query: "release", maxCharacters: 500 },
      summary: { query: "main result" },
      maxAgeHours: 0,
      subpages: 2,
      subpageTarget: ["docs", "reference"],
      extras: { links: 2, imageLinks: 1, codeBlocks: 1 },
    }));
  });

  it.each([
    ["numResults", { numResults: 101 }],
    ["type", { type: "invalid" }],
    ["additionalQueries", { type: "auto", additionalQueries: ["alternate"] }],
    ["userLocation", { userLocation: "USA" }],
    ["maxAgeHours", { contents: { maxAgeHours: 721 } }],
  ])("rejects invalid %s", (_name, options) => {
    expect(() => buildExaBody({ query: "test", maxResults: 5, exaOptions: options })).toThrow(/Exa/);
  });

  it("preserves Exa result fields and root metadata", () => {
    const normalized = normalizeSearchResponse("exa", {
      requestId: "req-1",
      resolvedSearchType: "fast",
      costDollars: { total: 0.007 },
      output: { content: "answer", grounding: [] },
      results: [{
        id: "https://exa.ai",
        title: "Exa",
        url: "https://exa.ai",
        publishedDate: "2026-01-01",
        author: "Author",
        image: "https://exa.ai/image.png",
        favicon: "https://exa.ai/favicon.ico",
        text: "full text",
        highlights: ["highlight"],
        highlightScores: [0.9],
        summary: "summary",
        subpages: [{ url: "https://exa.ai/docs" }],
        extras: { links: ["https://exa.ai/docs"] },
      }],
    }, "Exa", "fast");

    expect(normalized.metadata).toEqual({
      requestId: "req-1",
      resolvedSearchType: "fast",
      costDollars: { total: 0.007 },
      output: { content: "answer", grounding: [] },
    });
    expect(normalized.results[0].provider_raw).toEqual(expect.objectContaining({
      id: "https://exa.ai",
      publishedDate: "2026-01-01",
      highlightScores: [0.9],
    }));
    expect(normalized.results[0].provider_raw).toHaveProperty("subpages");
    expect(normalized.results[0].provider_raw).not.toHaveProperty("text");
  });
});
