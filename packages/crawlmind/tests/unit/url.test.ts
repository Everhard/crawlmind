import { describe, expect, it } from 'vitest';
import { isInternalUrl, isNonHttpHref, normalizeUrl } from '../../src/core/crawler/url.js';

describe('normalizeUrl', () => {
  it.each([
    ['HTTPS://Example.COM:443/Path?b=2&a=1#frag', 'https://example.com/Path?b=2&a=1'],
    ['http://example.com:80/', 'http://example.com/'],
    ['http://example.com:8080/x', 'http://example.com:8080/x'],
    ['https://example.com/?utm_source=x&utm_medium=y', 'https://example.com/'],
    ['https://example.com/p?id=7&gclid=abc&fbclid=def', 'https://example.com/p?id=7'],
    ['https://user:pass@example.com/', 'https://example.com/'],
    ['https://example.com/a?', 'https://example.com/a'],
    ['https://пример.рф/', 'https://xn--e1afmkfd.xn--p1ai/'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it('resolves relative URLs against a base', () => {
    expect(normalizeUrl('../b?x=1#y', 'https://example.com/a/c/')).toBe(
      'https://example.com/a/b?x=1',
    );
    expect(normalizeUrl('//cdn.example.com/x', 'https://example.com/')).toBe(
      'https://cdn.example.com/x',
    );
  });

  it.each([
    'mailto:a@b.c',
    'tel:+123',
    'javascript:void(0)',
    'data:text/html,hi',
    'ftp://x/y',
    'not a url',
  ])('rejects %s', (input) => {
    expect(normalizeUrl(input)).toBeNull();
  });
});

describe('isInternalUrl', () => {
  it('treats www and bare domain as the same site', () => {
    expect(isInternalUrl('https://www.example.com/a', 'example.com', false)).toBe(true);
    expect(isInternalUrl('https://example.com/a', 'www.example.com', false)).toBe(true);
  });

  it('includes subdomains only when asked', () => {
    expect(isInternalUrl('https://blog.example.com/', 'example.com', false)).toBe(false);
    expect(isInternalUrl('https://blog.example.com/', 'example.com', true)).toBe(true);
    expect(isInternalUrl('https://notexample.com/', 'example.com', true)).toBe(false);
  });
});

describe('isNonHttpHref', () => {
  it('detects non-crawlable schemes', () => {
    expect(isNonHttpHref(' JavaScript:alert(1)')).toBe(true);
    expect(isNonHttpHref('/path')).toBe(false);
  });
});
