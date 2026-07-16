import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMiniappScss, renderWebCss } from './render.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const outputs = [
  { path: resolve(repoRoot, 'web/src/generated/tokens.css'), content: renderWebCss() },
  { path: resolve(packageRoot, 'generated/_miniapp-tokens.scss'), content: renderMiniappScss() },
] as const;

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const stale: string[] = [];
  for (const output of outputs) {
    if (check) {
      const current = await readFile(output.path, 'utf8').catch(() => '');
      if (current !== output.content) stale.push(output.path);
      continue;
    }
    await mkdir(dirname(output.path), { recursive: true });
    await writeFile(output.path, output.content, 'utf8');
  }
  if (stale.length > 0) {
    throw new Error(
      `Design token outputs are stale:\n${stale.join('\n')}\nRun pnpm tokens:generate.`,
    );
  }
}

await main();
