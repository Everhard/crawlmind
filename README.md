# Crawlmind

**AI-native SEO audits from your terminal or any MCP client.** Crawlmind crawls a website, finds
technical SEO problems, and goes further than other crawlers: it suggests the internal links you
should add and shows what changed between two crawls.

[![CI](https://github.com/Everhard/crawlmind/actions/workflows/ci.yml/badge.svg)](https://github.com/Everhard/crawlmind/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/crawlmind)](https://www.npmjs.com/package/crawlmind)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](https://github.com/Everhard/crawlmind/blob/main/LICENSE)

## What it can do

| Feature                            | What you get                                                                                                                           | CLI                    | MCP tool                     |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------- |
| 🕷️ **Site crawl**                  | Follows links and sitemaps, respects robots.txt, shows live progress                                                                   | `crawl`                | `start_crawl`                |
| 🩺 **Technical SEO audit**         | Broken links, redirect chains, canonical errors, missing and duplicate titles, thin content, orphan pages, slow pages, each with a fix | `summary`, `issues`    | `get_summary`, `get_issues`  |
| 🔎 **Page inspector**              | Everything about one URL: status, redirects, metadata, timings, link metrics                                                           | `page`                 | `get_page`                   |
| 🕸️ **Link graph**                  | Inlinks and outlinks by placement, click depth, internal PageRank                                                                      | `links`, `top`         | `get_links`, `get_top_pages` |
| 📉 **Under-linked pages**          | Important pages that get too few links from content                                                                                    | `top --by underlinked` | `get_top_pages`              |
| 🔗 **Internal link suggestions** ★ | Which page should link where, the paragraph that fits and anchor candidates                                                            | `suggest`              | `suggest_links`              |
| 🥊 **Keyword cannibalization** ★   | Page pairs that compete for the same topic                                                                                             | `cannibalization`      | `find_cannibalization`       |
| 🔄 **Crawl diffs** ★               | What changed since the last crawl: new 404s, lost inlinks, TTFB regressions, changed titles and canonicals                             | `diff`                 | `compare_crawls`             |
| 📄 **Reports**                     | A single-file HTML report (light and dark, works on phones) or Markdown                                                                | `report`               | `export_report`              |
| 🧮 **SQL access**                  | Read-only `SELECT` queries on the crawl database                                                                                       | `sql`                  | `query_data`                 |
| 🚦 **CI gate**                     | `--fail-on critical` exits with code 1 when critical issues are found                                                                  | `crawl --fail-on`      | —                            |
| 🤖 **Ready-made AI workflows**     | The `seo_audit` prompt ends with a prioritized fix list; `internal_linking_plan` builds a table of links to add                        | —                      | prompts                      |

★ Other crawlers don't do this. Link suggestions and cannibalization use local multilingual
embeddings: no API keys, nothing leaves your machine.

More detail: [all audit checks](https://github.com/Everhard/crawlmind/blob/main/docs/checks.md),
[MCP tools](https://github.com/Everhard/crawlmind/blob/main/docs/mcp.md) and
[how it works](https://github.com/Everhard/crawlmind/blob/main/docs/how-it-works.md).

## Install

Requires Node.js 22 or newer.

### As an MCP server

Claude Code:

```bash
claude mcp add crawlmind -- npx -y crawlmind-mcp
```

For Claude Desktop, Cursor and other clients, see the
[JSON config](https://github.com/Everhard/crawlmind/blob/main/docs/mcp.md#setup).

Then ask your AI client:

- "Audit https://example.com and give me the top 10 fixes."
- "Which internal links should I add to my blog?"
- "Which pages on my site respond slowest?"
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
crawlmind diff                               # what changed between the two latest crawls
crawlmind report -o audit.html               # self-contained HTML report (or -f md)
crawlmind sql "SELECT url, ttfb_ms FROM pages ORDER BY ttfb_ms DESC LIMIT 10"
crawlmind crawls                             # past crawls
```

Every command takes `--json` for machine-readable output (progress goes to stderr). In CI,
`crawlmind crawl <url> --fail-on critical` exits with code 1 when critical issues are found.

The CLI and the MCP server share one local database, so you can crawl from the terminal and then
ask your AI client about the result.

### The embeddings add-on

Internal link suggestions and cannibalization run a local embedding model. It takes about
700 MB of packages plus a 120 MB model, so it is an optional add-on, and everything else works
without it.

You don't need to install it up front. The first time you ask for link suggestions, Crawlmind
asks whether to install it, installs it into `~/.crawlmind`, and then answers your request. You
can also install it yourself: ask your AI client to "install the Crawlmind embeddings add-on",
or run:

```bash
crawlmind addon install   # crawlmind addon status shows whether it is installed
```

Some MCP clients (Claude Desktop, for example) can't show the server's question yet. In those
clients the AI asks you in the chat instead, and installs the add-on once you agree.

## Configuration

| Variable                           | Purpose                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `CRAWLMIND_HOME`                   | Data directory (default `~/.crawlmind`)                                   |
| `CRAWLMIND_ALLOW_PRIVATE_NETWORKS` | `1` lets MCP clients crawl private and local addresses                    |
| `CRAWLMIND_LOG_LEVEL`              | `debug`, `info`, `warn` (default), `error` or `silent`; logs go to stderr |
| `CRAWLMIND_ALLOW_REPORT_PATHS`     | `1` lets MCP clients write reports outside `~/.crawlmind/reports`         |

## Limits

- No JavaScript rendering: pages are analyzed as the server sends them. Sites that build their
  content in the browser show up nearly empty.
- One site per crawl (optionally with subdomains), up to 10,000 pages.
- Crawlmind only reads. No tool changes the audited site.

What the crawler sends and which limits it respects: see the
[crawling rules](https://github.com/Everhard/crawlmind/blob/main/docs/how-it-works.md#crawling-rules).

## Privacy

Everything stays on your machine, in `~/.crawlmind` (override with `CRAWLMIND_HOME`). Crawlmind
contacts only the site you crawl. When you install the embeddings add-on, it also contacts the
npm registry and Hugging Face once, to download the packages and the model. No telemetry.

## Development

See [CONTRIBUTING.md](https://github.com/Everhard/crawlmind/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/Everhard/crawlmind/blob/main/LICENSE) © 2026 Andrew Dorokhov
