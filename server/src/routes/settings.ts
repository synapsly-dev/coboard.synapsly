import type { FastifyPluginAsync } from 'fastify';
import {
  updateRegistrationSettingsInputSchema,
  type RegistrationSettings,
} from 'shared';
import { requireAdmin } from '../lib/guards.js';
import { parseBody } from '../lib/validate.js';
import {
  getRegistrationSettings,
  updateRegistrationSettings,
} from '../services/settingsService.js';

/**
 * Instance settings routes, admin-only (§8). GET /settings returns the
 * registration settings INCLUDING the secret invite code (admins only); PATCH
 * /settings persists a partial update. The code is never exposed on any public
 * endpoint — see GET /auth/registration for the public, code-free probe.
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
};

export default settingsRoutes;
