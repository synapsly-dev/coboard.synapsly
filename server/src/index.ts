import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildApp } from './app.js';
import { createDb, resolveDatabaseUrl } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { maybeSeed } from './db/seed.js';

/**
 * Production entrypoint (§9). Resolves config from env, opens the database, runs
 * migrations, optionally seeds demo data, builds the Fastify app (serving the SPA
 * from web/dist), and listens on PORT. Wires graceful shutdown.
 */

const here = dirname(fileURLToPath(import.meta.url));
/** server/dist -> web/dist (sibling packages at the workspace root in the image). */
const WEB_DIST = resolve(here, '../../web/dist');

function readConfig(): {
  databaseUrl: string;
  sessionSecret: string;
  port: number;
  production: boolean;
  seed: boolean;
} {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 16) {
    throw new Error('SESSION_SECRET 未配置或过短（至少 16 字符），请在 .env 中设置');
  }
  return {
    databaseUrl: resolveDatabaseUrl(),
    sessionSecret,
    port: Number.parseInt(process.env.PORT ?? '3000', 10),
    production: process.env.NODE_ENV === 'production',
    seed: process.env.SEED_DEMO === 'true',
  };
}

async function main(): Promise<void> {
  const config = readConfig();
  const { db, close } = createDb(config.databaseUrl);

  // Migrate-on-start so a fresh container is immediately usable (§9).
  await runMigrations(db);
  if (config.seed) {
    await maybeSeed(db);
  }

  const app = await buildApp({
    db,
    sessionSecret: config.sessionSecret,
    production: config.production,
    webDistPath: WEB_DIST,
    logger: true,
  });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`收到 ${signal}，正在关闭...`);
    try {
      await app.close();
      await close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: config.port });
  app.log.info(`Coboard 已启动，监听端口 ${config.port}`);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[boot] 启动失败:', err);
  process.exit(1);
});
