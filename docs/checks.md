# Audit checks

[← Back to README](../README.md)

Everything the technical SEO audit looks for.

Every issue has the same shape: `id`, `severity` (critical, warning, info), `title`, `count`,
up to five `examples` and a `recommendation`. MCP clients can read the full description of each
check (why it matters, how to fix) from the `crawlmind://checks/{id}` resource.

| Area      | Checks                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------ |
| Status    | 4xx and 5xx pages, unreachable pages                                                                   |
| Links     | broken internal and external links, links to redirects, internal `nofollow`, generic and empty anchors |
| Redirects | chains longer than one hop, loops                                                                      |
| Sitemap   | orphan pages, `noindex` pages listed, non-200 URLs listed                                              |
| Canonical | canonical to an error page, to a redirect, to a different page                                         |
| Content   | missing or duplicate titles, meta descriptions and H1, thin content (default < 200 words)              |
| Structure | pages more than 3 clicks deep                                                                          |
| Speed     | TTFB over 800 ms, HTML over 1 MB, mixed content                                                        |

Generic anchors ("click here", "read more", "подробнее", "mehr erfahren", …) are listed per
language in [`generic-anchors.ts`](../packages/crawlmind/src/core/config/generic-anchors.ts).
