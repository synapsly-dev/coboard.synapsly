import { inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import {
  isAdminRole,
  updateEmailNotificationSettingsInputSchema,
  updateRegistrationSettingsInputSchema,
  type EmailNotificationSettings,
  type RegistrationSettings,
} from 'shared';
import { users } from '../db/schema.js';
import { validationError } from '../lib/errors.js';
import { requireAdmin } from '../lib/guards.js';
import { parseBody } from '../lib/validate.js';
import {
  getEmailNotificationSettings,
  getRegistrationSettings,
  updateEmailNotificationSettings,
  updateRegistrationSettings,
} from '../services/settingsService.js';

/**
 * Instance settings routes, admin-only (§8). GET /settings returns the
 * registration settings INCLUDING the secret invite code (admins only); PATCH
 * /settings persists a partial update. The code is never exposed on any public
 * endpoint — see GET /auth/registration for the public, code-free probe.
 *
 * /settings/email-notifications carries the 邮件提醒 config (master switch,
 * per-event toggles, due-soon lead days, admin recipient roster).
 */
const settingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/settings', async (request): Promise<RegistrationSettings> => {
    requireAdmin(request);
    return getRegistrationSettings(fastify.db);
  });

  fastify.patch('/settings', async (request): Promise<RegistrationSettings> => {
    requireAdmin(request);
    const input = parseBody(updateRegistrationSettingsInputSchema, request.body);
    return updateRegistrationSettings(fastify.db, input);
  });

  fastify.get(
    '/settings/email-notifications',
    async (request): Promise<EmailNotificationSettings> => {
      requireAdmin(request);
      return getEmailNotificationSettings(fastify.db);
    },
  );

  fastify.patch(
    '/settings/email-notifications',
    async (request): Promise<EmailNotificationSettings> => {
      requireAdmin(request);
      const input = parseBody(updateEmailNotificationSettingsInputSchema, request.body);

      // The admin roster may only name active admins — reject anything else so a
      // typo/stale id can't silently swallow the admin notifications.
      if (input.adminRecipientIds && input.adminRecipientIds.length > 0) {
        const rows = await fastify.db
          .select({ id: users.id, role: users.role, isActive: users.isActive })
          .from(users)
          .where(inArray(users.id, input.adminRecipientIds));
        const valid = new Set(
          rows.filter((u) => u.isActive && isAdminRole(u.role)).map((u) => u.id),
        );
        if (input.adminRecipientIds.some((id) => !valid.has(id))) {
          throw validationError('接收名单只能包含在职的管理员');
        }
      }

      return updateEmailNotificationSettings(fastify.db, input);
    },
  );
};

export default settingsRoutes;
