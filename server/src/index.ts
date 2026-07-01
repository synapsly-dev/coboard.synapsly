import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildApp } from './app.js';
import { loadAuthRuntime } from './auth/config.js';
import { createDb, resolveDatabaseUrl, type DbHandle } from './db/index.js';
import { createDevPgliteDb } from './db/devPglite.js';
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
  databaseUrl: string | null;
  sessionSecret: string;
  port: number;
  production: boolean;
  publicUrl: string;
  seed: boolean;
} {
  const production = process.env.NODE_ENV === 'production';
  const sessionSecret = process.env.SESSION_SECRET ?? (
    production ? undefined : 'coboard-local-development-secret'
  );
  if (!sessionSecret || sessionSecret.length < 16) {
    throw new Error('SESSION_SECRET 未配置或过短（至少 16 字符），请在 .env 中设置');
  }
  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  return {
    databaseUrl: process.env.DATABASE_URL?.trim() ? resolveDatabaseUrl() : null,
    sessionSecret,
    port,
    production,
    publicUrl: process.env.PUBLIC_URL?.trim() || `http://localhost:${port}`,
    seed: process.env.SEED_DEMO === 'true',
  };
}

async function createDbHandle(config: {
  databaseUrl: string | null;
  production: boolean;
}): Promise<DbHandle> {
  if (config.databaseUrl) {
    return createDb(config.databaseUrl);
  }
  if (config.production) {
    throw new Error('DATABASE_URL 未配置：请在 .env 中设置 Postgres 连接串');
  }

  // Local development fallback: lets `pnpm dev` run without a separate Postgres.
  // Production and Docker deployments still require DATABASE_URL.
  return createDevPgliteDb();
}

async function main(): Promise<void> {
  const config = readConfig();
  const { db, close } = await createDbHandle(config);

  // Migrate-on-start so a fresh container is immediately usable (§9).
  if (config.databaseUrl) {
    await runMigrations(db);
  }
  if (config.seed) {
    await maybeSeed(db);
  }

  const authRuntime = loadAuthRuntime({
    production: config.production,
    publicUrl: config.publicUrl,
  });
  if (!authRuntime.synapsly) {
    // eslint-disable-next-line no-console
    console.warn(
      '[auth] 未配置 Synapsly SSO（缺少 SYNAPSLY_CLIENT_ID/SECRET）——' +
        (authRuntime.devLogin ? '仅开发假登录可用' : '将无法登录'),
    );
  }

  const app = await buildApp({
    db,
    sessionSecret: config.sessionSecret,
    production: config.production,
    authRuntime,
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
