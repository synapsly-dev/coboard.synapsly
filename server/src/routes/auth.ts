import type { FastifyPluginAsync } from 'fastify';
import {
  changePasswordInputSchema,
  loginInputSchema,
  type AuthUserResponse,
} from 'shared';
import {
  SESSION_COOKIE,
  clearSessionCookieOptions,
  createSession,
  deleteSession,
  sessionCookieOptions,
} from '../auth/session.js';
import { requireAuth } from '../lib/guards.js';
import { parseBody } from '../lib/validate.js';
import { changeOwnPassword, login, reloadUser } from '../services/authService.js';
import { serializeUser } from '../services/userService.js';

/**
 * Auth routes (§7, §8): POST /auth/login (rate-limited; argon2 verify + session
 * cookie), POST /auth/logout (delete session + clear cookie), GET /auth/me
 * (current user or 401), POST /auth/password (rotate own password).
 */
const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    '/auth/login',
    {
      // Tighten the brute-force window for the login endpoint specifically (§8);
      // the global limiter is registered with `global: false`.
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply): Promise<AuthUserResponse> => {
      const input = parseBody(loginInputSchema, request.body);
      const { user, session } = await login(fastify.db, input);

      reply.setCookie(
        SESSION_COOKIE,
        session.token,
        sessionCookieOptions({
          expiresAt: session.expiresAt,
          production: fastify.isProduction,
        }),
      );

      return { user: serializeUser(user) };
    },
  );

  fastify.post('/auth/logout', async (request, reply): Promise<{ ok: true }> => {
    if (request.sessionToken) {
      await deleteSession(fastify.db, request.sessionToken);
    }
    reply.clearCookie(
      SESSION_COOKIE,
      clearSessionCookieOptions(fastify.isProduction),
    );
    return { ok: true };
  });

  fastify.get('/auth/me', async (request): Promise<AuthUserResponse> => {
    const user = requireAuth(request);
    return { user: serializeUser(user) };
  });

  fastify.post('/auth/password', async (request, reply): Promise<AuthUserResponse> => {
    const user = requireAuth(request);
    const input = parseBody(changePasswordInputSchema, request.body);
    await changeOwnPassword(fastify.db, user, input);

    // changeOwnPassword revoked all sessions (including this one); mint a fresh
    // session so the initiating device stays logged in.
    const session = await createSession(fastify.db, user.id);
    reply.setCookie(
      SESSION_COOKIE,
      session.token,
      sessionCookieOptions({
        expiresAt: session.expiresAt,
        production: fastify.isProduction,
      }),
    );

    const fresh = (await reloadUser(fastify.db, user.id)) ?? user;
    return { user: serializeUser(fresh) };
  });
};

export default authRoutes;
