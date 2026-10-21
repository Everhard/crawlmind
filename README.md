# Crawlmind

**AI-native SEO audits from your terminal or any MCP client.** Crawlmind crawls a website, finds
technical SEO problems, and goes further than other crawlers: it suggests the internal links you
should add, measures page speed per template instead of per page, and shows what changed between
two crawls.

[![CI](https://github.com/Everhard/crawlmind/actions/workflows/ci.yml/badge.svg)](https://github.com/Everhard/crawlmind/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/crawlmind)](https://www.npmjs.com/package/crawlmind)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> **Status:** early development (v0.1 in progress). The feature list below is the v0.1 goal;
> see [CHANGELOG.md](CHANGELOG.md) for what already works.

## What makes it different

1. **Internal link suggestions.** Local multilingual embeddings find pages that are about the same
   thing but not linked, and point to the paragraph where a link fits and the words that could
   become its anchor. They also detect keyword cannibalization.
2. **Speed by template.** Every crawled page gets TTFB and download timings. Pages are grouped
   into templates, and Lighthouse (via the PageSpeed Insights API) runs only on one or two
   representatives of each, so one fix covers thousands of pages.
3. **Crawl diffs.** Compare two crawls of the same site: new 404s, pages that lost inlinks, TTFB
   regressions, changed titles and canonicals.

## Install

Requires Node.js 22 or newer.

### As an MCP server

Claude Code:

```bash
claude mcp add crawlmind -- npx -y crawlmind-mcp
```

Claude Desktop, Cursor and other clients (JSON config):

```json
{
  "mcpServers": {
    "crawlmind": {
      "command": "npx",
      "args": ["-y", "crawlmind-mcp"]
    }
  }
}
```

`crawlmind-mcp` is a shortcut for `crawlmind mcp`; both start the same server over stdio.

### As a CLI

```bash
npx crawlmind --help
# or
npm install -g crawlmind
```

```bash
crawlmind crawl https://example.com          # crawl with live progress, then a summary
crawlmind crawl https://example.com -n 2000  # up to 2,000 pages
crawlmind summary                            # key numbers and top issues of the latest crawl
crawlmind issues --severity critical         # issues with examples
crawlmind issues --check links.broken_internal   # every affected URL of one check
crawlmind page /pricing                      # everything about one URL
crawlmind links /pricing --content-only      # who links here, from the main content
crawlmind top --by underlinked               # important pages that need more links
crawlmind templates                          # page templates with TTFB per template
crawlmind speed                              # PageSpeed Insights on template representatives
crawlmind sql "SELECT url, ttfb_ms FROM pages ORDER BY ttfb_ms DESC LIMIT 10"
crawlmind crawls                             # past crawls
```

Every command takes `--json` for machine-readable output (progress goes to stderr). In CI,
`crawlmind crawl <url> --fail-on critical` exits with code 1 when critical issues are found.

The CLI and the MCP server share one local database, so you can crawl from the terminal and then
ask your AI client about the result.

## Packages

| Package                                   | What it is                                |
| ----------------------------------------- | ----------------------------------------- |
| [`crawlmind`](packages/crawlmind)         | Engine, CLI (`crawlmind`) and MCP server  |
| [`crawlmind-mcp`](packages/crawlmind-mcp) | Shortcut binary that runs `crawlmind mcp` |

## MCP tools

| Tool                | What it does                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| `start_crawl`       | Start a background crawl and return its `crawl_id`                           |
| `get_crawl_status`  | Progress of a crawl; `wait_seconds` waits and streams progress               |
| `cancel_crawl`      | Stop a running crawl, keeping the pages fetched so far                       |
| `list_crawls`       | Past and running crawls, filterable by site                                  |
| `get_summary`       | Key numbers and top issues by severity, with examples and recommendations    |
| `get_issues`        | Issues filtered by severity; with `check_id`, every affected URL (paginated) |
| `get_page`          | Everything about one URL: status, redirects, metadata, timings, link metrics |
| `get_links`         | Inlinks or outlinks of a URL with anchors, `rel` and placement               |
| `get_top_pages`     | Pages by PageRank, inlinks, depth, TTFB, or `underlinked` important pages    |
| `get_templates`     | Templates with page counts, TTFB median/p90 and PageSpeed results            |
| `measure_templates` | Lighthouse (PageSpeed Insights) on 1–2 representatives per template          |
| `query_data`        | Read-only SQL `SELECT` on the crawl database, row-limited                    |
| `ping`              | Health check                                                                 |

Resources: `crawlmind://checks/{id}` documents each check (why it matters, how to fix), and
`crawlmind://crawls/{id}/summary` gives the summary of a crawl.

## Checks

Every issue has the same shape: `id`, `severity` (critical, warning, info), `title`, `count`,
up to five `examples` and a `recommendation`.

| Area      | Checks                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------ |
| Status    | 4xx and 5xx pages, unreachable pages                                                                   |
| Links     | broken internal and external links, links to redirects, internal `nofollow`, generic and empty anchors |
| Redirects | chains longer than one hop, loops                                                                      |
| Sitemap   | orphan pages, `noindex` pages listed, non-200 URLs listed                                              |
| Canonical | canonical to an error page, to a redirect, to a different page                                         |
| Content   | missing or duplicate titles, meta descriptions and H1, thin content (default < 200 words)              |
| Structure | pages more than 3 clicks deep                                                                          |
| Speed     | TTFB over 800 ms, HTML over 1 MB, mixed content                                                        |

Generic anchors ("click here", "read more", "подробнее", "mehr erfahren", …) are listed per
language in [`generic-anchors.ts`](packages/crawlmind/src/core/config/generic-anchors.ts).

### Link graph

Inlinks and outlinks are counted per page and by placement (nav, header, footer, main, other),
with links through redirects credited to the final page. Click depth is a breadth-first search
from the start URL. Internal PageRank uses damping 0.85, spreads the rank of pages without
outlinks evenly, ignores `nofollow`, and iterates until the total change is below 1e-6;
scores are shown 0–100 relative to the strongest page.

## Speed by template

Every crawled page gets its time to first byte and download time. Pages are then grouped into
templates, and Lighthouse runs only on one or two representatives per template, so a site with
thousands of product pages needs a handful of PageSpeed Insights calls instead of thousands:

> 3,400 pages use template `/product/*` with mobile LCP 4.2 s (real-user, poor), score 38.
> Fixing this one template improves all of them.

How pages are grouped:

1. **URL pattern.** Path segments are compared level by level. Numbers, dates, UUIDs, hex ids
   and long slugs become `*`; siblings that differ only in digits (`post-1`, `post-2`) become
   `*`; below the first level, four or more distinct sibling values become `*`. First-level
   sections (`/blog`, `/shop`) are never merged by count alone.
2. **DOM structure.** Each page's skeleton (the set of tag paths below `<body>`, six levels
   deep, ignoring text and attributes) is reduced to a 32-value MinHash signature. Within one
   URL pattern, pages whose estimated Jaccard similarity is at least 0.8 form one template,
   so `/p/*` pages with two different layouts become two templates.
3. **Representatives** are the pages whose TTFB is closest to the template median: typical,
   not the best or worst case.

PageSpeed Insights runs on demand (`measure_templates` / `crawlmind speed`), mobile by default,
with a 60 s timeout and retries with backoff. Results (performance score, LCP, CLS, TBT, FCP,
page weight and CrUX field data when Google has it) are stored per crawl and reused. Without
`PSI_API_KEY` Crawlmind uses Google's shared keyless quota one request at a time, which is
often exhausted; a [free API key](https://developers.google.com/speed/docs/insights/v5/get-started)
raises it.

## Configuration

| Variable                           | Purpose                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `CRAWLMIND_HOME`                   | Data directory (default `~/.crawlmind`)                                   |
| `PSI_API_KEY`                      | PageSpeed Insights API key                                                |
| `CRAWLMIND_ALLOW_PRIVATE_NETWORKS` | `1` lets MCP clients crawl private and local addresses                    |
| `CRAWLMIND_LOG_LEVEL`              | `debug`, `info`, `warn` (default), `error` or `silent`; logs go to stderr |

## Crawling rules

- Identifies itself as `CrawlmindBot/<version> (+https://github.com/Everhard/crawlmind)`.
- Follows robots.txt, including `Crawl-delay` (capped at 10 s), unless told not to.
- Defaults: 500 pages (hard cap 10,000), depth 10, 4 parallel requests, 250 ms between
  requests to the same host, 15 s timeout, 5 MB per page.
- Only `text/html` is parsed. Sitemaps (from robots.txt and `/sitemap.xml`, indexes and gzip
  included) add URLs that links do not reach.
- Refuses private, loopback and link-local addresses, checked on every connection and redirect
  hop (DNS rebinding included). For intranet or local sites use `--allow-private` in the CLI.
  MCP clients may only set `allowPrivateNetworks` when the server runs with
  `CRAWLMIND_ALLOW_PRIVATE_NETWORKS=1`, so a prompt injection on a crawled page cannot turn the
  AI client into a local network scanner.

## Privacy

Everything stays on your machine, in `~/.crawlmind` (override with `CRAWLMIND_HOME`). Crawlmind
contacts only the site you crawl and, when you ask for it, the PageSpeed Insights API. No
telemetry.

## Development

```bash
npm install
npm run build
npm run lint && npm run typecheck && npm test
```

Try the MCP server in the official inspector:

```bash
npx @modelcontextprotocol/inspector node packages/crawlmind/dist/cli.js mcp
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Andrew Dorokhov
