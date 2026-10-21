// Usage: npm run version:sync -- 0.2.0
// Sets the same version on both packages and server.json, and pins crawlmind-mcp to it.
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? '')) {
  console.error('Usage: npm run version:sync -- <semver>');
  process.exit(1);
}

for (const name of ['crawlmind', 'crawlmind-mcp']) {
  const file = new URL(`../packages/${name}/package.json`, import.meta.url);
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  pkg.version = version;
  if (pkg.dependencies?.crawlmind) pkg.dependencies.crawlmind = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}
const serverFile = new URL('../server.json', import.meta.url);
const server = JSON.parse(readFileSync(serverFile, 'utf8'));
server.version = version;
for (const pkg of server.packages ?? []) pkg.version = version;
writeFileSync(serverFile, `${JSON.stringify(server, null, 2)}\n`);

console.log(
  `Both packages and server.json set to ${version}. Run npm install to refresh the lockfile.`,
);
