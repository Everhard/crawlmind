import { describe, expect, it } from 'vitest';
import {
  assertPublicHost,
  ipv6Groups,
  isPrivateAddress,
} from '../../src/core/crawler/net-guard.js';
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
    '0:0:0:0:0:ffff:7f00:1',
    '0000:0000:0000:0000:0000:ffff:192.168.1.1',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    '64:ff9b::10.0.0.1',
    '64:ff9b:1::a9fe:a9fe',
    '2002:c0a8:0101::1',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    'fe80::1%eth0',
    'fec0::1',
  ])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:808:808::1',
    '2a00:1450:4001:82b::200e',
  ])('allows %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
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

describe('ipv6Groups', () => {
  it('expands compressed and dotted forms', () => {
    expect(ipv6Groups('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6Groups('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(ipv6Groups('2001:db8::8:800:200c:417a')).toEqual([
      0x2001, 0xdb8, 0, 0, 8, 0x800, 0x200c, 0x417a,
    ]);
  });

  it('rejects malformed input', () => {
    expect(ipv6Groups('1::2::3')).toBeNull();
    expect(ipv6Groups('1:2:3')).toBeNull();
  });
});
