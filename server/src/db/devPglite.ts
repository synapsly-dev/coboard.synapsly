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

interface MigrationJournal {
  entries: { idx: number; tag: string }[];
}

async function applyMigrations(pglite: PGlite): Promise<void> {
  const journal = JSON.parse(
    await readFile(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
  ) as MigrationJournal;

  for (const entry of [...journal.entries].sort((a, b) => a.idx - b.idx)) {
    const raw = await readFile(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8');
    const statements = raw
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await pglite.exec(statement);
    }
  }
}

export async function createDevPgliteDb(): Promise<DbHandle> {
  const freshDb = !existsSync(DEV_DB_DIR);
  await mkdir(dirname(DEV_DB_DIR), { recursive: true });

  const pglite = new PGlite(DEV_DB_DIR);
  if (freshDb) {
    await applyMigrations(pglite);
  }

  return {
    db: drizzle(pglite, { schema }) as unknown as DbHandle['db'],
    close: async () => {
      await pglite.close();
    },
  };
}
