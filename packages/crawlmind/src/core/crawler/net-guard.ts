import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { CrawlmindError } from '../errors.js';

/**
 * SSRF protection. Every connection the crawler opens goes through `guardedLookup`, so the
 * IP check happens on the address actually used, for every redirect hop, which also defeats
 * DNS rebinding.
 */
const blocked = new BlockList();
// IPv4
blocked.addSubnet('0.0.0.0', 8, 'ipv4'); // "this" network
blocked.addSubnet('10.0.0.0', 8, 'ipv4'); // private
blocked.addSubnet('100.64.0.0', 10, 'ipv4'); // carrier-grade NAT
blocked.addSubnet('127.0.0.0', 8, 'ipv4'); // loopback
blocked.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local (incl. cloud metadata)
blocked.addSubnet('172.16.0.0', 12, 'ipv4'); // private
blocked.addSubnet('192.0.0.0', 24, 'ipv4'); // IETF protocol assignments
blocked.addSubnet('192.168.0.0', 16, 'ipv4'); // private
blocked.addSubnet('198.18.0.0', 15, 'ipv4'); // benchmarking
blocked.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
blocked.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved + broadcast
// IPv6
blocked.addAddress('::', 'ipv6'); // unspecified
blocked.addAddress('::1', 'ipv6'); // loopback
blocked.addSubnet('fc00::', 7, 'ipv6'); // unique local
blocked.addSubnet('fe80::', 10, 'ipv6'); // link-local
blocked.addSubnet('ff00::', 8, 'ipv6'); // multicast
blocked.addSubnet('64:ff9b:1::', 48, 'ipv6'); // local-use NAT64

/** True if `ip` is loopback, private, link-local or otherwise not publicly routable. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible forms hide an IPv4 address.
    const mapped = /^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped?.[1]) return blocked.check(mapped[1], 'ipv4');
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hexMapped?.[1] && hexMapped[2]) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return blocked.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, 'ipv4');
    }
    return blocked.check(lower, 'ipv6');
  }
  return false;
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
