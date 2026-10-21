// Copies the root README and LICENSE into the published `crawlmind` package.
import { copyFileSync } from 'node:fs';

copyFileSync(new URL('../README.md', import.meta.url), 'README.md');
copyFileSync(new URL('../LICENSE', import.meta.url), 'LICENSE');
