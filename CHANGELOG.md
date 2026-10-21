# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Monorepo with two packages: `crawlmind` (engine, CLI, MCP server) and
  `crawlmind-mcp` (shortcut binary for `crawlmind mcp`).
- `crawlmind mcp` starts an MCP server over stdio with a `ping` tool.
- Crawler: breadth-first crawl with concurrency, per-host delay, robots.txt (including
  `Crawl-delay`), sitemap and sitemap-index seeding (gzip supported), manual redirect following
  with full chains and loop detection, 15 s timeouts, 5 MB body cap, gzip/deflate/br/zstd
  decoding, and external link checks (HEAD with GET fallback, per-host limits).
- SSRF protection: private, loopback and link-local addresses are refused on every connection
  and redirect hop unless `allowPrivateNetworks` is set (IPv4-mapped, NAT64, 6to4 and Teredo
  forms included). MCP clients can set it only when the server runs with
  `CRAWLMIND_ALLOW_PRIVATE_NETWORKS=1`. Gzipped sitemaps are size-capped after inflation.
- Per-page data: status, timings (TTFB, download), title, meta description, H1s, canonical,
  meta robots, `X-Robots-Tag`, `lang`, main-content word count and hash, scripts, stylesheets,
  mixed content; per-link anchor, `rel` and placement (nav, header, footer, main, other).
- SQLite storage in `~/.crawlmind` (`CRAWLMIND_HOME`), with migrations.
- MCP tools: `start_crawl`, `get_crawl_status` (with `wait_seconds` and progress notifications),
  `cancel_crawl`, `list_crawls`.
- CLI: `crawlmind crawl <url>` with live progress and Ctrl+C to cancel, `crawlmind crawls`,
  global `--json`, `--no-color`, `--home`.
- Analysis after every crawl: 28 checks with one shared issue schema (status codes, broken
  internal and external links, redirect chains and loops, links to redirects, orphan and
  noindex sitemap pages, canonical problems, missing and duplicate titles, descriptions and H1,
  thin content, deep pages, slow TTFB, large HTML, mixed content, internal nofollow, generic and
  empty anchors in nine languages).
- Link graph: inlinks and outlinks by placement, click depth, internal PageRank, and an
  "under-linked important pages" ranking.
- MCP tools `get_summary`, `get_issues`, `get_page`, `get_links`, `get_top_pages`, `query_data`
  (read-only SQL on a separate read-only connection); resources `crawlmind://checks/{id}` and
  `crawlmind://crawls/{id}/summary`.
- CLI commands `summary`, `issues`, `page`, `links`, `top`, `sql`; `crawl` prints the summary
  and supports `--fail-on` and `--thin-words`.
- Speed by template: TTFB and download time per page, templates from URL patterns plus a
  MinHash DOM fingerprint, PageSpeed Insights v5 on template representatives (lab metrics and
  CrUX field data, retries, stored results). MCP tools `get_templates`, `measure_templates`;
  CLI commands `templates`, `speed`.
- Internal link suggestions and keyword cannibalization from local multilingual embeddings
  (`Xenova/multilingual-e5-small` via the optional peer `@huggingface/transformers`): source
  page, best paragraph and anchor candidates per suggestion. MCP tools `suggest_links`,
  `find_cannibalization` and prompt `internal_linking_plan`; CLI commands `suggest`,
  `cannibalization`.
- Build (tsup), lint (ESLint, Prettier), typecheck, tests (Vitest) and CI on Node 22 and 24.
