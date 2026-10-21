# Crawlmind

**AI-native SEO audits from your terminal or any MCP client.** Crawlmind crawls a website, finds
technical SEO problems, and goes further than other crawlers: it suggests the internal links you
should add, measures page speed per template instead of per page, and shows what changed between
two crawls.

[![CI](https://github.com/Everhard/crawlmind/actions/workflows/ci.yml/badge.svg)](https://github.com/Everhard/crawlmind/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/crawlmind)](https://www.npmjs.com/package/crawlmind)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

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
For internal link suggestions, add the embeddings add-on (see
[below](#the-embeddings-add-on)).

Then ask your AI client:

- "Audit https://example.com and give me the top 10 fixes."
- "Which internal links should I add to my blog?"
- "Which templates on my shop are slow on mobile?"
- "Crawl the site again and tell me what broke since last week."
- "Export an HTML report of the last crawl to ~/Desktop/audit.html."

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
crawlmind suggest                            # internal links to add (needs the embeddings add-on)
crawlmind suggest --target /pricing          # links that should point to one page
crawlmind cannibalization                    # pages competing for the same topic
crawlmind templates                          # page templates with TTFB per template
crawlmind speed                              # PageSpeed Insights on template representatives
crawlmind diff                               # what changed between the two latest crawls
crawlmind report -o audit.html               # self-contained HTML report (or -f md)
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

| Tool                   | What it does                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- |
| `start_crawl`          | Start a background crawl and return its `crawl_id`                           |
| `get_crawl_status`     | Progress of a crawl; `wait_seconds` waits and streams progress               |
| `cancel_crawl`         | Stop a running crawl, keeping the pages fetched so far                       |
| `list_crawls`          | Past and running crawls, filterable by site                                  |
| `get_summary`          | Key numbers and top issues by severity, with examples and recommendations    |
| `get_issues`           | Issues filtered by severity; with `check_id`, every affected URL (paginated) |
| `get_page`             | Everything about one URL: status, redirects, metadata, timings, link metrics |
| `get_links`            | Inlinks or outlinks of a URL with anchors, `rel` and placement               |
| `get_top_pages`        | Pages by PageRank, inlinks, depth, TTFB, or `underlinked` important pages    |
| `get_templates`        | Templates with page counts, TTFB median/p90 and PageSpeed results            |
| `measure_templates`    | Lighthouse (PageSpeed Insights) on 1–2 representatives per template          |
| `suggest_links`        | Internal links to add: source page, paragraph and anchor candidates          |
| `find_cannibalization` | Page pairs that compete for the same topic                                   |
| `compare_crawls`       | Diff two crawls: new and fixed errors, lost inlinks, TTFB regressions        |
| `export_report`        | Write a self-contained HTML or Markdown report to a file                     |
| `query_data`           | Read-only SQL `SELECT` on the crawl database, row-limited                    |
| `ping`                 | Health check                                                                 |

Prompts: `seo_audit` runs the full audit workflow and ends with a prioritized fix list;
`internal_linking_plan` turns link suggestions into a table of links to add.

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

## Internal link suggestions

Crawlmind embeds every indexable page (title, H1 and the start of the main content) with a
local model and looks for pages that are about the same topic as a target but do not link to it
yet. For each pair it returns:

- the **paragraph** of the source page that fits the target best (paragraphs of the main
  content are embedded separately),
- **anchor candidates**: phrases from that paragraph that share key words with the target's
  title and H1, matched by word prefixes so inflected forms count (`беговые кроссовки` for
  "Лучшие беговые кроссовки"),
- the similarity and the target's content inlinks and PageRank.

Without a target, the most link-worthy pages come first: rank =
`similarity × (1 + importance / (1 + content inlinks))`, where importance is the larger of the
page's relative PageRank and its sitemap priority. Crawlmind never writes the final sentence;
your AI client does, from this context. No API keys are involved.

**Cannibalization**: pairs of indexable pages whose embeddings are at least 0.92 similar and
whose title/H1 key words overlap by at least 50%.

### The embeddings add-on

The model runs locally with [transformers.js](https://huggingface.co/docs/transformers.js).
Its ONNX runtime is several hundred megabytes, so it is an optional peer dependency and
everything else works without it. To enable link suggestions:

```bash
npm install -g crawlmind @huggingface/transformers
# or, without installing:
npx -p crawlmind -p @huggingface/transformers crawlmind suggest
```

For MCP clients:

```bash
claude mcp add crawlmind -- npx -y -p crawlmind-mcp -p @huggingface/transformers crawlmind-mcp
```

The model is downloaded once (about 120 MB) into `~/.crawlmind/models`. Page vectors are stored
per crawl; paragraph vectors are computed only for pages that appear in suggestions.

**Model choice.** [`Xenova/multilingual-e5-small`](https://huggingface.co/Xenova/multilingual-e5-small)
(8-bit quantized, 384 dimensions) covers about 100 languages, which matters for sites that are
not in English, and is strong at retrieval for its size: it is the smallest of the e5 family
that clearly beats older multilingual MiniLM models on retrieval benchmarks, while still
embedding hundreds of pages per minute on a laptop CPU. Its cosine similarities cluster high,
so the default thresholds (0.82 for suggestions, 0.92 for cannibalization) are tuned for it.

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

## Crawl diffs and reports

Crawls are kept, so any two crawls of a site can be compared (`compare_crawls`,
`crawlmind diff`): new and fixed 4xx/5xx pages, new and fixed broken links, pages added and
removed, the pages that gained or lost the most inlinks, TTFB regressions (at least 200 ms and
50% slower), title and canonical changes, and how each issue count moved. A warning is added
when the crawls differ much in size, since "removed" pages may just not have been reached.

Reports (`export_report`, `crawlmind report`) contain the summary, every issue with up to ten
examples and its fix, under-linked important pages, speed by template, and the strongest and
slowest pages. The HTML version is a single file with inline CSS, no scripts, light and dark
themes, and works on phones. A report never replaces an existing file unless asked to.

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

## Limits

- No JavaScript rendering: pages are analyzed as the server sends them. Sites that build their
  content in the browser show up nearly empty.
- One site per crawl (optionally with subdomains), up to 10,000 pages.
- Crawlmind only reads. No tool changes the audited site.

## Privacy

Everything stays on your machine, in `~/.crawlmind` (override with `CRAWLMIND_HOME`). Crawlmind
contacts only the site you crawl, the PageSpeed Insights API when you measure templates, and
Hugging Face once to download the embedding model when you first use link suggestions. No
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

Layout: `packages/crawlmind/src/core` is the engine (crawler, storage, analysis, speed,
embeddings, report, diff) and never imports the MCP SDK or CLI libraries; `src/mcp` and
`src/cli` are thin layers over it.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Andrew Dorokhov
