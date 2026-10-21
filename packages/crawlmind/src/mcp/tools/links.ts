import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PaginationShape, type LinkSuggestion } from '../../core/index.js';
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
        'First use downloads a ~120 MB model and embeds the pages, which can take minutes.',
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
        'have overlapping titles/H1s, so they compete for the same searches.',
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
}
