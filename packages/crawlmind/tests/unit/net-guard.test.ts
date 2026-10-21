import { describe, expect, it } from 'vitest';
import { assertPublicHost, isPrivateAddress } from '../../src/core/crawler/net-guard.js';
import { CrawlmindError } from '../../src/core/errors.js';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
  ])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    },
  );
});

describe('assertPublicHost', () => {
  it('rejects localhost names and private IP literals', () => {
    expect(() => assertPublicHost('localhost')).toThrow(CrawlmindError);
    expect(() => assertPublicHost('app.localhost')).toThrow(CrawlmindError);
    expect(() => assertPublicHost('[::1]')).toThrow(CrawlmindError);
    expect(() => assertPublicHost('192.168.0.10')).toThrow(/private or local network/);
  });

  it('accepts public hosts', () => {
    expect(() => assertPublicHost('example.com')).not.toThrow();
    expect(() => assertPublicHost('93.184.216.34')).not.toThrow();
  });
});
