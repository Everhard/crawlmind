import type * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

/** Number of hash functions in a MinHash signature (and of 32-bit words in it). */
export const SIGNATURE_SIZE = 32;
/** How deep below <body> the structural skeleton goes. */
const SKELETON_DEPTH = 6;
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'br', 'wbr']);

const SEEDS = Array.from({ length: SIGNATURE_SIZE }, (_, i) => Math.imul(0x9e3779b1, i + 1) >>> 0);

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 32-bit finalizer from MurmurHash3: spreads `x ^ seed` into a well-mixed hash. */
function mix(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * The set of tag paths in the page skeleton (`body>div>header>nav`, …), ignoring text and
 * attributes, down to a fixed depth. Pages built from the same template share most paths.
 */
export function skeletonPaths($: cheerio.CheerioAPI): Set<string> {
  const paths = new Set<string>();
  const walk = (node: AnyNode, path: string, depth: number) => {
    if (depth > SKELETON_DEPTH) return;
    for (const child of (node as Element).children ?? []) {
      if (child.type !== 'tag') continue;
      const tag = (child as Element).tagName.toLowerCase();
      if (SKIP.has(tag)) continue;
      const childPath = `${path}>${tag}`;
      paths.add(childPath);
      walk(child, childPath, depth + 1);
    }
  };
  const body = $('body').get(0);
  if (body) walk(body, 'body', 1);
  return paths;
}

export function minHash(items: Iterable<string>): Uint32Array {
  const signature = new Uint32Array(SIGNATURE_SIZE).fill(0xffffffff);
  for (const item of items) {
    const base = fnv1a(item);
    for (let i = 0; i < SIGNATURE_SIZE; i++) {
      const h = mix(base ^ (SEEDS[i] as number));
      if (h < (signature[i] as number)) signature[i] = h;
    }
  }
  return signature;
}

/** Estimated Jaccard similarity of the two sets behind the signatures. */
export function signatureSimilarity(a: Uint32Array, b: Uint32Array): number {
  let same = 0;
  for (let i = 0; i < SIGNATURE_SIZE; i++) if (a[i] === b[i]) same++;
  return same / SIGNATURE_SIZE;
}

export function signatureToBuffer(signature: Uint32Array): Buffer {
  return Buffer.from(signature.buffer, signature.byteOffset, signature.byteLength);
}

export function bufferToSignature(buffer: Buffer): Uint32Array {
  const copy = new Uint8Array(buffer); // aligned copy
  return new Uint32Array(copy.buffer, 0, Math.floor(copy.byteLength / 4));
}
