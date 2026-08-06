import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import {
  completeJoinInputSchema,
  devLoginInputSchema,
  emailSchema,
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
  OidcHttpError,
  buildAuthorizationUrl,
  buildEndSessionUrl,
  codeChallengeS256,
  exchangeCode,
  fetchUserInfo,
  generateCodeVerifier,
  randomToken,
  resolvePictureUrl,
  verifyIdToken,
  type UserInfo,
} from '../auth/synapsly.js';
import { issueMiniappAuthCode, redeemMiniappAuthCode } from '../auth/miniapp.js';
import type { SynapslyConfig } from '../auth/config.js';
import { requireAuth } from '../lib/guards.js';
import { parseBody } from '../lib/validate.js';
import { isAppError, unauthorized } from '../lib/errors.js';
import {
  completeSsoJoin,
  coreRoleClaimWarning,
  devLogin as devLoginService,
  parseCoreRole,
  parseMembershipClaims,
  resolveSsoLogin,
  startSession,
  type SsoIdentity,
} from '../services/authService.js';
import {
  clearUserAvatar,
  findUserById,
  serializeUser,
  setUserAvatar,
  updateOwnProfile,
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
/**
 * How long a started login may sit unfinished. The old 10 minutes was routinely
 * shorter than a first-time Syna ID sign-up (email OTP, profile completion), and
 * every overrun looked to the user like a random login failure. The window is
 * still bounded and each `state` is single-use.
 */
const FLOW_COOKIE_TTL_S = 30 * 60;
/**
 * How many concurrently started logins one browser may have outstanding. With a
 * single slot, opening the login page in a second tab silently invalidated the
 * first tab's transaction and the eventual callback died on a state mismatch.
 */
const MAX_PENDING_FLOWS = 3;

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

/**
 * The pending-login cookie payload. An array so several tabs can be mid-login at
 * once; the callback picks the entry matching its `state`. The pre-array shape
 * (a bare object) is still accepted so logins started before a deploy finish.
 */
type OidcFlowCookie = { flows: OidcFlowState[] } | OidcFlowState;

function pendingFlows(raw: OidcFlowCookie | null): OidcFlowState[] {
  if (!raw) return [];
  const list = 'flows' in raw ? raw.flows : [raw];
  return Array.isArray(list) ? list.filter((flow) => typeof flow?.state === 'string') : [];
}

/**
 * Turn a callback failure into something the user can act on.
 *
 * "登录失败，请稍后重试" tells a user nothing: it hides an expired auth code
 * (retry works), a wrong client secret (only an admin can fix it), and Syna ID
 * being unreachable (waiting helps) behind one identical sentence. Spec §2.5
 * requires the concrete reason, so every branch below names what happened and
 * implies the next step. The unmapped tail keeps the raw message rather than
 * flattening it — an unfamiliar sentence still beats a meaningless one.
 */
function ssoFailureMessage(err: unknown): string {
  if (err instanceof OidcHttpError) {
    switch (err.oauthError) {
      case 'invalid_grant':
        return '本次登录的授权码已失效（可能已被使用或停留过久），请重新点击「使用 Syna ID 登录」';
      case 'invalid_client':
      case 'unauthorized_client':
        return 'Coboard 的 Syna ID 客户端凭据无效，请联系管理员核对 OIDC_CLIENT_ID / OIDC_CLIENT_SECRET';
      case 'invalid_request':
        return `Syna ID 拒绝了本次登录请求：${err.message}。若持续出现，请联系管理员核对 redirect_uri 是否与 Syna ID 中登记的完全一致`;
      default:
        return `Syna ID 返回错误：${err.message}`;
    }
  }
  if (err instanceof TypeError) {
    // Undici surfaces DNS/TLS/connection resets as TypeError('fetch failed').
    return '暂时无法连接 Syna ID（accounts.synapsly.org），请稍后重试';
  }
  if (err instanceof Error && err.message) return err.message;
  return '登录失败，请稍后重试';
}

type SerializedSsoIdentity = Omit<SsoIdentity, 'membershipExpiresAt'> & {
  membershipExpiresAt: string | null;
};

/** JSON cookies turn Date into strings; revalidate + hydrate before provisioning. */
function hydratePendingIdentity(raw: SerializedSsoIdentity): SsoIdentity {
  const coreRole = parseCoreRole(raw.coreRole);
  const { membershipTier, membershipExpiresAt } = parseMembershipClaims(
    raw.membershipTier,
    raw.membershipExpiresAt,
  );
  return { ...raw, coreRole, membershipTier, membershipExpiresAt };
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

    // Keep the other tabs' in-flight transactions alive alongside this one.
    const flows = [
      { state, nonce, verifier, returnTo },
      ...pendingFlows(readSignedJson<OidcFlowCookie>(request, OIDC_COOKIE)),
    ].slice(0, MAX_PENDING_FLOWS);
    reply.setCookie(
      OIDC_COOKIE,
      JSON.stringify({ flows } satisfies OidcFlowCookie),
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
      loginErrorRedirect(reply, 'Syna ID 登录未配置');
      return;
    }
    const query = request.query as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
    const flows = pendingFlows(readSignedJson<OidcFlowCookie>(request, OIDC_COOKIE));
    const flow = query.state ? flows.find((entry) => entry.state === query.state) : undefined;
    // Consume only the transaction that just completed; other tabs keep theirs.
    const remaining = flows.filter((entry) => entry !== flow);
    if (remaining.length > 0) {
      reply.setCookie(
        OIDC_COOKIE,
        JSON.stringify({ flows: remaining } satisfies OidcFlowCookie),
        flowCookieOptions(fastify.isProduction),
      );
    } else {
      reply.clearCookie(OIDC_COOKIE, { path: '/' });
    }
    if (query.error) {
      loginErrorRedirect(reply, query.error_description || query.error, flow?.returnTo);
      return;
    }
    // Separate the ways this can go wrong: they have different fixes, so they
    // must not share one "会话已失效" message (§2.5).
    if (!query.code || !query.state) {
      request.log.warn({ query }, 'OIDC 回调缺少 code/state 参数');
      loginErrorRedirect(reply, 'Syna ID 回调缺少 code 或 state 参数，请重新登录', flow?.returnTo);
      return;
    }
    if (!flow) {
      const reason =
        flows.length === 0
          ? `登录状态已丢失：本次登录超过 ${FLOW_COOKIE_TTL_S / 60} 分钟未完成，或浏览器拦截了 Coboard 的 Cookie。请重新登录；若仍失败，请检查浏览器是否屏蔽了本站 Cookie`
          : '登录校验失败：回调携带的 state 不属于本浏览器已发起的任何一次登录（可能是重复打开了旧的回调链接）。请回到登录页重新登录';
      request.log.warn(
        { pending: flows.length },
        'OIDC 回调找不到匹配的 state（cookie 丢失、超时或回调被重放）',
      );
      loginErrorRedirect(reply, reason);
      return;
    }

    try {
      const identity = await verifiedIdentity(
        cfg,
        {
          code: query.code,
          verifier: flow.verifier,
          nonce: flow.nonce,
        },
        request.log,
      );

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
        request.log.warn({ err }, 'synapsly callback rejected');
        loginErrorRedirect(reply, err.message, flow.returnTo);
        return;
      }
      request.log.error({ err }, 'synapsly callback failed');
      loginErrorRedirect(reply, ssoFailureMessage(err), flow.returnTo);
    }
  });

  // --- SSO: finish first-time member provisioning with the invite code -----
  fastify.post(
    '/auth/synapsly/complete-join',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply): Promise<AuthUserResponse> => {
      const serializedIdentity = readSignedJson<SerializedSsoIdentity>(request, JOIN_COOKIE);
      if (!serializedIdentity) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: '加入会话已失效，请重新登录' },
        }) as unknown as AuthUserResponse;
      }
      const identity = hydratePendingIdentity(serializedIdentity);
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
    const updated = await updateOwnProfile(fastify.db, user.id, input.displayName);
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
 * Prefers fresh `/userinfo` claims but treats each scoped claim family as one
 * coherent snapshot, falling back to the (signature-verified) id_token when
 * `/userinfo` is unreachable — core carries the same claims in both, so a blip
 * on that one request should not fail an otherwise complete login.
 *
 * Only genuinely unusable identity data throws, and when it does the message is
 * specific enough for the user to know whether to retry, fix something in Syna
 * ID, or call an admin. Optional, display-only claims (role, membership,
 * picture) degrade to their documented floor and are logged instead.
 */
