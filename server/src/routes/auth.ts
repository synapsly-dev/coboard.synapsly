import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  completeJoinInputSchema,
  devLoginInputSchema,
  updateAvatarInputSchema,
  updateProfileInputSchema,
  type AuthConfigResponse,
  type AuthUserResponse,
} from 'shared';
import {
  SESSION_COOKIE,
  clearSessionCookieOptions,
  deleteSession,
  getSessionOidcIdToken,
  sessionCookieOptions,
} from '../auth/session.js';
import {
  buildAuthorizationUrl,
  buildEndSessionUrl,
  codeChallengeS256,
  exchangeCode,
  fetchUserInfo,
  generateCodeVerifier,
  randomToken,
  verifyIdToken,
} from '../auth/synapsly.js';
import type { SynapslyConfig } from '../auth/config.js';
import { requireAuth } from '../lib/guards.js';
import { parseBody } from '../lib/validate.js';
import { isAppError } from '../lib/errors.js';
import {
  completeSsoJoin,
  devLogin as devLoginService,
  resolveSsoLogin,
  startSession,
  type SsoIdentity,
} from '../services/authService.js';
import {
  clearUserAvatar,
  serializeUser,
  setUserAvatar,
  updateUser,
} from '../services/userService.js';

/**
 * Auth routes — Synapsly ID SSO. The confidential Authorization-Code + PKCE flow
 * runs entirely server-side; on success we mint coboard's own session cookie, so
 * the rest of the app's auth (preHandler resolver, guards) is unchanged. Also
 * hosts the invite-code join completion, an optional dev fake-login, logout
 * (with RP-initiated single logout), and the kept self-service profile endpoints.
 */

/** Short-lived cookie carrying the OIDC transaction (state/nonce/PKCE/returnTo). */
const OIDC_COOKIE = 'coboard_oidc';
/** Short-lived cookie carrying a pending-join identity awaiting the invite code. */
const JOIN_COOKIE = 'coboard_join';
const FLOW_COOKIE_TTL_S = 10 * 60;

function flowCookieOptions(production: boolean): {
  path: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  signed: true;
  maxAge: number;
} {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    signed: true,
    maxAge: FLOW_COOKIE_TTL_S,
  };
}

/** Read + JSON-parse a signed flow cookie, or null if absent/tampered. */
function readSignedJson<T>(request: FastifyRequest, name: string): T | null {
  const raw = request.cookies[name];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || unsigned.value === null) return null;
  try {
    return JSON.parse(unsigned.value) as T;
  } catch {
    return null;
  }
}

/** Only allow same-origin path redirects (no protocol-relative `//host`). */
function safeReturnTo(raw: unknown): string {
  if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')) {
    return raw;
  }
  return '/';
}

function loginErrorRedirect(reply: FastifyReply, message: string): void {
  reply.redirect(`/login?sso_error=${encodeURIComponent(message)}`);
}

