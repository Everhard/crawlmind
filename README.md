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

The CLI and the MCP server share one local database, so you can crawl from the terminal and then
ask your AI client about the result.

## Packages

| Package                                   | What it is                                |
| ----------------------------------------- | ----------------------------------------- |
| [`crawlmind`](packages/crawlmind)         | Engine, CLI (`crawlmind`) and MCP server  |
| [`crawlmind-mcp`](packages/crawlmind-mcp) | Shortcut binary that runs `crawlmind mcp` |

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
