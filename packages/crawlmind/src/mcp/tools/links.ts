import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  ADDON_SIZE_NOTE,
  CrawlmindError,
  PaginationShape,
  type Engine,
  type LinkSuggestion,
} from '../../core/index.js';
import type { ToolContext } from '../context.js';
import { more } from '../format.js';
import type { ToolExtra } from '../progress.js';
import { safe, toolResult } from '../result.js';

const crawlId = z.string().min(1).describe('Crawl id from start_crawl or list_crawls');

function messageProgress(extra: ToolExtra) {
  const token = extra._meta?.progressToken;
  if (token === undefined) return undefined;
  let step = 0;
  return (message: string) => {
    void extra
      .sendNotification({
        method: 'notifications/progress',
        params: { progressToken: token, progress: ++step, message },
      })
      .catch(() => undefined);
  };
}

/** How long the user has to answer the install question. */
const ELICIT_TIMEOUT_MS = 10 * 60_000;

/**
 * Make sure the embeddings add-on is installed before a tool needs it. When it is missing and
 * the client can ask the user (MCP elicitation), ask once and install, so the original request
 * just continues. Otherwise tell the agent how to proceed.
 */
async function ensureEmbeddings(
  server: McpServer,
  engine: Engine,
  extra: ToolExtra,
): Promise<void> {
  if (engine.embeddings.status().installed) return;

  if (!server.server.getClientCapabilities()?.elicitation?.form) {
    throw new CrawlmindError(
      'invalid_input',
      'This needs the embeddings add-on, which is not installed.',
      `Ask the user whether to install it (${ADDON_SIZE_NOTE}); if they agree, call install_embeddings and retry.`,
    );
  }

  const answer = await server.server.elicitInput(
    {
      mode: 'form',
      message:
        `Link suggestions and cannibalization need the Crawlmind embeddings add-on ` +
        `(${ADDON_SIZE_NOTE}). It runs locally; no API keys. Install it now?`,
      requestedSchema: {
        type: 'object',
        properties: {
          install: {
            type: 'boolean',
            title: 'Install the embeddings add-on',
            default: true,
          },
        },
        required: ['install'],
      },
    },
    { timeout: ELICIT_TIMEOUT_MS },
  );
  if (answer.action !== 'accept' || answer.content?.install !== true) {
    throw new CrawlmindError(
      'invalid_input',
      'The user chose not to install the embeddings add-on, so this tool cannot run.',
      'Do not retry unless the user asks for it.',
    );
  }
  await engine.embeddings.install(messageProgress(extra));
}

function describeSuggestion(s: LinkSuggestion, i: number): string {
  const anchors = s.anchorCandidates.length
    ? ` Anchor ideas: ${s.anchorCandidates.map((a) => `"${a}"`).join(', ')}.`
    : '';
  return `${i + 1}. On ${s.sourceUrl} link to ${s.targetUrl} ("${s.targetTitle ?? ''}"), similarity ${s.similarity}, target has ${s.targetMainInlinks} content inlinks.\n   Paragraph: "${s.paragraph}"${anchors}`;
}

const SuggestionSchema = z.looseObject({
  sourceUrl: z.string(),
  targetUrl: z.string(),
  similarity: z.number(),
  paragraph: z.string(),
  anchorCandidates: z.array(z.string()),
  score: z.number(),
});

export function registerLinkTools(server: McpServer, { engine }: ToolContext): void {
  server.registerTool(
    'suggest_links',
    {
      title: 'Internal link suggestions',
      description:
        'Suggest internal links to add, from local multilingual embeddings: source pages that are ' +
        'about the same topic as a target but do not link to it yet, the paragraph where the ' +
        'link fits, and phrases from it that could become the anchor. Without target_url, ' +
        'under-linked important pages are prioritized. You write the final anchor and sentence. ' +
        'First use downloads a ~120 MB model and embeds the pages, which can take minutes. ' +
        'Needs the embeddings add-on; if it is missing, the user is asked whether to install it.',
      inputSchema: {
        crawl_id: crawlId,
        target_url: z.string().optional().describe('Only suggest links pointing to this page'),
        min_similarity: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('Default 0.82 (tuned for the default model)'),
        ...PaginationShape,
      },
      outputSchema: {
        items: z.array(SuggestionSchema),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ crawl_id, target_url, min_similarity, limit, offset }, extra) => {
      engine.crawls.requireCrawl(crawl_id);
      await ensureEmbeddings(server, engine, extra);
      const page = await engine.links.suggest(crawl_id, {
        targetUrl: target_url,
        minSimilarity: min_similarity,
        limit,
        offset,
        onProgress: messageProgress(extra),
      });
      const text = page.items.length
        ? `${page.total} suggestion(s):\n${page.items.map((s, i) => describeSuggestion(s, offset + i)).join('\n')}${more(page)}`
        : 'No link suggestions above the similarity threshold. Try a lower min_similarity.';
      return toolResult(page, text);
    }),
  );

  server.registerTool(
    'find_cannibalization',
    {
      title: 'Keyword cannibalization',
      description:
        'Pairs of indexable pages that cover the same topic (very high embedding similarity) and ' +
        'have overlapping titles/H1s, so they compete for the same searches. Needs the ' +
        'embeddings add-on; if it is missing, the user is asked whether to install it.',
      inputSchema: { crawl_id: crawlId, ...PaginationShape },
      outputSchema: {
        items: z.array(
          z.looseObject({
            urlA: z.string(),
            urlB: z.string(),
            similarity: z.number(),
            titleOverlap: z.number(),
          }),
        ),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(async ({ crawl_id, limit, offset }, extra) => {
      engine.crawls.requireCrawl(crawl_id);
      await ensureEmbeddings(server, engine, extra);
      const page = await engine.links.cannibalization(crawl_id, {
        limit,
        offset,
        onProgress: messageProgress(extra),
      });
      const text = page.items.length
        ? `${page.total} competing pair(s):\n${page.items
            .map(
              (p) =>
                `- ${p.urlA} ("${p.titleA ?? ''}") vs ${p.urlB} ("${p.titleB ?? ''}"): similarity ${p.similarity}, shared terms ${p.sharedTerms.join(', ')}`,
            )
            .join(
              '\n',
            )}${more(page)}\n\nMerge them, differentiate their topics, or canonicalize the weaker one.`
        : 'No cannibalization found.';
      return toolResult(page, text);
    }),
  );

  server.registerTool(
    'install_embeddings',
    {
      title: 'Install the embeddings add-on',
      description:
        `Install the optional embeddings add-on (${ADDON_SIZE_NOTE}) that suggest_links and ` +
        'find_cannibalization need. Call it when the user asks to install it, or agrees after ' +
        'one of those tools reports that it is missing. Takes one to a few minutes; does ' +
        'nothing if it is already installed.',
      inputSchema: {},
      outputSchema: {
        installed: z.boolean(),
        source: z.enum(['peer', 'addon', 'custom']).nullable(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    safe(async (_args, extra) => {
      if (engine.embeddings.status().installed) {
        return toolResult(
          engine.embeddings.status(),
          'The embeddings add-on is already installed.',
        );
      }
      const status = await engine.embeddings.install(messageProgress(extra));
      return toolResult(
        status,
        'Installed the embeddings add-on. suggest_links and find_cannibalization are ready.',
      );
    }),
  );
}
