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
  and redirect hop unless `allowPrivateNetworks` is set.
- Per-page data: status, timings (TTFB, download), title, meta description, H1s, canonical,
  meta robots, `X-Robots-Tag`, `lang`, main-content word count and hash, scripts, stylesheets,
  mixed content; per-link anchor, `rel` and placement (nav, header, footer, main, other).
- SQLite storage in `~/.crawlmind` (`CRAWLMIND_HOME`), with migrations.
- MCP tools: `start_crawl`, `get_crawl_status` (with `wait_seconds` and progress notifications),
  `cancel_crawl`, `list_crawls`.
- CLI: `crawlmind crawl <url>` with live progress and Ctrl+C to cancel, `crawlmind crawls`,
  global `--json`, `--no-color`, `--home`.
- Build (tsup), lint (ESLint, Prettier), typecheck, tests (Vitest) and CI on Node 22 and 24.