async function verifiedIdentity(
  cfg: SynapslyConfig,
  params: { code: string; verifier: string; nonce: string },
  log: FastifyBaseLogger,
): Promise<SsoIdentity> {
  const tokens = await exchangeCode(cfg, {
    code: params.code,
    codeVerifier: params.verifier,
  });
  const claims = await verifyIdToken(cfg, tokens.id_token, { nonce: params.nonce });
  if (typeof claims.sub !== 'string' || claims.sub.trim().length === 0) {
    throw unauthorized('Syna ID 返回的身份缺少 sub，无法登录，请联系管理员');
  }

  let fetched: UserInfo | null = null;
  try {
    fetched = await fetchUserInfo(cfg, tokens.access_token);
  } catch (err) {
    log.warn({ err }, '/userinfo 请求失败，回退到已验签的 id_token claims');
  }
  if (fetched && fetched.sub !== claims.sub) {
    throw unauthorized('Syna ID 返回的身份不一致（userinfo 与 id_token 的 sub 不同），请重新登录');
  }
  const info = fetched ?? ({} as UserInfo);

  const hasOwn = (source: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(source, key);
  const familySource = (keys: string[]): typeof claims | typeof info =>
    keys.some((key) => hasOwn(info, key)) ? info : claims;

  const emailSource = familySource(['email', 'email_verified']);
  if (typeof emailSource.email !== 'string' || emailSource.email.trim().length === 0) {
    throw unauthorized('你的 Syna ID 没有邮箱地址；请先在 Syna ID 中绑定邮箱再登录 Coboard');
  }
  if (emailSource.email_verified !== undefined && typeof emailSource.email_verified !== 'boolean') {
    throw unauthorized('Syna ID 返回的 email_verified 非法，请联系管理员');
  }
  const parsedEmail = emailSchema.safeParse(emailSource.email);
  if (!parsedEmail.success) {
    throw unauthorized(`Syna ID 返回的邮箱格式非法：${emailSource.email}`);
  }
  const email = parsedEmail.data.toLowerCase();
  const emailVerified = emailSource.email_verified === true;

  const phoneSource = familySource(['phone_number', 'phone_number_verified']);
  // The provider's standard UserInfo encoder omits both fields when the Core
  // phone is empty. Treat that coherent absence as the authoritative empty
  // snapshot so a removed phone clears stale local data.
  const phoneNumber =
    typeof phoneSource.phone_number === 'string' ? phoneSource.phone_number.trim() || null : null;
  const phoneNumberVerified = phoneSource.phone_number_verified === true && phoneNumber !== null;
  if (phoneSource.phone_number_verified === true && phoneNumber === null) {
    log.warn('phone_number_verified 为 true 但缺少 phone_number，按未验证处理');
  }

  const roleSource = familySource(['role']);
  const roleWarning = coreRoleClaimWarning(roleSource.role);
  if (roleWarning) log.warn({ sub: claims.sub }, roleWarning);
  const coreRole = parseCoreRole(roleSource.role);

  const membershipSource = familySource(['membership_tier', 'membership_expires_at']);
  const membership = parseMembershipClaims(
    membershipSource.membership_tier,
    membershipSource.membership_expires_at,
  );
  if (membership.warning) {
    log.warn({ sub: claims.sub }, `会员档位按免费版处理：${membership.warning}`);
  }

  const pictureRaw = info.picture ?? claims.picture;
  const picture = resolvePictureUrl(cfg.issuer, pictureRaw);
  if (picture === null && typeof pictureRaw === 'string' && pictureRaw.trim().length > 0) {
    log.warn({ picture: pictureRaw }, 'picture claim 无法解析为可用 URL，本次登录不同步头像');
  }

  return {
    sub: claims.sub,
    email,
    emailVerified,
    phoneNumber,
    phoneNumberVerified,
    name:
      typeof info.name === 'string'
        ? info.name
        : typeof claims.name === 'string'
          ? claims.name
          : null,
    picture,
    coreRole,
    membershipTier: membership.membershipTier,
    membershipExpiresAt: membership.membershipExpiresAt,
    idToken: tokens.id_token,
  };
}

export default authRoutes;
