import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * The server source uses NodeNext-style explicit `.js` extensions on relative
 * imports (required for the compiled ESM output). Vitest's resolver does not map
 * those `.js` specifiers back to their `.ts` source, so this plugin rewrites
 * relative `*.js` imports to the corresponding `*.ts` file when one exists.
 */
function resolveTsFromJs(): Plugin {
  return {
    name: 'resolve-ts-from-js',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer) return null;
      if (!source.startsWith('.')) return null;
      if (!source.endsWith('.js')) return null;
      const tsPath = resolve(dirname(importer), source.replace(/\.js$/, '.ts'));
      if (existsSync(tsPath)) return tsPath;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveTsFromJs()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // PGlite + argon2 startup can be slow on a cold run.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
