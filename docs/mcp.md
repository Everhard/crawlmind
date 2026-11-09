# MCP server

[← Back to README](../README.md)

How to connect Crawlmind to an AI client, and what the client can do with it.

## Setup

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

## The embeddings add-on

`suggest_links` and `find_cannibalization` need the optional embeddings add-on. Nothing has to
be configured for it:

- If the client supports [elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation)
  (Claude Code and Cursor do), the server asks the user whether to install the add-on the first
  time one of these tools runs. If the user agrees, it installs the add-on into
  `~/.crawlmind/addons` and the same tool call returns its normal result.
- If it doesn't (Claude Desktop, for example), the tool returns an error that asks the agent to
  check with the user and then call `install_embeddings`.

The server keeps running during the install, so the client doesn't need a restart. To install
the add-on by hand, add `-p @huggingface/transformers` to the `npx` arguments:
`npx -y -p crawlmind-mcp -p @huggingface/transformers crawlmind-mcp`.

## Tools

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
| `suggest_links`        | Internal links to add: source page, paragraph and anchor candidates          |
| `find_cannibalization` | Page pairs that compete for the same topic                                   |
| `compare_crawls`       | Diff two crawls: new and fixed errors, lost inlinks, TTFB regressions        |
| `export_report`        | Write a self-contained HTML or Markdown report to a file                     |
| `query_data`           | Read-only SQL `SELECT` on the crawl database, row-limited                    |
| `install_embeddings`   | Install the embeddings add-on (asks the user first in most clients)          |
| `ping`                 | Health check and whether the embeddings add-on is installed                  |

## Prompts

- `seo_audit` runs the full audit workflow and ends with a prioritized fix list.
- `internal_linking_plan` turns link suggestions into a table of links to add.

## Resources

- `crawlmind://checks/{id}` documents each check (why it matters, how to fix).
- `crawlmind://crawls/{id}/summary` gives the summary of a crawl.

## Configuration

The server reads these environment variables:

| Variable                           | Purpose                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `CRAWLMIND_HOME`                   | Data directory (default `~/.crawlmind`)                                   |
| `CRAWLMIND_ALLOW_PRIVATE_NETWORKS` | `1` lets MCP clients crawl private and local addresses                    |
| `CRAWLMIND_LOG_LEVEL`              | `debug`, `info`, `warn` (default), `error` or `silent`; logs go to stderr |
| `CRAWLMIND_ALLOW_REPORT_PATHS`     | `1` lets MCP clients write reports outside `~/.crawlmind/reports`         |

Set them in the client config:

```json
{
  "mcpServers": {
    "crawlmind": {
      "command": "npx",
      "args": ["-y", "crawlmind-mcp"],
      "env": { "CRAWLMIND_ALLOW_PRIVATE_NETWORKS": "1" }
    }
  }
}
```

Both `ALLOW` switches are off by default so that instructions hidden in a crawled page cannot
make the AI client scan your local network or overwrite your files. See [how it works](how-it-works.md#crawling-rules).

In the CLI, `--home <dir>` sets the data directory and `crawl --allow-private` crawls local
addresses. The CLI writes reports wherever you tell it to.
