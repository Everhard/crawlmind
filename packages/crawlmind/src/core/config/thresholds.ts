/** Thresholds used by the issue checks. */
export const THRESHOLDS = {
  /** Pages with fewer words of main content are "thin". Overridable per crawl. */
  thinContentWords: 200,
  /** Click depth above this is "deep". */
  deepPageDepth: 3,
  slowTtfbMs: 800,
  largeHtmlBytes: 1024 * 1024,
  /** Examples kept per issue in summaries. */
  summaryExamples: 5,
} as const;
