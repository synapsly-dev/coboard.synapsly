import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Prod-parity migration guard. The real drizzle migrator (pg-core `dialect.migrate`)
 * wraps ALL pending migrations in a SINGLE transaction. The shared test harness
 * (helpers.ts `applyMigrations`) instead exec()s each statement in autocommit, so it
 * cannot surface a Postgres "unsafe use of new value" error — an enum value added via
 * `ALTER TYPE ... ADD VALUE` and then used by a later migration within the same batch.
 *
 * That exact gap took prod down on 2026-07-13 (0022 added `org_node_kind` value
 * 'track', 0023 cast to it — fine under per-statement autocommit, fatal in one
 * transaction). This test replays every migration inside one transaction so the class
 * of bug fails loudly here instead of on a fresh/jumped deploy. See the
 * drizzle-enum-migration-pitfall note for the fix pattern (recreate the enum type).
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(here, '../drizzle');

interface MigrationJournal {
  entries: { idx: number; tag: string }[];
}

async function orderedTags(): Promise<string[]> {
  const journalPath = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as MigrationJournal;
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);
}

async function statementsFor(tag: string): Promise<string[]> {
  const raw = await readFile(join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
  return raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

let pglite: PGlite | undefined;

afterEach(async () => {
  if (pglite) {
    await pglite.close();
    pglite = undefined;
  }
});

describe('migrations apply inside a single transaction (prod parity)', () => {
  it('replays every migration in one transaction without a Postgres error', async () => {
    pglite = new PGlite();
    const tags = await orderedTags();
    const statements: string[] = [];
    for (const tag of tags) statements.push(...(await statementsFor(tag)));

    await pglite.exec('BEGIN');
    try {
      for (const statement of statements) {
        await pglite.exec(statement);
      }
      await pglite.exec('COMMIT');
    } catch (err) {
      await pglite.exec('ROLLBACK');
      throw err;
    }

    // Sanity: the 'track' enum value the incident hinged on is present + usable.
    const res = await pglite.query<{ labels: string }>(
      `SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) AS labels
         FROM pg_enum WHERE enumtypid = 'org_node_kind'::regtype`,
    );
    expect(res.rows[0]?.labels).toContain('track');
  });
});
