import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { DbHandle } from './index.js';
import * as schema from './schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(here, '../../drizzle');
const DEV_DB_DIR = resolve(here, '../../../.superpowers/dev-db');
const MIGRATION_TABLE = '_coboard_dev_migrations';
/**
 * Persistent PGlite databases created before the migration ledger was added were
 * initialized from the complete journal through this tag. Seed that known baseline
 * once, then every later migration is tracked normally.
 */
const LEGACY_BASELINE_TAG = '0023_jittery_frank_castle';

interface MigrationJournal {
  entries: { idx: number; tag: string }[];
}

async function loadJournal(): Promise<MigrationJournal['entries']> {
  const journalPath = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    throw new Error(`未找到迁移文件 (${journalPath})。请先运行 \`pnpm db:generate\`。`);
  }
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as MigrationJournal;
  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

async function readStatements(tag: string): Promise<string[]> {
  const raw = await readFile(join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
  return raw
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function ensureMigrationLedger(pglite: PGlite): Promise<void> {
  await pglite.exec(`
    CREATE TABLE IF NOT EXISTS "${MIGRATION_TABLE}" (
      "tag" text PRIMARY KEY,
      "applied_at" timestamp with time zone NOT NULL DEFAULT now()
    );
  `);
}

async function bootstrapLegacyDatabase(
  pglite: PGlite,
  entries: MigrationJournal['entries'],
): Promise<void> {
  const tracked = await pglite.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM "${MIGRATION_TABLE}";`,
  );
  if ((tracked.rows[0]?.count ?? 0) > 0) return;

  const existing = await pglite.query<{ exists: boolean }>(
    `SELECT to_regclass('public.users') IS NOT NULL AS exists;`,
  );
  if (!existing.rows[0]?.exists) return;

  const baseline = entries.find((entry) => entry.tag === LEGACY_BASELINE_TAG);
  if (!baseline) {
    throw new Error(`迁移日志缺少 PGlite 兼容基线 ${LEGACY_BASELINE_TAG}`);
  }

  await pglite.exec('BEGIN');
  try {
    for (const entry of entries.filter((candidate) => candidate.idx <= baseline.idx)) {
      await pglite.query(
        `INSERT INTO "${MIGRATION_TABLE}" ("tag") VALUES ($1) ON CONFLICT DO NOTHING;`,
        [entry.tag],
      );
    }
    await pglite.exec('COMMIT');
  } catch (error) {
    await pglite.exec('ROLLBACK');
    throw error;
  }
}

async function applyMigrations(pglite: PGlite): Promise<void> {
  const entries = await loadJournal();
  await ensureMigrationLedger(pglite);
  await bootstrapLegacyDatabase(pglite, entries);

  const applied = await pglite.query<{ tag: string }>(`SELECT "tag" FROM "${MIGRATION_TABLE}";`);
  const appliedTags = new Set(applied.rows.map((row) => row.tag));

  for (const entry of entries) {
    if (appliedTags.has(entry.tag)) continue;
    const statements = await readStatements(entry.tag);

    await pglite.exec('BEGIN');
    try {
      for (const statement of statements) {
        await pglite.exec(statement);
      }
      await pglite.query(`INSERT INTO "${MIGRATION_TABLE}" ("tag") VALUES ($1);`, [entry.tag]);
      await pglite.exec('COMMIT');
      // eslint-disable-next-line no-console
      console.log(`[pglite] 已应用迁移 ${entry.tag}`);
    } catch (error) {
      await pglite.exec('ROLLBACK');
      throw new Error(`PGlite 迁移失败：${entry.tag}`, { cause: error });
    }
  }
}

export async function createDevPgliteDb(): Promise<DbHandle> {
  await mkdir(dirname(DEV_DB_DIR), { recursive: true });

  const pglite = new PGlite(DEV_DB_DIR);
  // Unlike the original fresh-database-only bootstrap, keep the persistent local
  // database current without deleting developer data whenever a migration lands.
  await applyMigrations(pglite);

  return {
    db: drizzle(pglite, { schema }) as unknown as DbHandle['db'],
    close: async () => {
      await pglite.close();
    },
  };
}
