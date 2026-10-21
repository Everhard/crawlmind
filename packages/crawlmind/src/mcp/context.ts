import type { Engine } from '../core/index.js';

export interface ToolContext {
  engine: Engine;
  /**
   * Whether MCP clients may set `allowPrivateNetworks`. Off unless the operator enables it
   * (env `CRAWLMIND_ALLOW_PRIVATE_NETWORKS=1`): crawled pages can carry prompt injections, and
   * an AI client must not be talked into probing the local network.
   */
  allowPrivateNetworks: boolean;
  /**
   * Whether export_report may write outside ~/.crawlmind/reports. Off unless the operator sets
   * `CRAWLMIND_ALLOW_REPORT_PATHS=1`, so an injected instruction cannot overwrite user files.
   */
  allowReportPaths?: boolean;
}