interface OidcFlowState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const runtime = fastify.authRuntime;

  // Public probe: which sign-in affordances should the login page show?
  fastify.get('/auth/config', async (): Promise<AuthConfigResponse> => {
    return {
      synapslyEnabled: runtime.synapsly !== null,
      devLogin: runtime.devLogin,
    };
  });

  // --- SSO: begin the Authorization-Code + PKCE flow -----------------------
  fastify.get('/auth/synapsly/start', async (request, reply) => {
    const cfg = runtime.synapsly;
    if (!cfg) {
      loginErrorRedirect(reply, 'Synapsly 登录未配置');
      return;
    }
    const state = randomToken();
    const nonce = randomToken();
    const verifier = generateCodeVerifier();
    const returnTo = safeReturnTo((request.query as { returnTo?: string }).returnTo);

    const payload: OidcFlowState = { state, nonce, verifier, returnTo };
    reply.setCookie(
      OIDC_COOKIE,
      JSON.stringify(payload),
      flowCookieOptions(fastify.isProduction),
    );

    const url = await buildAuthorizationUrl(cfg, {
      state,
      nonce,
      codeChallenge: codeChallengeS256(verifier),
    });
    reply.redirect(url);
  });

  // --- SSO: provider redirect target ---------------------------------------
  fastify.get('/auth/synapsly/callback', async (request, reply) => {
    const cfg = runtime.synapsly;
    if (!cfg) {
      loginErrorRedirect(reply, 'Synapsly 登录未配置');
      return;
    }
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
    if (query.error) {
      loginErrorRedirect(reply, query.error_description || query.error);
      return;
    }

    const flow = readSignedJson<OidcFlowState>(request, OIDC_COOKIE);
    reply.clearCookie(OIDC_COOKIE, { path: '/' });
    if (!flow || !query.code || !query.state || query.state !== flow.state) {
      loginErrorRedirect(reply, '登录会话已失效，请重试');
      return;
    }

    try {
      const identity = await verifiedIdentity(cfg, {
        code: query.code,
        verifier: flow.verifier,
        nonce: flow.nonce,
      });

      const resolution = await resolveSsoLogin(
        fastify.db,
        identity,
        runtime.adminEmails,
      );
      if (resolution.status === 'needs-join') {
        // Stash the identity and send the user to the coboard join screen.
        reply.setCookie(
          JOIN_COOKIE,
          JSON.stringify(identity),
          flowCookieOptions(fastify.isProduction),
        );
        reply.redirect('/join');
        return;
      }

      const session = await startSession(
        fastify.db,
        resolution.user.id,
        identity.idToken,
      );
      reply.setCookie(
        SESSION_COOKIE,
        session.token,
        sessionCookieOptions({
          expiresAt: session.expiresAt,
          production: fastify.isProduction,
        }),
      );
      reply.redirect(flow.returnTo);
    } catch (err) {
      if (isAppError(err)) {
        loginErrorRedirect(reply, err.message);
        return;
      }
      request.log.error({ err }, 'synapsly callback failed');
      loginErrorRedirect(reply, '登录失败，请稍后重试');
    }
  });

  // --- SSO: finish first-time member provisioning with the invite code -----
  fastify.post(
    '/auth/synapsly/complete-join',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply): Promise<AuthUserResponse> => {
      const identity = readSignedJson<SsoIdentity>(request, JOIN_COOKIE);
      if (!identity) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: '加入会话已失效，请重新登录' },
        }) as unknown as AuthUserResponse;
      }
      const { code } = parseBody(completeJoinInputSchema, request.body);
      const user = await completeSsoJoin(fastify.db, identity, code);

      reply.clearCookie(JOIN_COOKIE, { path: '/' });
      const session = await startSession(fastify.db, user.id, identity.idToken);
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

  // --- Dev fake-login (non-production only) --------------------------------
  fastify.post('/auth/dev-login', async (request, reply): Promise<AuthUserResponse> => {
    if (!runtime.devLogin) {
      return reply.code(404).send({
        error: { code: 'NOT_FOUND', message: '资源不存在' },
      }) as unknown as AuthUserResponse;
    }
    const input = parseBody(devLoginInputSchema, request.body);
    const user = await devLoginService(fastify.db, input, runtime.adminEmails);
    const session = await startSession(fastify.db, user.id, null);
    reply.setCookie(
      SESSION_COOKIE,
      session.token,
      sessionCookieOptions({
        expiresAt: session.expiresAt,
        production: fastify.isProduction,
      }),
    );
    return { user: serializeUser(user) };
  });

  // --- Current user --------------------------------------------------------
  fastify.get('/auth/me', async (request): Promise<AuthUserResponse> => {
    const user = requireAuth(request);
    return { user: serializeUser(user) };
  });

  // --- Logout (+ optional RP-initiated single logout) ----------------------
  fastify.post(
    '/auth/logout',
    async (request, reply): Promise<{ ok: true; endSessionUrl?: string }> => {
      let idToken: string | null = null;
      if (request.sessionToken) {
        idToken = await getSessionOidcIdToken(fastify.db, request.sessionToken);
        await deleteSession(fastify.db, request.sessionToken);
      }
      reply.clearCookie(
        SESSION_COOKIE,
        clearSessionCookieOptions(fastify.isProduction),
      );

      const cfg = runtime.synapsly;
      if (cfg && cfg.singleLogout) {
        const endSessionUrl = await buildEndSessionUrl(cfg, {
          idToken,
          postLogoutRedirectUri: `${runtime.publicUrl}/`,
        });
        if (endSessionUrl) return { ok: true, endSessionUrl };
      }
      return { ok: true };
    },
  );

  // --- Self-service profile (display name) ---------------------------------
  fastify.patch('/auth/profile', async (request): Promise<AuthUserResponse> => {
    const user = requireAuth(request);
    const input = parseBody(updateProfileInputSchema, request.body);
    const updated = await updateUser(fastify.db, user.id, {
      displayName: input.displayName,
    });
    return { user: serializeUser(updated) };
  });

  // --- Self-service avatar upload / removal --------------------------------
  fastify.post('/auth/avatar', async (request): Promise<AuthUserResponse> => {
    const user = requireAuth(request);
    const input = parseBody(updateAvatarInputSchema, request.body);
    const updated = await setUserAvatar(fastify.db, user.id, input.image);
    return { user: serializeUser(updated) };
  });

  fastify.delete('/auth/avatar', async (request): Promise<AuthUserResponse> => {
    const user = requireAuth(request);
    const updated = await clearUserAvatar(fastify.db, user.id);
    return { user: serializeUser(updated) };
  });
};

/**
 * Exchange the auth code, verify the id_token, and distill a trusted identity.
 * Prefers fresh `/userinfo` claims (incl. `role`, if the provider emits it) but
 * falls back to the id_token; requires the two subjects to agree.
 */
async function verifiedIdentity(
  cfg: SynapslyConfig,
  params: { code: string; verifier: string; nonce: string },
): Promise<SsoIdentity> {
  const tokens = await exchangeCode(cfg, {
    code: params.code,
    codeVerifier: params.verifier,
  });
  const claims = await verifyIdToken(cfg, tokens.id_token, { nonce: params.nonce });
  const info = await fetchUserInfo(cfg, tokens.access_token);
  if (info.sub !== claims.sub) {
    throw new Error('userinfo 与 id_token 的 sub 不一致');
  }
  const email = (info.email ?? claims.email ?? null)?.toLowerCase() ?? null;
  const emailVerified = Boolean(info.email_verified ?? claims.email_verified);
  const role = (info.role ?? claims.role ?? null) as string | null;
  return {
    sub: claims.sub,
    email,
    emailVerified,
    name: info.name ?? claims.name ?? null,
    picture: info.picture ?? claims.picture ?? null,
    role,
    idToken: tokens.id_token,
  };
}

export default authRoutes;
