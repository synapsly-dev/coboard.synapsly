import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUserResponse, RegistrationStatus } from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { SESSION_COOKIE } from '../src/auth/session.js';

/**
 * Self-registration API tests (§8): registration is disabled by default and only
 * works when an admin enables it AND configures a non-empty code that matches.
 * Self-registered users are always `member`. The public status endpoint never
 * leaks the code. Uses fastify.inject against a fresh PGlite-backed app per test.
 */

const CSRF_HEADERS = { 'x-requested-with': 'XMLHttpRequest' } as const;

const ADMIN = {
  email: 'admin@coboard.local',
  password: 'admin-password-123',
  displayName: '管理员',
} as const;

const CODE = 'team-secret-2026';

describe('self-registration', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  function sessionCookieFrom(res: {
    cookies: { name: string; value: string }[];
  }): string {
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie, '响应应设置会话 Cookie').toBeDefined();
    return `${SESSION_COOKIE}=${cookie!.value}`;
  }

  /** Run setup to create the first admin; returns its session cookie header. */
  async function setupAdmin(): Promise<string> {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: CSRF_HEADERS,
      payload: ADMIN,
    });
    expect(res.statusCode).toBe(201);
    return sessionCookieFrom(res);
  }

  /** Enable registration + set the code via the admin /settings endpoint. */
  async function enableRegistration(adminCookie: string): Promise<void> {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: { registrationEnabled: true, registrationCode: CODE },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      registrationEnabled: true,
      registrationCode: CODE,
    });
  }

  function register(payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: CSRF_HEADERS,
      payload,
    });
  }

  it('rejects registration with 403 when disabled (the default)', async () => {
    await setupAdmin();

    const res = await register({
      email: 'newbie@coboard.local',
      password: 'newbie-password-1',
      displayName: '新成员',
      code: CODE,
    });
    expect(res.statusCode).toBe(403);
    // Generic gate message must not reveal whether registration is closed or the
    // code was wrong, and must not leak any account state.
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  it('rejects a wrong code with 403 even when enabled', async () => {
    const adminCookie = await setupAdmin();
    await enableRegistration(adminCookie);

    const res = await register({
      email: 'newbie@coboard.local',
      password: 'newbie-password-1',
      displayName: '新成员',
      code: 'wrong-code',
    });
    expect(res.statusCode).toBe(403);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  it('creates a member and logs in with the correct code', async () => {
    const adminCookie = await setupAdmin();
    await enableRegistration(adminCookie);

    const res = await register({
      email: 'newbie@coboard.local',
      password: 'newbie-password-1',
      displayName: '新成员',
      code: CODE,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as AuthUserResponse;
    expect(body.user.email).toBe('newbie@coboard.local');
    // Self-registered users are ALWAYS member, never admin (§8).
    expect(body.user.role).toBe('member');
    expect(body.user.isActive).toBe(true);
    expect(body.user).not.toHaveProperty('passwordHash');

    // The response sets a session cookie that authenticates /me.
    const cookie = sessionCookieFrom(res);
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    expect((me.json() as AuthUserResponse).user.email).toBe('newbie@coboard.local');
  });

  it('returns 409 for a duplicate email', async () => {
    const adminCookie = await setupAdmin();
    await enableRegistration(adminCookie);

    const res = await register({
      email: ADMIN.email,
      password: 'another-password-1',
      displayName: '重复',
      code: CODE,
    });
    expect(res.statusCode).toBe(409);
  });

  it('GET /auth/registration is public and never leaks the code', async () => {
    const adminCookie = await setupAdmin();

    // Disabled by default → enabled:false, and the response carries only `enabled`.
    const before = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/registration',
    });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json() as RegistrationStatus;
    expect(beforeBody).toEqual({ enabled: false });

    await enableRegistration(adminCookie);

    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/registration',
    });
    expect(after.statusCode).toBe(200);
    const afterBody = after.json() as RegistrationStatus;
    expect(afterBody).toEqual({ enabled: true });
    // The secret must never appear anywhere in the public payload.
    expect(JSON.stringify(afterBody)).not.toContain(CODE);
    expect(afterBody).not.toHaveProperty('registrationCode');
  });

  it('reports enabled:false when enabled but no code is configured', async () => {
    const adminCookie = await setupAdmin();
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: { registrationEnabled: true },
    });
    expect(patch.statusCode).toBe(200);

    const status = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/registration',
    });
    expect((status.json() as RegistrationStatus).enabled).toBe(false);

    // And registration is still refused without a configured code.
    const res = await register({
      email: 'newbie@coboard.local',
      password: 'newbie-password-1',
      displayName: '新成员',
      code: '',
    });
    // Empty code fails validation (400) before reaching the gate.
    expect([400, 403]).toContain(res.statusCode);
  });

  it('blocks non-admins from reading or writing /settings', async () => {
    const adminCookie = await setupAdmin();
    await enableRegistration(adminCookie);

    // Register a member, then assert they cannot touch /settings.
    const reg = await register({
      email: 'member@coboard.local',
      password: 'member-password-1',
      displayName: '成员',
      code: CODE,
    });
    const memberCookie = sessionCookieFrom(reg);

    const getRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: memberCookie },
    });
    expect(getRes.statusCode).toBe(403);

    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { ...CSRF_HEADERS, cookie: memberCookie },
      payload: { registrationEnabled: false },
    });
    expect(patchRes.statusCode).toBe(403);

    // Unauthenticated read is rejected too.
    const anon = await ctx.app.inject({ method: 'GET', url: '/api/settings' });
    expect(anon.statusCode).toBe(401);
  });
});
