import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { CrawlmindError } from '../errors.js';

/**
 * SSRF protection. Every connection the crawler opens goes through `guardedLookup`, so the
 * IP check happens on the address actually used, for every redirect hop, which also defeats
 * DNS rebinding.
 */
const blockedV4 = new BlockList();
blockedV4.addSubnet('0.0.0.0', 8, 'ipv4'); // "this" network
blockedV4.addSubnet('10.0.0.0', 8, 'ipv4'); // private
blockedV4.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT
blockedV4.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
blockedV4.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local (incl. cloud metadata)
blockedV4.addSubnet('172.16.0.0', 12, 'ipv4'); // private
blockedV4.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF protocol assignments
blockedV4.addSubnet('192.168.0.0', 16, 'ipv4'); // private
blockedV4.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmarking
blockedV4.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
blockedV4.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved + broadcast

const blockedV6 = new BlockList();
blockedV6.addSubnet('::', 128, 'ipv6'); // unspecified
blockedV6.addSubnet('::1', 128, 'ipv6'); // loopback
blockedV6.addSubnet('fc00::', 7, 'ipv6'); // unique local
blockedV6.addSubnet('fe80::', 10, 'ipv6'); // link-local
blockedV6.addSubnet('fec0::', 10, 'ipv6'); // deprecated site-local
blockedV6.addSubnet('ff00::', 8, 'ipv6'); // multicast
blockedV6.addSubnet('2001::', 32, 'ipv6'); // Teredo (embeds an obfuscated IPv4)
blockedV6.addSubnet('2001:db8::', 32, 'ipv6'); // documentation
blockedV6.addSubnet('64:ff9b:1::', 48, 'ipv6'); // local-use NAT64 (operator-defined embedding)

/** Expand an IPv6 address (any notation, incl. embedded dotted IPv4) to 8 16-bit groups. */
export function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0] ?? '';
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill('0'),
    ...tail,
  ].map((g) => Number.parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

function v4FromGroups(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/**
 * IPv4 addresses embedded at a fixed position by common transition mechanisms: IPv4-mapped
 * (::ffff:0:0/96), IPv4-compatible (::/96), well-known NAT64 (64:ff9b::/96) and 6to4 (2002::/16).
 */
function embeddedIPv4(g: number[]): string | null {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (zeroPrefix && g5 === 0xffff) return v4FromGroups(g6, g7);
  // In ::/96, `::` and `::1` are the IPv6 unspecified and loopback addresses, not IPv4.
  if (zeroPrefix && g5 === 0 && (g6 !== 0 || g7 > 1)) return v4FromGroups(g6, g7);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0)
    return v4FromGroups(g6, g7);
  if (g0 === 0x2002) return v4FromGroups(g1, g2);
  return null;
}

/** True if `ip` is loopback, private, link-local or otherwise not publicly routable. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blockedV4.check(ip, 'ipv4');
  if (family !== 6) return false;
  const groups = ipv6Groups(ip);
  if (!groups) return true; // unparseable: refuse rather than guess
  if (blockedV6.check(groups.map((g) => g.toString(16)).join(':'), 'ipv6')) return true;
  const v4 = embeddedIPv4(groups);
  return v4 !== null && blockedV4.check(v4, 'ipv4');
}

export function blockedAddressError(host: string, ip?: string): CrawlmindError {
  const where = ip && ip !== host ? `${host} (${ip})` : host;
  return new CrawlmindError(
    'blocked_address',
    `Refusing to connect to ${where}: private or local network address.`,
    'Set allowPrivateNetworks to crawl local or intranet sites.',
  );
}

/** Rejects hostnames that are literal private IPs (lookup is skipped for IP literals). */
export function assertPublicHost(hostname: string): void {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) throw blockedAddressError(host);
  if (isIP(host) && isPrivateAddress(host)) throw blockedAddressError(host);
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** Drop-in replacement for `dns.lookup` that fails on non-public addresses. */
export function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: LookupCallback,
): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const bad = addresses.find((a) => isPrivateAddress(a.address));
    if (bad)
      return callback(blockedAddressError(hostname, bad.address) as NodeJS.ErrnoException, []);
    if (options.all) return callback(null, addresses);
    const first = addresses[0];
    if (!first) return callback(new Error(`No address for ${hostname}`), []);
    callback(null, first.address, first.family);
  });
}
