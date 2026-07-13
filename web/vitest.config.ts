import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vitest config (§10) for front-end component tests (React Testing Library on
 * jsdom). The board/stats feature agents add specs; the foundation only wires the
 * environment so `pnpm --filter web test` runs (passWithNoTests for now).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      shared: fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
