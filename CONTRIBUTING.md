# Contributing

Thanks for helping improve Crawlmind.

## Setup

```bash
git clone https://github.com/Everhard/crawlmind.git
cd crawlmind
npm install
npm run build
```

Requires Node.js 22 or newer.

## Before opening a pull request

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

All four must pass; CI runs them on Node 22 and 24. Tests use a fake embedder; to also run the
real embedding model (downloads about 120 MB once), use `RUN_SLOW=1 npm test`.

Try the MCP server in the official inspector:

```bash
npx @modelcontextprotocol/inspector node packages/crawlmind/dist/cli.js mcp
```

## Layout

- `packages/crawlmind/src/core` is the engine. It must not import the MCP SDK, the CLI or CLI
  libraries (ESLint enforces this), so other front ends can reuse it.
- `packages/crawlmind/src/mcp` and `packages/crawlmind/src/cli` are thin layers over `core`.
- `packages/crawlmind-mcp` only re-exports `crawlmind mcp` as its own binary.

## Guidelines

- Never write to stdout from `core` or `mcp`: in MCP mode stdout belongs to the transport. Use
  `logger` (stderr).
- Keep changes small and covered by tests. Network tests use the local fixture server.
- Add a line to `CHANGELOG.md` under _Unreleased_.
