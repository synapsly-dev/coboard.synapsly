import type { FastifyPluginAsync } from 'fastify';
import {
  changePasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  updateAvatarInputSchema,
  updateProfileInputSchema,
  type AuthUserResponse,
  type RegistrationStatus,
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
import {
  changeOwnPassword,
  login,
  registerUser,
  reloadUser,
} from '../services/authService.js';
import { getRegistrationSettings } from '../services/settingsService.js';
import {
  clearUserAvatar,
  serializeUser,
  setUserAvatar,
  updateUser,
} from '../services/userService.js';

/**
 * Auth routes (§7, §8): POST /auth/login (rate-limited; argon2 verify + session
 * cookie), POST /auth/logout (delete session + clear cookie), GET /auth/me
 * (current user or 401), POST /auth/password (rotate own password). Also the
 * public self-registration pair: POST /auth/register (rate-limited; gated by the
 * admin invite code) and GET /auth/registration (whether registration is open).
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

  fastify.post(
    '/auth/register',
    {
      // Public endpoint: rate-limit like login to blunt code-guessing (§8).
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply): Promise<AuthUserResponse> => {
      const input = parseBody(registerInputSchema, request.body);
      const { user, session } = await registerUser(fastify.db, input);

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
    },
  );

  // Public probe: only reveals whether registration is open — never the code.
  fastify.get('/auth/registration', async (): Promise<RegistrationStatus> => {
    const { registrationEnabled, registrationCode } = await getRegistrationSettings(
      fastify.db,
    );
    return { enabled: registrationEnabled && registrationCode.length > 0 };
  });

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

  // Self-service profile update — display name only (cannot change role/status).
  fastify.patch('/auth/profile', async (request): Promise<AuthUserResponse> => {
    const user = requireAuth(request);
    const input = parseBody(updateProfileInputSchema, request.body);
    const updated = await updateUser(fastify.db, user.id, {
      displayName: input.displayName,
    });
    return { user: serializeUser(updated) };
  });

  // Self-service avatar upload: accepts a data URL, validates mime + decoded
  // size in the service, stores the bytes in user_avatars, and sets avatar_mime.
  fastify.post('/auth/avatar', async (request): Promise<AuthUserResponse> => {
    const user = requireAuth(request);
    const input = parseBody(updateAvatarInputSchema, request.body);
    const updated = await setUserAvatar(fastify.db, user.id, input.image);
    return { user: serializeUser(updated) };
  });

  // Self-service avatar removal: clears avatar_mime and deletes the bytes row.
  fastify.delete('/auth/avatar', async (request): Promise<AuthUserResponse> => {
    const user = requireAuth(request);
    const updated = await clearUserAvatar(fastify.db, user.id);
    return { user: serializeUser(updated) };
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
