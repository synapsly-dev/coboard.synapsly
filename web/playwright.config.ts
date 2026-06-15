import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config (§10) for the core happy-path e2e smoke
 * (setup → 登录 → 建任务 → 认领 → 完成 → 统计). The e2e feature agent owns the
 * specs under `e2e/`; this config provides the runner defaults.
 *
 * Assumes the full app (server serving web/dist, or `pnpm dev`) is reachable at
 * BASE_URL. CI can override BASE_URL; locally it defaults to the Vite dev server.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
