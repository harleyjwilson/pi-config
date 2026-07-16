import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

type BraveSource = "web" | "news" | "images";

type SearchResult = {
  title: string;
  url: string;
  description?: string;
  age?: string;
  source?: string;
  thumbnail?: string;
  markdown?: string;
};

const AUTH_SERVICE = "brave-search";

function authPath() {
  return join(homedir(), ".pi", "agent", "auth.json");
}

function readAuthFile(): Record<string, any> {
  const path = authPath();
  if (!existsSync(path)) return {};

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    throw new Error(`Could not parse ${path}: ${asErrorMessage(error)}`);
  }
}

function writeAuthFile(auth: Record<string, any>) {
  const path = authPath();
  // ~/.pi/agent already exists for normal pi installations, but keep this robust.
  if (!existsSync(dirname(path))) throw new Error(`Missing auth directory: ${dirname(path)}`);
  writeFileSync(path, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function getStoredBraveApiKey() {
  const entry = readAuthFile()[AUTH_SERVICE];
  if (!entry || typeof entry !== "object") return undefined;
  if (typeof entry.apiKey === "string" && entry.apiKey.trim()) return entry.apiKey.trim();
  if (typeof entry.key === "string" && entry.key.trim()) return entry.key.trim();
  return undefined;
}

function storeBraveApiKey(key: string) {
  const auth = readAuthFile();
  auth[AUTH_SERVICE] = {
    type: "api-key",
    apiKey: key.trim(),
    updatedAt: new Date().toISOString(),
  };
  writeAuthFile(auth);
}

function maskBraveApiKey(key: string) {
  const dashIndex = key.indexOf("-");
  if (dashIndex === -1) return "*".repeat(key.length);
  return `${key.slice(0, dashIndex + 1)}${"*".repeat(Math.max(key.length - dashIndex - 1, 0))}`;
}

function apiKey() {
  const key = getStoredBraveApiKey();
  if (!key) throw new Error(`Missing Brave Search API key in ${authPath()}. Run /brave-search and choose Set API Key to add it.`);
  return key;
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function abortSignal(timeoutMs: number, parent?: AbortSignal) {
  if (parent) return AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);
  return AbortSignal.timeout(timeoutMs);
}

function isPrivateAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isPrivateAddress(normalized.slice("::ffff:".length));
  }
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

async function assertSafePublicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only HTTP(S) URLs may be scraped");
  }
  if (url.username || url.password || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new Error("Local URLs may not be scraped");
  }
  const records = await lookup(url.hostname, { all: true, verbatim: true });
  if (records.length === 0 || records.some((record) => isPrivateAddress(record.address))) {
    throw new Error("Private-network URLs may not be scraped");
  }
  return url;
}

function truncateToolText(text: string) {
  const truncated = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!truncated.truncated) return truncated.content;
  return `${truncated.content}\n\n[Output truncated: ${truncated.outputLines} of ${truncated.totalLines} lines (${formatSize(truncated.outputBytes)} of ${formatSize(truncated.totalBytes)})]`;
}

