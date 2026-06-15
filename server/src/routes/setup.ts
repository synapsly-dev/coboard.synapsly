import type { FastifyPluginAsync } from 'fastify';
import {
  setupInputSchema,
  type AuthUserResponse,
  type SetupStatusResponse,
} from 'shared';
import { SESSION_COOKIE, sessionCookieOptions } from '../auth/session.js';
import { parseBody } from '../lib/validate.js';
import { setupFirstAdmin } from '../services/authService.js';
import { countUsers, serializeUser } from '../services/userService.js';

/**
 * First-run setup routes (§7, §8): GET /setup/status reports whether the
 * instance still needs its first admin; POST /setup creates that admin (only
 * while no users exist) and logs the browser in by setting the session cookie.
 */
const setupRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/setup/status', async (): Promise<SetupStatusResponse> => {
    const total = await countUsers(fastify.db);
    return { needsSetup: total === 0 };
  });

  fastify.post('/setup', async (request, reply): Promise<AuthUserResponse> => {
    const input = parseBody(setupInputSchema, request.body);
    const { user, session } = await setupFirstAdmin(fastify.db, input);

    reply.setCookie(
      SESSION_COOKIE,
      session.token,
      sessionCookieOptions({
        expiresAt: session.expiresAt,
        production: fastify.isProduction,
      }),
    );

    reply.code(201);
    return { user: serializeUser(user) };
  });
};

export default setupRoutes;
