/**
 * Lightweight, language-agnostic text helpers for anchor suggestions and title comparison.
 * "Stems" are lowercase word prefixes: crude, but they match inflected forms in Slavic and
 * Romance languages well enough for picking anchor candidates.
 */

const STOPWORDS = new Set(
  [
    // en
    'a an and are as at be by for from has have how in is it its of on or that the this to was what when where which who why with you your our we can will not',
    'about into over under after before than then there their them they these those also more most very just only some any all each such if so do does did been being were would could should may might must out up down off via per he she his her my me us between through without within across against among while because using use new other own same both',
    // ru
    'и в во на не что как а но по к ко из за от до для о об это так же ли бы то ваш наш мы вы они он она оно при без или уже',
    // uk
    'і й та в у на не що як але по до з із за від для про це так же чи би ваш наш ми ви вони він вона воно при без або вже',
    // de
    'der die das und ist in zu den von mit für auf ein eine einen nicht im dem des sich wie',
    // fr
    'le la les et de des du un une en est pour que qui dans sur par au aux pas plus',
    // es
    'el la los las y de del un una en es por para que con no se al lo como más',
    // pl
    'i w na nie że jak ale po do z ze za od dla o to tak czy',
  ]
    .join(' ')
    .split(/\s+/),
);

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;

export interface WordToken {
  text: string;
  lower: string;
  start: number;
  end: number;
}

export function words(text: string): WordToken[] {
  return [...text.matchAll(WORD)].map((m) => ({
    text: m[0],
    lower: m[0].toLowerCase(),
    start: m.index,
    end: m.index + m[0].length,
  }));
}

export const isStopword = (word: string) => STOPWORDS.has(word.toLowerCase());

export function stem(word: string): string {
  const lower = word.toLowerCase();
  return lower.length > 5 ? lower.slice(0, 5) : lower;
}

/** Stems of the meaningful words in `text`. */
export function keyStems(text: string): Set<string> {
  return new Set(
    words(text)
      .filter((w) => w.lower.length >= 3 && !isStopword(w.lower))
      .map((w) => stem(w.lower)),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Phrases (1–5 words) from `paragraph` that share key words with the target's title and H1,
 * best first. Phrases never start or end with a stopword and are taken verbatim from the text.
 */
export function anchorCandidates(paragraph: string, targetText: string, max = 3): string[] {
  const targetStems = keyStems(targetText);
  if (targetStems.size === 0) return [];
  const tokens = words(paragraph);
  const scored: { phrase: string; score: number }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let n = 1; n <= 5 && i + n <= tokens.length; n++) {
      const span = tokens.slice(i, i + n);
      const first = span[0] as WordToken;
      const last = span[n - 1] as WordToken;
      if (isStopword(first.lower) || isStopword(last.lower)) continue;
      const matched = span.filter(
        (w) => w.lower.length >= 3 && targetStems.has(stem(w.lower)),
      ).length;
      if (matched === 0) continue;
      // A lone short word ("API", "tool") rarely makes a descriptive anchor.
      if (n === 1 && first.lower.length < 5) continue;
      // Reward covering the target's key words; penalize filler words in the phrase.
      const score = matched / targetStems.size + matched / n;
      scored.push({ phrase: paragraph.slice(first.start, last.end), score });
    }
  }
  scored.sort((a, b) => b.score - a.score || b.phrase.length - a.phrase.length);
  const out: string[] = [];
  for (const { phrase } of scored) {
    const lower = phrase.toLowerCase();
    if (out.some((p) => p.toLowerCase().includes(lower) || lower.includes(p.toLowerCase())))
      continue;
    out.push(phrase);
    if (out.length >= max) break;
  }
  return out;
}

/** Shorten a paragraph around its first anchor candidate. */
export function excerptAround(paragraph: string, phrase: string | undefined, max = 280): string {
  if (paragraph.length <= max) return paragraph;
  const at = phrase ? paragraph.toLowerCase().indexOf(phrase.toLowerCase()) : 0;
  const start = Math.max(0, Math.min(at - Math.floor(max / 3), paragraph.length - max));
  const body = paragraph.slice(start, start + max).trim();
  return `${start > 0 ? '…' : ''}${body}${start + max < paragraph.length ? '…' : ''}`;
}
