import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    'core/index': 'src/core/index.ts',
    'mcp/index': 'src/mcp/index.ts',
  },
  format: 'esm',
  target: 'node22',
  platform: 'node',
  dts: { entry: { 'core/index': 'src/core/index.ts', 'mcp/index': 'src/mcp/index.ts' } },
  sourcemap: true,
  clean: true,
  splitting: true,
});