function htmlToMarkdown(html: string) {
  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  turndown.use(gfm);
  turndown.addRule("removeEmptyLinks", {
    filter: (node) => node.nodeName === "A" && !node.textContent?.trim(),
    replacement: () => "",
  });

  return turndown
    .turndown(html)
    .replace(/\[\\?\[\s*\\?\]\]\([^)]*\)/g, "")
    .replace(/ +/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function scrapePage(url: string, options: { timeout?: number; maxChars?: number; signal?: AbortSignal } = {}) {
  const timeout = options.timeout ?? 30000;
  const maxChars = options.maxChars ?? 20000;
  let currentUrl = (await assertSafePublicUrl(url)).toString();
  let response: Response | undefined;
  for (let redirectCount = 0; redirectCount < 5; redirectCount += 1) {
    response = await fetch(currentUrl, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: abortSignal(timeout, options.signal),
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect response missing Location header");
    currentUrl = (await assertSafePublicUrl(new URL(location, currentUrl).toString())).toString();
  }
  if (!response) throw new Error("Failed to fetch URL");
  if (response.status >= 300 && response.status < 400) throw new Error("Too many redirects");
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }

  const html = await response.text();
  const dom = new JSDOM(html, { url: currentUrl });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  let title = article?.title?.trim() || dom.window.document.querySelector("title")?.textContent?.trim() || url;
  let markdown = "";

  if (article?.content) {
    markdown = htmlToMarkdown(article.content);
  } else {
    const fallbackDoc = new JSDOM(html, { url: currentUrl });
    const doc = fallbackDoc.window.document;
    doc.querySelectorAll("script, style, noscript, nav, header, footer, aside").forEach((el) => el.remove());
    const main = doc.querySelector("main, article, [role='main'], .content, #content") || doc.body;
    markdown = htmlToMarkdown(main?.innerHTML ?? "");
  }

  if (!markdown || markdown.length < 100) throw new Error("Could not extract readable page content");
  if (markdown.length > maxChars) markdown = `${markdown.slice(0, maxChars)}\n\n…truncated to ${maxChars} characters.`;

  return { title, url: currentUrl, markdown, length: markdown.length };
}

async function braveSearch(params: {
  query: string;
  source: BraveSource;
  limit: number;
  country?: string;
  searchLang?: string;
  uiLang?: string;
  freshness?: string;
  safesearch?: "off" | "moderate" | "strict";
  offset?: number;
  signal?: AbortSignal;
}) {
  const endpoint = params.source === "news" ? "news/search" : params.source === "images" ? "images/search" : "web/search";
  const searchParams = new URLSearchParams({
    q: params.query,
    count: Math.min(Math.max(params.limit, 1), 20).toString(),
    country: (params.country ?? "US").toUpperCase(),
    safesearch: params.safesearch ?? "moderate",
  });

  if (params.searchLang) searchParams.set("search_lang", params.searchLang);
  if (params.uiLang) searchParams.set("ui_lang", params.uiLang);
  if (params.freshness && params.source !== "images") searchParams.set("freshness", params.freshness);
  if (params.offset && params.offset > 0) searchParams.set("offset", params.offset.toString());
  if (params.source === "web") searchParams.set("text_decorations", "false");

  const response = await fetch(`https://api.search.brave.com/res/v1/${endpoint}?${searchParams}`, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey(),
    },
    signal: abortSignal(30000, params.signal),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brave API HTTP ${response.status}: ${response.statusText}\n${errorText}`);
  }

  const data = await response.json();
  const rawResults = params.source === "web" ? data.web?.results : data.results;
  const results: SearchResult[] = (Array.isArray(rawResults) ? rawResults : []).slice(0, params.limit).map((result: any) => ({
    title: result.title || result.meta_url?.hostname || "Untitled",
    url: result.url || result.properties?.url || result.source || "",
    description: result.description || result.snippet || result.meta_url?.path,
    age: result.age || result.page_age,
    source: result.profile?.name || result.meta_url?.hostname,
    thumbnail: result.thumbnail?.src || result.thumbnail?.original || result.properties?.thumbnail,
  })).filter((result) => result.url);

  return { query: params.query, source: params.source, results, raw: data };
}

function formatSearchResults(results: SearchResult[]) {
  if (results.length === 0) return "No results found.";

  return results.map((result, index) => {
    const lines = [`## ${index + 1}. ${result.title}`, `URL: ${result.url}`];
    if (result.source) lines.push(`Source: ${result.source}`);
    if (result.age) lines.push(`Age: ${result.age}`);
    if (result.description) lines.push(`Snippet: ${result.description}`);
    if (result.thumbnail) lines.push(`Thumbnail: ${result.thumbnail}`);
    if (result.markdown) lines.push(`\n### Page content\n${result.markdown}`);
    return lines.join("\n");
  }).join("\n\n---\n\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "brave_search",
    label: "Brave Search",
    description: "Search the web, news, or images using the Brave Search API. Can optionally fetch cleaned markdown from web/news result pages.",
    promptSnippet: "Search current web/news/image results with Brave Search.",
    promptGuidelines: [
      "Use brave_search when the user asks for current information, source discovery, documentation lookup, news, or web facts beyond the workspace.",
      "Use brave_search with scrapeResults for a small number of web/news results when snippets are not enough; use brave_scrape for full content from a known URL.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "The search query." }),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results. Defaults to 5; max 20.", minimum: 1, maximum: 20 })),
      source: Type.Optional(StringEnum(["web", "news", "images"] as const)),
      country: Type.Optional(Type.String({ description: "Two-letter country code for localized results. Defaults to US." })),
      searchLang: Type.Optional(Type.String({ description: "Search language code, e.g. en, de, fr." })),
      uiLang: Type.Optional(Type.String({ description: "UI language/locale, e.g. en-US." })),
      freshness: Type.Optional(Type.String({ description: "Freshness filter for web/news: pd, pw, pm, py, or YYYY-MM-DDtoYYYY-MM-DD." })),
      safesearch: Type.Optional(StringEnum(["off", "moderate", "strict"] as const)),
      offset: Type.Optional(Type.Number({ description: "Result offset for pagination." })),
      scrapeResults: Type.Optional(Type.Boolean({ description: "Fetch readable markdown for each web/news result. Defaults to false." })),
      maxContentChars: Type.Optional(Type.Number({ description: "Max markdown characters per scraped result. Defaults to 5000.", minimum: 500, maximum: 50000 })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);
        const source = params.source ?? "web";
        onUpdate?.({ content: [{ type: "text", text: `Searching Brave ${source} for: ${params.query}` }] });

        const search = await braveSearch({ ...params, source, limit, signal });

        if (params.scrapeResults && source !== "images") {
          for (const [index, result] of search.results.entries()) {
            if (signal?.aborted) throw new Error("Search cancelled");
            onUpdate?.({ content: [{ type: "text", text: `Scraping result ${index + 1}/${search.results.length}: ${result.url}` }] });
            try {
              const page = await scrapePage(result.url, { maxChars: params.maxContentChars ?? 5000, timeout: 15000, signal });
              result.markdown = page.markdown;
            } catch (error) {
              result.markdown = `(Could not scrape page: ${asErrorMessage(error)})`;
            }
          }
        }

        return {
          content: [{ type: "text", text: truncateToolText(formatSearchResults(search.results)) }],
          details: search,
        };
      } catch (error) {
        throw new Error(`Brave search failed: ${asErrorMessage(error)}`);
      }
    },
  });

  pi.registerTool({
    name: "brave_scrape",
    label: "Scrape Page",
    description: "Fetch a URL and extract readable markdown using Readability. Does not require Firecrawl; useful after Brave search finds a target page.",
    promptSnippet: "Fetch a known URL as cleaned markdown.",
    promptGuidelines: [
      "Use brave_scrape when you need the readable markdown content of a specific URL found via brave_search or supplied by the user.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "The URL to fetch." }),
      timeout: Type.Optional(Type.Number({ description: "Request timeout in milliseconds. Defaults to 30000." })),
      maxContentChars: Type.Optional(Type.Number({ description: "Maximum markdown characters to return. Defaults to 20000.", minimum: 500, maximum: 100000 })),
      includeMetadata: Type.Optional(Type.Boolean({ description: "Append title, URL, and content length metadata. Defaults to true." })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        onUpdate?.({ content: [{ type: "text", text: `Scraping page: ${params.url}` }] });
        const page = await scrapePage(params.url, { timeout: params.timeout ?? 30000, maxChars: params.maxContentChars ?? 20000, signal });
        const metadata = params.includeMetadata ?? true
          ? `\n\nMetadata:\n${stringify({ title: page.title, url: page.url, length: page.length })}`
          : "";

        return {
          content: [{ type: "text", text: truncateToolText(`# ${page.title}\n\n${page.markdown}${metadata}`) }],
          details: page,
        };
      } catch (error) {
        throw new Error(`Brave scrape failed: ${asErrorMessage(error)}`);
      }
    },
  });

  pi.registerCommand("brave-search", {
    description: "Manage Brave Search API key setup, view the masked key, or open usage info",
    handler: async (args, ctx) => {
      const supplied = (args ?? "").trim();
      const lower = supplied.toLowerCase();

      const setApiKey = async (keyArg?: string) => {
        const key = keyArg || (await ctx.ui.input(
          "Brave Search API key",
          "Paste your Brave Search API key from https://api-dashboard.search.brave.com/app/keys",
        ));

        if (!key?.trim()) {
          ctx.ui.notify("Brave Search setup cancelled.", "info");
          return;
        }

        try {
          storeBraveApiKey(key);
          ctx.ui.notify(`Saved Brave Search API key to ${authPath()}.`, "success");
        } catch (error) {
          ctx.ui.notify(`Could not save Brave Search API key: ${asErrorMessage(error)}`, "error");
        }
      };

      const getApiKey = () => {
        try {
          const key = apiKey();
          ctx.ui.notify(`Brave Search API key: ${maskBraveApiKey(key)}\nLocation: ${authPath()}`, "info");
        } catch (error) {
          ctx.ui.notify(asErrorMessage(error), "error");
        }
      };

      const viewUsage = () => {
        ctx.ui.notify("Go to:\nhttps://api-dashboard.search.brave.com/app/dashboard", "info");
      };

      if (lower === "set" || lower === "set api key") {
        await setApiKey();
        return;
      }
      if (lower.startsWith("set ")) {
        await setApiKey(supplied.slice(4).trim());
        return;
      }
      if (lower === "get" || lower === "get api key" || lower === "check") {
        getApiKey();
        return;
      }
      if (lower === "usage" || lower === "view usage") {
        viewUsage();
        return;
      }
      if (supplied) {
        await setApiKey(supplied);
        return;
      }

      const choice = await ctx.ui.select("Brave Search", ["Set API Key", "Get API Key", "View Usage"]);
      if (choice === "Set API Key") await setApiKey();
      else if (choice === "Get API Key") getApiKey();
      else if (choice === "View Usage") viewUsage();
      else ctx.ui.notify("Brave Search cancelled.", "info");
    },
  });
}
