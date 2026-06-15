import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config — drives `pnpm db:generate` (offline SQL migration generation)
 * and `pnpm db:migrate` (apply). The schema lives in the server package.
 *
 * Generation does NOT require a live database; only `migrate`/`push` connect.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/src/db/schema.ts',
  out: './server/drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://coboard:coboard@localhost:5432/coboard',
  },
  strict: true,
  verbose: true,
});
