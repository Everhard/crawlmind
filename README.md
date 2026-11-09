# Crawlmind

**AI-native SEO audits from your terminal or any MCP client.** Crawlmind crawls a website, finds
technical SEO problems, and goes further than other crawlers: it suggests the internal links you
should add and shows what changed between two crawls.

[![CI](https://github.com/Everhard/crawlmind/actions/workflows/ci.yml/badge.svg)](https://github.com/Everhard/crawlmind/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/crawlmind)](https://www.npmjs.com/package/crawlmind)
[![MCP](https://img.shields.io/badge/MCP-server-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](https://github.com/Everhard/crawlmind/blob/main/LICENSE)

## 💬 Just ask your AI

Connect Crawlmind to Claude, Cursor or any MCP client ([install](#install)) and talk to it:

| You ask                                                        | Crawlmind does                                                       |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| 🩺 _"Audit https://example.com and give me the top 10 fixes."_ | Crawls the site, ranks the issues and explains how to fix each one   |
| 🔗 _"Which internal links should I add to my blog?"_           | Finds related pages that don't link to each other, with anchor ideas |
| 🥊 _"Do any of my pages compete for the same keywords?"_       | Lists page pairs that cover the same topic                           |
| 🐢 _"Which pages on my site respond slowest?"_                 | Ranks pages by server response time (TTFB)                           |
| 🔄 _"Crawl again and tell me what broke since last week."_     | Compares two crawls: new 404s, lost links, slower pages              |
| 📄 _"Make an HTML report of the last crawl."_                  | Writes a single-file report you can send to a client or a team       |

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
embeddings: no API keys, nothing leaves your machine. The embeddings add-on (about 800 MB)
installs itself the first time you use these features, after you confirm.

Crawlmind analyzes pages as the server sends them and does not run JavaScript, so sites that
build their content in the browser show up nearly empty.

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

Then ask your AI client anything, for example the questions [above](#-just-ask-your-ai).

### As a CLI

```bash
npx crawlmind --help
# or
npm install -g crawlmind
```

**🕷️ Crawl**

```bash
crawlmind crawl https://example.com          # crawl with live progress, then a summary
crawlmind crawl https://example.com -n 2000  # up to 2,000 pages (default 1,000)
crawlmind crawl https://example.com -n 0     # the whole site, no page limit
crawlmind crawls                             # past crawls
```

**🩺 Audit**

```bash
crawlmind summary                               # key numbers and top issues of the latest crawl
crawlmind issues --severity critical            # issues with examples
crawlmind issues --check links.broken_internal  # every affected URL of one check
crawlmind page /pricing                         # everything about one URL
```

**🔗 Links**

```bash
crawlmind links /pricing --content-only  # who links here, from the main content
crawlmind top --by underlinked           # important pages that need more links
crawlmind suggest                        # internal links to add (installs embeddings on first use)
crawlmind suggest --target /pricing      # links that should point to one page
crawlmind cannibalization                # pages competing for the same topic
```

**🔄 Compare and export**

```bash
crawlmind diff                  # what changed between the two latest crawls
crawlmind report -o audit.html  # self-contained HTML report (or -f md)
```

**🧮 Advanced**

```bash
# read-only SQL on the crawl database
crawlmind sql "SELECT url, ttfb_ms FROM pages ORDER BY ttfb_ms DESC LIMIT 10"
crawlmind addon status  # is the embeddings add-on installed?
```

Every command takes `--json` for machine-readable output (progress goes to stderr). In CI,
`crawlmind crawl <url> --fail-on critical` exits with code 1 when critical issues are found.

The CLI and the MCP server share one local database, so you can crawl from the terminal and then
ask your AI client about the result.

## Privacy

Everything stays on your machine, in `~/.crawlmind` (override with `CRAWLMIND_HOME`). Crawlmind
contacts only the site you crawl. When you install the embeddings add-on, it also contacts the
npm registry and Hugging Face once, to download the packages and the model. No telemetry.

Crawlmind only reads; it never changes the audited site. What the crawler sends and which limits
it respects: see the
[crawling rules](https://github.com/Everhard/crawlmind/blob/main/docs/how-it-works.md#crawling-rules).

## Development

See [CONTRIBUTING.md](https://github.com/Everhard/crawlmind/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/Everhard/crawlmind/blob/main/LICENSE) © 2026 Andrew Dorokhov
