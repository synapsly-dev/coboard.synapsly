import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { Database } from '../src/db/index.js';
import type { AuthRuntime } from '../src/auth/config.js';
import { RealtimeBus } from '../src/realtime/bus.js';
import * as schema from '../src/db/schema.js';

/**
 * Test harness (§10). Spins up an in-memory PGlite Postgres, applies the
 * generated Drizzle migrations, and builds a Fastify app instance for
 * `fastify.inject`. Returns the db + bus so tests can seed/assert directly.
 */

const here = dirname(fileURLToPath(import.meta.url));
/** server/test -> server/drizzle */
const MIGRATIONS_FOLDER = resolve(here, '../drizzle');

export interface TestContext {
  app: FastifyInstance;
  db: Database;
  bus: RealtimeBus;
  pglite: PGlite;
  cleanup: () => Promise<void>;
}

interface MigrationJournal {
  entries: { idx: number; tag: string }[];
}

/**
 * Apply generated SQL migrations to a PGlite instance. Drizzle's pglite migrator
 * is not always in lockstep with kit output, so we replay the journal directly —
 * splitting on the drizzle statement-breakpoint marker.
 */
async function applyMigrations(pglite: PGlite): Promise<void> {
  const journalPath = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    throw new Error(
      `未找到迁移文件 (${journalPath})。请先运行 \`pnpm db:generate\`。`,
    );
  }
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as MigrationJournal;
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);

  for (const entry of ordered) {
    const sqlPath = join(MIGRATIONS_FOLDER, `${entry.tag}.sql`);
    const raw = await readFile(sqlPath, 'utf8');
    const statements = raw
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      await pglite.exec(statement);
    }
  }
}

/** Default auth runtime for tests: SSO disabled, dev-login off, no admins. */
const DEFAULT_TEST_AUTH_RUNTIME: AuthRuntime = {
  synapsly: null,
  adminEmails: [],
  devLogin: false,
  publicUrl: 'http://localhost',
};

/** Build an isolated test context with a fresh in-memory database. */
export async function createTestContext(opts?: {
  authRuntime?: Partial<AuthRuntime>;
}): Promise<TestContext> {
  const pglite = new PGlite();
  await applyMigrations(pglite);

  // The pglite drizzle driver is structurally compatible with the query surface
  // the app uses; cast to the shared Database type used by routes/services.
  const db = drizzle(pglite, { schema }) as unknown as Database;
  const bus = new RealtimeBus();

  const app = await buildApp({
    db,
    sessionSecret: 'test-secret-please-ignore-1234567890',
    production: false,
    realtimeBus: bus,
    authRuntime: { ...DEFAULT_TEST_AUTH_RUNTIME, ...opts?.authRuntime },
    logger: false,
    // Vitest cannot use autoload's native dynamic import of source modules.
    routeLoader: 'explicit',
  });
  await app.ready();

  return {
    app,
    db,
    bus,
    pglite,
    cleanup: async () => {
      await app.close();
      await pglite.close();
    },
  };
}
