# How it works

[← Back to README](../README.md)

How Crawlmind crawls a site and computes its results.

- [Crawling rules](#crawling-rules)
- [Link graph](#link-graph)
- [Internal link suggestions](#internal-link-suggestions)
- [Cannibalization](#cannibalization)
- [The embedding model](#the-embedding-model)
- [Crawl diffs](#crawl-diffs)
- [Reports](#reports)

## Crawling rules

- Identifies itself as `CrawlmindBot/<version> (+https://github.com/Everhard/crawlmind)`.
- Follows robots.txt, including `Crawl-delay` (capped at 10 s), unless told not to.
- One site per crawl (optionally with subdomains).
- Defaults: 1,000 pages (`0` means no limit), depth 10, 4 parallel requests, 250 ms between
  requests to the same host, 15 s timeout, 5 MB per page.
- Only `text/html` is parsed. Sitemaps (from robots.txt and `/sitemap.xml`, indexes and gzip
  included) add URLs that links do not reach.
- Refuses private, loopback and link-local addresses, checked on every connection and redirect
  hop (DNS rebinding included). For intranet or local sites use `--allow-private` in the CLI.
  MCP clients may only set `allowPrivateNetworks` when the server runs with
  `CRAWLMIND_ALLOW_PRIVATE_NETWORKS=1`, so a prompt injection on a crawled page cannot turn the
  AI client into a local network scanner.

## Link graph

Inlinks and outlinks are counted per page and by placement (nav, header, footer, main, other),
with links through redirects credited to the final page. Click depth is a breadth-first search
from the start URL. Internal PageRank uses damping 0.85, spreads the rank of pages without
outlinks evenly, ignores `nofollow`, and iterates until the total change is below 1e-6;
scores are shown 0–100 relative to the strongest page.

## Internal link suggestions

Crawlmind embeds every indexable page (title, H1 and the start of the main content) with a
local model and looks for pages that are about the same topic as a target but do not link to it
yet. For each pair it returns:

- the **paragraph** of the source page that fits the target best (paragraphs of the main
  content are embedded separately),
- **anchor candidates**: phrases from that paragraph that share key words with the target's
  title and H1, matched by word prefixes so inflected forms count (`беговые кроссовки` for
  "Лучшие беговые кроссовки"),
- the similarity and the target's content inlinks and PageRank.

Without a target, the most link-worthy pages come first: rank =
`similarity × (1 + importance / (1 + content inlinks))`, where importance is the larger of the
page's relative PageRank and its sitemap priority. Crawlmind never writes the final sentence;
your AI client does, from this context. No API keys are involved.

Page vectors are stored per crawl; paragraph vectors are computed only for pages that appear in
suggestions.

## Cannibalization

Pairs of indexable pages whose embeddings are at least 0.92 similar and whose title/H1 key words
overlap by at least 50%.

## The embedding model

The model runs locally with [transformers.js](https://huggingface.co/docs/transformers.js).
Its ONNX runtime is several hundred megabytes, so it is an optional add-on and everything else
works without it. Crawlmind looks for transformers.js next to itself (an optional peer
dependency) and then in `~/.crawlmind/addons`, which is where `crawlmind addon install`, the
`install_embeddings` MCP tool and the install prompt put it, using `npm install` with a fixed
package name and version range. The model is downloaded once (about 120 MB) into
`~/.crawlmind/models`.

[`Xenova/multilingual-e5-small`](https://huggingface.co/Xenova/multilingual-e5-small)
(8-bit quantized, 384 dimensions) covers about 100 languages, which matters for sites that are
not in English, and is strong at retrieval for its size: it is the smallest of the e5 family
that clearly beats older multilingual MiniLM models on retrieval benchmarks, while still
embedding hundreds of pages per minute on a laptop CPU. Its cosine similarities cluster high,
so the default thresholds (0.82 for suggestions, 0.92 for cannibalization) are tuned for it.

## Crawl diffs

Crawls are kept, so any two crawls of a site can be compared (`compare_crawls`,
`crawlmind diff`): new and fixed 4xx/5xx pages, new and fixed broken links, pages added and
removed, the pages that gained or lost the most inlinks, TTFB regressions (at least 200 ms and
50% slower), title and canonical changes, and how each issue count moved. A warning is added
when the crawls differ much in size, since "removed" pages may just not have been reached.

## Reports

Reports (`export_report`, `crawlmind report`) contain the summary, every issue with up to ten
examples and its fix, under-linked important pages, and the strongest and slowest pages. The
HTML version is a single file with inline CSS, no scripts, light and dark themes, and works on
phones.

A report never replaces an existing file unless asked to, and never writes through a symbolic
link. MCP clients write only inside `~/.crawlmind/reports` unless the server runs with
`CRAWLMIND_ALLOW_REPORT_PATHS=1`, so instructions hidden in a crawled page cannot make the AI
client overwrite your files.
