# Brave Search Pi Extension

Web search and page-content extraction for Pi using the official Brave Search API.

## Features

- Search Brave web, news, or image results
- Localized search with country, search language, and UI language options
- Freshness filters for web/news results
- SafeSearch controls
- Pagination with result offsets
- Optional markdown extraction for search results
- Direct URL scraping to cleaned markdown using Readability + Turndown

## Setup

1. Create a Brave Search API key:
   <https://api-dashboard.search.brave.com/app/keys>

2. Install dependencies from this directory:

   ```bash
   cd ~/.pi/agent/extensions/brave-search
   npm install
   ```

3. Restart Pi or run `/reload`.

4. Store your Brave API key in Pi's `auth.json`:

   ```text
   /brave-search-setup
   ```

   You can also pass the key directly:

   ```text
   /brave-search-setup YOUR_BRAVE_API_KEY
   ```

   The extension stores the key under the `brave-search` entry in:

   ```text
   ~/.pi/agent/auth.json
   ```

5. Optional: verify configuration in Pi:

   ```text
   /brave-search-check
   ```

## Tools

### `brave_search`

Searches Brave web, news, or image results.

Common parameters:

- `query` - Search query
- `limit` - Number of results, default `5`, max `20`
- `source` - `web`, `news`, or `images`, default `web`
- `country` - Two-letter country code, default `US`
- `searchLang` - Search language, e.g. `en`, `de`, `fr`
- `uiLang` - UI locale, e.g. `en-US`
- `freshness` - Web/news time filter: `pd`, `pw`, `pm`, `py`, or `YYYY-MM-DDtoYYYY-MM-DD`
- `safesearch` - `off`, `moderate`, or `strict`, default `moderate`
- `offset` - Offset for pagination
- `scrapeResults` - Fetch readable markdown for each web/news result
- `maxContentChars` - Max scraped markdown characters per result

Example prompts:

```text
Search the web for the latest Svelte 5 migration guide.
```

```text
Find recent news about OpenAI from the past week and include sources.
```

```text
Search Brave for Rust async trait documentation and scrape the top 3 results.
```

### `brave_scrape`

Fetches a known URL and extracts readable markdown.

Parameters:

- `url` - URL to fetch
- `timeout` - Request timeout in milliseconds, default `30000`
- `maxContentChars` - Maximum markdown characters to return, default `20000`
- `includeMetadata` - Append title, URL, and length metadata, default `true`

Example prompts:

```text
Scrape https://example.com/article and summarize it.
```

```text
Fetch the markdown for this documentation page: https://docs.example.com/api
```

## Commands

### `/brave-search-setup`

Prompts for a Brave Search API key and saves it to `~/.pi/agent/auth.json`.

The stored entry looks like:

```json
{
  "brave-search": {
    "type": "api-key",
    "apiKey": "...",
    "updatedAt": "..."
  }
}
```

### `/brave-search-check`

Checks whether a Brave Search API key is configured in `~/.pi/agent/auth.json`.

## Notes

- `brave_search` uses the Brave Search API and requires a key stored by `/brave-search-setup`.
- `brave_scrape` fetches pages directly and does not require a separate scraping service.
- Scraping may fail on sites that block automated requests, require login, or render all content client-side.
