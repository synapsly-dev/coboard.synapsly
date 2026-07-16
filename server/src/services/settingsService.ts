import { eq, inArray, sql } from 'drizzle-orm';
import {
  emailNotificationSettingsSchema,
  type EmailNotificationSettings,
  type RegistrationSettings,
  type UpdateEmailNotificationSettingsInput,
  type UpdateRegistrationSettingsInput,
} from 'shared';
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
export async function getRegistrationSettings(db: Database): Promise<RegistrationSettings> {
  const rows = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, [REGISTRATION_ENABLED_KEY, REGISTRATION_CODE_KEY]));

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
async function setSetting(db: Database, key: string, value: string): Promise<void> {
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
    await setSetting(db, REGISTRATION_ENABLED_KEY, partial.registrationEnabled ? 'true' : 'false');
  }
  if (partial.registrationCode !== undefined) {
    await setSetting(db, REGISTRATION_CODE_KEY, partial.registrationCode);
  }
  return getRegistrationSettings(db);
}

// ---------------------------------------------------------------------------
// Email notification settings (邮件提醒) — one JSON value under a single key.
// ---------------------------------------------------------------------------

const EMAIL_NOTIFICATIONS_KEY = 'email_notifications';

/** Master switch defaults OFF so a fresh deploy never emails until an admin opts in. */
export const DEFAULT_EMAIL_NOTIFICATION_SETTINGS: EmailNotificationSettings = {
  enabled: false,
  events: {
    taskAssigned: true,
    taskDueSoon: true,
    taskSubmitted: true,
    taskRejected: true,
    adminReviewNeeded: true,
  },
  dueSoonDays: 1,
  adminRecipientIds: [],
};

/**
 * Read the email notification settings. The stored JSON is validated and
 * merged over the defaults so settings written by an older build (fewer event
 * keys) stay readable after upgrades; garbage falls back to the defaults.
 */
export async function getEmailNotificationSettings(
  db: Database,
): Promise<EmailNotificationSettings> {
  const rows = await db.select().from(settings).where(eq(settings.key, EMAIL_NOTIFICATIONS_KEY));
  const raw = rows[0]?.value;
  if (!raw) return DEFAULT_EMAIL_NOTIFICATION_SETTINGS;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_EMAIL_NOTIFICATION_SETTINGS;
  }
  const merged = {
    ...DEFAULT_EMAIL_NOTIFICATION_SETTINGS,
    ...(typeof parsed === 'object' && parsed !== null ? parsed : {}),
    events: {
      ...DEFAULT_EMAIL_NOTIFICATION_SETTINGS.events,
      ...(typeof parsed === 'object' && parsed !== null
        ? (parsed as { events?: object }).events
        : {}),
    },
  };
  const result = emailNotificationSettingsSchema.safeParse(merged);
  return result.success ? result.data : DEFAULT_EMAIL_NOTIFICATION_SETTINGS;
}

/**
 * Apply a partial update (deep-merging `events`) and return the full settings.
 * Recipient-id validation (must be active admins) is the route's concern.
 */
export async function updateEmailNotificationSettings(
  db: Database,
  partial: UpdateEmailNotificationSettingsInput,
): Promise<EmailNotificationSettings> {
  const current = await getEmailNotificationSettings(db);
  const next: EmailNotificationSettings = {
    enabled: partial.enabled ?? current.enabled,
    events: { ...current.events, ...partial.events },
    dueSoonDays: partial.dueSoonDays ?? current.dueSoonDays,
    adminRecipientIds: partial.adminRecipientIds ?? current.adminRecipientIds,
  };
  await setSetting(db, EMAIL_NOTIFICATIONS_KEY, JSON.stringify(next));
  return next;
}
