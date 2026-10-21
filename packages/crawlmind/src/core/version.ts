import pkg from '../../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;
export const USER_AGENT = `CrawlmindBot/${VERSION} (+https://github.com/Everhard/crawlmind)`;
