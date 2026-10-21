# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Monorepo with two packages: `crawlmind` (engine, CLI, MCP server) and
  `crawlmind-mcp` (shortcut binary for `crawlmind mcp`).
- `crawlmind mcp` starts an MCP server over stdio with a `ping` tool.
- Build (tsup), lint (ESLint, Prettier), typecheck, tests (Vitest) and CI on Node 22 and 24.
