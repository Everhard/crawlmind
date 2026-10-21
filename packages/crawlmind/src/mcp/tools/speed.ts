import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PaginationShape, type TemplateInfo } from '../../core/index.js';
import type { ToolContext } from '../context.js';
import { more } from '../format.js';
import type { ToolExtra } from '../progress.js';
import { safe, toolResult } from '../result.js';

const crawlId = z.string().min(1).describe('Crawl id from start_crawl or list_crawls');

const MeasurementSchema = z.looseObject({
  url: z.string(),
  strategy: z.enum(['mobile', 'desktop']),
  performanceScore: z.number().nullable(),
  lcpMs: z.number().nullable(),
  error: z.string().nullable(),
});
const TemplateSchema = z.looseObject({
  templateId: z.number().int(),
  label: z.string(),
  pageCount: z.number().int(),
  ttfbMedianMs: z.number().nullable(),
  representatives: z.array(z.string()),
  measurements: z.array(MeasurementSchema),
});

function describeTemplate(t: TemplateInfo): string {
  const ttfb = t.ttfbMedianMs === null ? '—' : `${Math.round(t.ttfbMedianMs)} ms`;
  const p90 = t.ttfbP90Ms === null ? '—' : `${Math.round(t.ttfbP90Ms)} ms`;
  const psi = t.measurements
    .filter((m) => !m.error)
    .map(
      (m) =>
        `${m.strategy} score ${m.performanceScore ?? '—'}, LCP ${m.lcpMs === null ? '—' : `${(m.lcpMs / 1000).toFixed(1)} s`}`,
    )
    .join('; ');
  return `#${t.templateId} ${t.label}: ${t.pageCount} pages (${t.sharePercent}%), TTFB median ${ttfb}, p90 ${p90}${psi ? `, ${psi}` : ''}. Example: ${t.representatives[0] ?? '—'}`;
}

function measureProgress(extra: ToolExtra) {
  const token = extra._meta?.progressToken;
  if (token === undefined) return undefined;
  return (done: number, total: number, url: string) => {
    void extra
      .sendNotification({
        method: 'notifications/progress',
        params: {
          progressToken: token,
          progress: done,
          total,
          message: `PageSpeed Insights: ${url}`,
        },
      })
      .catch(() => undefined);
  };
}

export function registerSpeedTools(server: McpServer, { engine }: ToolContext): void {
  server.registerTool(
    'get_templates',
    {
      title: 'Templates',
      description:
        'Page templates of a crawl (pages grouped by URL pattern and DOM structure), largest ' +
        'first, with page counts, TTFB median/p90 and any PageSpeed Insights results. ' +
        'Fixing a slow template fixes every page that uses it.',
      inputSchema: { crawl_id: crawlId, ...PaginationShape },
      outputSchema: {
        items: z.array(TemplateSchema),
        total: z.number().int(),
        offset: z.number().int(),
        limit: z.number().int(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    safe(({ crawl_id, limit, offset }) => {
      const page = engine.speed.templates(crawl_id, { limit, offset });
      const text = page.items.length
        ? `${page.total} template(s):\n${page.items.map(describeTemplate).join('\n')}${more(page)}\n\nUse measure_templates to run Lighthouse on their representatives.`
        : 'No templates (no 200 HTML pages).';
      return toolResult(page, text);
    }),
  );

  server.registerTool(
    'measure_templates',
    {
      title: 'Measure templates with PageSpeed Insights',
      description:
        'Run Lighthouse via the PageSpeed Insights API on 1–2 representative pages of the ' +
        'largest templates (or the given template_ids), instead of every page. Returns lab ' +
        'metrics (score, LCP, CLS, TBT, FCP, page weight) and real-user CrUX data when ' +
        'available. Results are stored; repeat calls reuse them unless force=true. Takes ' +
        '10–30 s per page; set PSI_API_KEY on the server for a higher quota.',
      inputSchema: {
        crawl_id: crawlId,
        strategy: z.enum(['mobile', 'desktop']).default('mobile'),
        template_ids: z.array(z.number().int()).optional(),
        max_templates: z.number().int().min(1).max(20).default(5),
        per_template: z.number().int().min(1).max(2).default(1),
        force: z.boolean().default(false),
      },
      outputSchema: {
        results: z.array(z.object({ template: TemplateSchema, insight: z.string() })),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safe(
      async ({ crawl_id, strategy, template_ids, max_templates, per_template, force }, extra) => {
        const results = await engine.speed.measure(crawl_id, {
          strategy,
          templateIds: template_ids,
          maxTemplates: max_templates,
          perTemplate: per_template,
          force,
          signal: extra.signal,
          onProgress: measureProgress(extra),
        });
        return toolResult({ results }, results.map((r) => `- ${r.insight}`).join('\n'));
      },
    ),
  );
}
