import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

/**
 * Database access layer. Production uses postgres.js; tests inject a
 * PGlite-backed drizzle instance via a different driver (see test/helpers.ts).
 * Routes/services only ever depend on the `Database` type so either driver works.
 */

export type Schema = typeof schema;

/**
 * The drizzle database type used across the app. We widen to the postgres-js
 * flavour because that is the production driver; the PGlite driver in tests is
 * structurally compatible for the query surface we use.
 */
export type Database = PostgresJsDatabase<Schema>;

/** Holds the underlying sql client so it can be closed on shutdown. */
export interface DbHandle {
  db: Database;
  close: () => Promise<void>;
}

/**
 * Build a production database handle from a connection string. The postgres.js
 * client is configured conservatively for a single-instance deployment.
 */
export function createDb(connectionString: string): DbHandle {
  const client = postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
    // We surface our own errors; let postgres throw on query failure.
    onnotice: () => {},
  });
  const db = drizzlePostgres(client, { schema });
  return {
    db,
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}

/**
 * Resolve the connection string from the environment. Throws early with a clear
 * message so misconfiguration fails fast at boot rather than at first query.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url || url.trim().length === 0) {
    throw new Error('DATABASE_URL 未配置：请在 .env 中设置 Postgres 连接串');
  }
  return url;
}

export { schema };
