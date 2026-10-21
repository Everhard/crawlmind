import { describe, expect, it } from 'vitest';
import { anchorCandidates, excerptAround, keyStems } from '../../src/core/embeddings/text.js';

describe('anchorCandidates', () => {
  it('finds phrases that match the target title', () => {
    const paragraph = 'For long runs, good running shoes with cushioning prevent injuries.';
    const candidates = anchorCandidates(paragraph, 'Best running shoes');
    expect(candidates[0]).toBe('running shoes');
    expect(candidates.every((c) => /running|shoes/.test(c))).toBe(true);
  });

  it('matches inflected forms', () => {
    const paragraph = 'Мы подобрали беговые кроссовки для марафона и длинных тренировок.';
    expect(anchorCandidates(paragraph, 'Лучшие беговые кроссовки')[0]).toBe('беговые кроссовки');
  });

  it('never starts or ends a phrase with a stopword', () => {
    for (const phrase of anchorCandidates(
      'Read about the best shoes for the trail.',
      'Best trail shoes',
    )) {
      expect(phrase).not.toMatch(/^(the|for|about)\b|\b(the|for)$/i);
    }
  });

  it('returns nothing without shared words', () => {
    expect(anchorCandidates('Pasta needs eggs and cheese.', 'Running shoes')).toEqual([]);
  });
});

describe('keyStems', () => {
  it('drops stopwords and short words and stems the rest', () => {
    expect([...keyStems('The best running shoes of 2026')]).toEqual([
      'best',
      'runni',
      'shoes',
      '2026',
    ]);
  });
});

describe('excerptAround', () => {
  it('keeps short paragraphs and centers long ones on the phrase', () => {
    expect(excerptAround('short text', 'text')).toBe('short text');
    const long = `${'a '.repeat(300)}running shoes ${'b '.repeat(300)}`;
    const ex = excerptAround(long, 'running shoes', 100);
    expect(ex).toContain('running shoes');
    expect(ex.startsWith('…')).toBe(true);
    expect(ex.endsWith('…')).toBe(true);
  });
});
