import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * Vite config (§3, §9).
 * - React plugin for fast refresh + JSX.
 * - Dev server proxies `/api` to the Fastify backend on :3000 so the SPA and API
 *   share an origin (cookies, SSE) during development.
 * - Production build emits to `dist/`, served statically by the server (§9).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // SSE endpoint must not be buffered by the proxy.
        ws: false,
      },
      // 竞品分析看板子应用:走 :3000 的 Fastify 反代(带 requireAuth),
      // 而非直连 8916,使 dev 与生产的鉴权行为一致。
      '/apps': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
