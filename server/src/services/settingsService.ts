import { inArray, sql } from 'drizzle-orm';
import type { RegistrationSettings, UpdateRegistrationSettingsInput } from 'shared';
import type { Database } from '../db/index.js';
import { settings } from '../db/schema.js';

/**
 * Settings domain service (§8). Typed getters/setters over the key/value
 * `settings` table. Self-registration is governed by two keys:
 *
 * - `registration_enabled` — `'true'` | `'false'`
 * - `registration_code`    — the shared invite code (secret; admin-only)
 *
 * Both keys default to OFF / empty when absent, so a fresh instance has
 * registration closed (§8 security rules).
 */

/** Persisted setting keys. */
const REGISTRATION_ENABLED_KEY = 'registration_enabled';
const REGISTRATION_CODE_KEY = 'registration_code';

const DEFAULT_REGISTRATION_SETTINGS: RegistrationSettings = {
  registrationEnabled: false,
  registrationCode: '',
};

/**
 * Read the registration settings, falling back to safe defaults
 * ({ registrationEnabled: false, registrationCode: '' }) for any absent key.
 */
export async function getRegistrationSettings(
  db: Database,
): Promise<RegistrationSettings> {
  const rows = await db
    .select()
    .from(settings)
    .where(
      inArray(settings.key, [REGISTRATION_ENABLED_KEY, REGISTRATION_CODE_KEY]),
    );

  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    registrationEnabled:
      map.get(REGISTRATION_ENABLED_KEY) === 'true'
        ? true
        : DEFAULT_REGISTRATION_SETTINGS.registrationEnabled,
    registrationCode:
      map.get(REGISTRATION_CODE_KEY) ?? DEFAULT_REGISTRATION_SETTINGS.registrationCode,
  };
}

/** Upsert a single setting key with the current timestamp. */
async function setSetting(
  db: Database,
  key: string,
  value: string,
): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: sql`now()` },
    });
}

/**
 * Apply a partial update to the registration settings and return the resulting
 * full settings. Only the provided fields are persisted.
 */
export async function updateRegistrationSettings(
  db: Database,
  partial: UpdateRegistrationSettingsInput,
): Promise<RegistrationSettings> {
  if (partial.registrationEnabled !== undefined) {
    await setSetting(
      db,
      REGISTRATION_ENABLED_KEY,
      partial.registrationEnabled ? 'true' : 'false',
    );
  }
  if (partial.registrationCode !== undefined) {
    await setSetting(db, REGISTRATION_CODE_KEY, partial.registrationCode);
  }
  return getRegistrationSettings(db);
}
