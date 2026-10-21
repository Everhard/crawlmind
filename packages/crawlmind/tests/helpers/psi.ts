/** A trimmed PageSpeed Insights v5 response. */
export function psiFixture({ score = 0.75, lcp = 2100 }: { score?: number; lcp?: number } = {}) {
  return {
    lighthouseResult: {
      categories: { performance: { score } },
      audits: {
        'largest-contentful-paint': { numericValue: lcp },
        'cumulative-layout-shift': { numericValue: 0.12 },
        'total-blocking-time': { numericValue: 350 },
        'first-contentful-paint': { numericValue: 1800 },
        'total-byte-weight': { numericValue: 2_400_000 },
      },
    },
    loadingExperience: {
      overall_category: 'SLOW',
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3900 },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 15 },
        INTERACTION_TO_NEXT_PAINT: { percentile: 280 },
        FIRST_CONTENTFUL_PAINT_MS: { percentile: 2100 },
      },
    },
  };
}
