import type { Engine } from '../core/index.js';

export interface ToolContext {
  engine: Engine;
  /**
   * Whether MCP clients may set `allowPrivateNetworks`. Off unless the operator enables it
   * (env `CRAWLMIND_ALLOW_PRIVATE_NETWORKS=1`): crawled pages can carry prompt injections, and
   * an AI client must not be talked into probing the local network.
   */
  allowPrivateNetworks: boolean;
}
