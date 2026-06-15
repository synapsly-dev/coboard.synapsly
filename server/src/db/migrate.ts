import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb, resolveDatabaseUrl, type Database } from './index.js';

/**
 * Apply pending SQL migrations. Used both at container start (entrypoint) and by
 * `pnpm db:migrate`. The migrations folder is generated offline by drizzle-kit
 * (`pnpm db:generate`) into ../../drizzle relative to this file.
 */

const here = dirname(fileURLToPath(import.meta.url));
/** server/src/db -> server/drizzle */
export const MIGRATIONS_FOLDER = resolve(here, '../../drizzle');

/** Run migrations against an already-constructed drizzle db (used in tests too). */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Connect using DATABASE_URL, migrate, then close the connection. */
export async function migrateFromEnv(): Promise<void> {
  const { db, close } = createDb(resolveDatabaseUrl());
  try {
    await runMigrations(db);
    // eslint-disable-next-line no-console
    console.log('[migrate] 数据库迁移已应用');
  } finally {
    await close();
  }
}

// Allow `tsx src/db/migrate.ts` / `node dist/db/migrate.js` to run standalone.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  migrateFromEnv()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[migrate] 迁移失败:', err);
      process.exit(1);
    });
}
