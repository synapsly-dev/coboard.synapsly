import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  completeJoinInputSchema,
  devLoginInputSchema,
  miniappAuthExchangeInputSchema,
  updateAvatarInputSchema,
  updateProfileInputSchema,
  type AuthConfigResponse,
  type AuthUserResponse,
  type MiniappAuthExchangeResponse,
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
import { issueMiniappAuthCode, redeemMiniappAuthCode } from '../auth/miniapp.js';
import type { SynapslyConfig } from '../auth/config.js';
import { requireAuth } from '../lib/guards.js';
import { parseBody } from '../lib/validate.js';
import { isAppError, unauthorized } from '../lib/errors.js';
import {
  completeSsoJoin,
  devLogin as devLoginService,
  resolveSsoLogin,
  startSession,
  type SsoIdentity,
} from '../services/authService.js';
import {
  clearUserAvatar,
  findUserById,
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

function loginErrorRedirect(reply: FastifyReply, message: string, returnTo?: string): void {
  if (returnTo === MINIAPP_BRIDGE_PATH) {
    reply
      .header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(miniappBridgeHtml({ error: message }));
    return;
  }
  reply.redirect(`/login?sso_error=${encodeURIComponent(message)}`);
}

interface OidcFlowState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

const MINIAPP_BRIDGE_PATH = '/api/auth/miniapp/bridge';

function miniappBridgeHtml(result: { code: string } | { error: string }): string {
  const callback =
    'code' in result
      ? `/pages/auth-callback/index?code=${encodeURIComponent(result.code)}`
      : `/pages/auth-callback/index?error=${encodeURIComponent(result.error)}`;
  const callbackJson = JSON.stringify(callback).replace(/</g, '\\u003c');
  const message =
    'code' in result ? '登录成功，正在返回 Coboard…' : '登录未完成，正在返回 Coboard…';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>登录成功</title><script src="https://res.wx.qq.com/open/js/jweixin-1.6.0.js"></script>
<style>body{font:16px system-ui;text-align:center;padding:64px 24px;color:#171717}button{padding:12px 20px;border:0;border-radius:8px;background:#171717;color:white}</style>
</head><body><p>${message}</p><button id="back">返回小程序</button>
<script>const go=()=>wx.miniProgram.redirectTo({url:${callbackJson}});document.getElementById('back').onclick=go;go();</script>
</body></html>`;
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

  // Enter the existing confidential OIDC flow inside a Mini Program web-view.
  fastify.get('/auth/miniapp/start', async (_request, reply) => {
    if (!runtime.synapsly) throw unauthorized('Syna ID 登录未配置');
    reply.redirect(`/api/auth/synapsly/start?returnTo=${encodeURIComponent(MINIAPP_BRIDGE_PATH)}`);
  });

  // --- SSO: begin the Authorization-Code + PKCE flow -----------------------
  fastify.get('/auth/synapsly/start', async (request, reply) => {
    const cfg = runtime.synapsly;
    if (!cfg) {
      loginErrorRedirect(reply, 'Syna ID 登录未配置');
      return;
    }
    const state = randomToken();
    const nonce = randomToken();
    const verifier = generateCodeVerifier();
    const returnTo = safeReturnTo((request.query as { returnTo?: string }).returnTo);

    const payload: OidcFlowState = { state, nonce, verifier, returnTo };
    reply.setCookie(OIDC_COOKIE, JSON.stringify(payload), flowCookieOptions(fastify.isProduction));

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
      loginErrorRedirect(reply, 'Syna ID 登录未配置');
      return;
    }
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
    const flow = readSignedJson<OidcFlowState>(request, OIDC_COOKIE);
    reply.clearCookie(OIDC_COOKIE, { path: '/' });
    if (query.error) {
      loginErrorRedirect(reply, query.error_description || query.error, flow?.returnTo);
      return;
    }
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

      const resolution = await resolveSsoLogin(fastify.db, identity);
      if (resolution.status === 'needs-join') {
        // Stash the identity and send the user to the coboard join screen.
        reply.setCookie(
          JOIN_COOKIE,
          JSON.stringify(identity),
          flowCookieOptions(fastify.isProduction),
        );
        reply.redirect(`/join?returnTo=${encodeURIComponent(flow.returnTo)}`);
        return;
      }

      const session = await startSession(fastify.db, resolution.user.id, identity.idToken);
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
        loginErrorRedirect(reply, err.message, flow.returnTo);
        return;
      }
      request.log.error({ err }, 'synapsly callback failed');
      loginErrorRedirect(reply, '登录失败，请稍后重试', flow.returnTo);
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

  // The web-view arrives here with the short-lived browser cookie created by
  // OIDC. Turn it into a one-use code, then navigate back into a native page.
  fastify.get('/auth/miniapp/bridge', async (request, reply) => {
    const user = requireAuth(request);
    const sessionToken = request.sessionToken;
    if (!sessionToken) throw unauthorized('登录会话已失效，请重试');
    const idToken = await getSessionOidcIdToken(fastify.db, sessionToken);
    const code = await issueMiniappAuthCode(fastify.db, user.id, idToken);
    await deleteSession(fastify.db, sessionToken);
    reply.clearCookie(SESSION_COOKIE, clearSessionCookieOptions(fastify.isProduction));
    return reply
      .header('Cache-Control', 'no-store')
      .header(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'unsafe-inline' https://res.wx.qq.com; style-src 'unsafe-inline'",
      )
      .type('text/html; charset=utf-8')
      .send(miniappBridgeHtml({ code }));
  });

  // Native client redeems the code once and receives an ordinary opaque Bearer
  // session. The Syna ID token never crosses into Mini Program JavaScript.
  fastify.post(
    '/auth/miniapp/exchange',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request): Promise<MiniappAuthExchangeResponse> => {
      const { code } = parseBody(miniappAuthExchangeInputSchema, request.body);
      const redeemed = await redeemMiniappAuthCode(fastify.db, code);
      if (!redeemed) throw unauthorized('登录凭证已失效，请重新登录');
      const user = await findUserById(fastify.db, redeemed.userId);
      if (!user?.isActive) throw unauthorized('账号已被停用或不存在');
      const session = await startSession(fastify.db, user.id, redeemed.oidcIdToken);
      return {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        user: serializeUser(user),
      };
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
    const user = await devLoginService(fastify.db, input);
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

  fastify.post(
    '/auth/miniapp/dev-login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply): Promise<MiniappAuthExchangeResponse> => {
      if (!runtime.devLogin) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: '资源不存在' },
        }) as unknown as MiniappAuthExchangeResponse;
      }
      const input = parseBody(devLoginInputSchema, request.body);
      const user = await devLoginService(fastify.db, input);
      const session = await startSession(fastify.db, user.id, null);
      return {
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
        user: serializeUser(user),
      };
    },
  );

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
      reply.clearCookie(SESSION_COOKIE, clearSessionCookieOptions(fastify.isProduction));

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
