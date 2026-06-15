import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuthUserResponse, UsersListResponse } from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { SESSION_COOKIE } from '../src/auth/session.js';

/**
 * Auth / setup / users API tests (§7, §8, §10): the setup→login happy path,
 * credential rejection, the /me auth gate, and the admin-only guard on /users.
 * Uses fastify.inject against a fresh PGlite-backed app per test.
 */

/** Header that satisfies the app's CSRF check for unsafe methods (§8). */
const CSRF_HEADERS = { 'x-requested-with': 'XMLHttpRequest' } as const;

const ADMIN = {
  email: 'admin@coboard.local',
  password: 'admin-password-123',
  displayName: '管理员',
} as const;

describe('auth + setup + users', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  /** Extract the signed session cookie value from a response's set-cookie. */
  function sessionCookieFrom(res: { cookies: { name: string; value: string }[] }): string {
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

  it('setup creates the first admin and logs in, then login works', async () => {
    // Fresh DB → needs setup.
    const status0 = await ctx.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status0.json()).toEqual({ needsSetup: true });

    const setupRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: CSRF_HEADERS,
      payload: ADMIN,
    });
    expect(setupRes.statusCode).toBe(201);
    const setupBody = setupRes.json() as AuthUserResponse;
    expect(setupBody.user.email).toBe(ADMIN.email);
    expect(setupBody.user.role).toBe('admin');
    // Public shape never leaks the hash.
    expect(setupBody.user).not.toHaveProperty('passwordHash');

    const cookie = sessionCookieFrom(setupRes);
    // The session cookie authenticates /me.
    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(meRes.statusCode).toBe(200);
    expect((meRes.json() as AuthUserResponse).user.email).toBe(ADMIN.email);

    // Now setup reports complete and a second setup is rejected.
    const status1 = await ctx.app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status1.json()).toEqual({ needsSetup: false });

    const setupAgain = await ctx.app.inject({
      method: 'POST',
      url: '/api/setup',
      headers: CSRF_HEADERS,
      payload: { ...ADMIN, email: 'other@coboard.local' },
    });
    expect(setupAgain.statusCode).toBe(409);

    // Login with the right credentials succeeds and sets a session cookie.
    const loginRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF_HEADERS,
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(loginRes.statusCode).toBe(200);
    const loginCookie = sessionCookieFrom(loginRes);
    const me2 = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: loginCookie },
    });
    expect(me2.statusCode).toBe(200);
  });

  it('login rejects a bad password with 401', async () => {
    await setupAdmin();

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF_HEADERS,
      payload: { email: ADMIN.email, password: 'wrong-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
  });

  it('login rejects an unknown email with the same generic 401', async () => {
    await setupAdmin();

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF_HEADERS,
      payload: { email: 'nobody@coboard.local', password: ADMIN.password },
    });
    expect(res.statusCode).toBe(401);
  });

  it('/me requires authentication', async () => {
    await setupAdmin();

    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('logout deletes the session so /me is no longer authenticated', async () => {
    const cookie = await setupAdmin();

    const logoutRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { ...CSRF_HEADERS, cookie },
    });
    expect(logoutRes.statusCode).toBe(200);

    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(meRes.statusCode).toBe(401);
  });

  it('admin can list and create users; new member can log in', async () => {
    const adminCookie = await setupAdmin();

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: {
        email: 'member@coboard.local',
        password: 'member-password-1',
        displayName: '成员甲',
        role: 'member',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdUser = (created.json() as AuthUserResponse).user;
    expect(createdUser.role).toBe('member');

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: adminCookie },
    });
    expect(listRes.statusCode).toBe(200);
    expect((listRes.json() as UsersListResponse).users).toHaveLength(2);

    // The created member can authenticate with the initial password.
    const memberLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF_HEADERS,
      payload: { email: 'member@coboard.local', password: 'member-password-1' },
    });
    expect(memberLogin.statusCode).toBe(200);
  });

  it('creating a user with a duplicate email returns 409', async () => {
    const adminCookie = await setupAdmin();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: {
        email: ADMIN.email,
        password: 'another-password-1',
        displayName: '重复',
        role: 'member',
      },
    });
    expect(res.statusCode).toBe(409);
  });

  it('blocks a non-admin member from the /users endpoints', async () => {
    const adminCookie = await setupAdmin();
    await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: {
        email: 'member@coboard.local',
        password: 'member-password-1',
        displayName: '成员甲',
        role: 'member',
      },
    });

    const memberLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF_HEADERS,
      payload: { email: 'member@coboard.local', password: 'member-password-1' },
    });
    const memberCookie = sessionCookieFrom(memberLogin);

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: memberCookie },
    });
    expect(listRes.statusCode).toBe(403);

    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { ...CSRF_HEADERS, cookie: memberCookie },
      payload: {
        email: 'x@coboard.local',
        password: 'whatever-123',
        displayName: 'X',
        role: 'member',
      },
    });
    expect(createRes.statusCode).toBe(403);
  });

  it('admin can deactivate a user, ending their access', async () => {
    const adminCookie = await setupAdmin();
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: {
        email: 'member@coboard.local',
        password: 'member-password-1',
        displayName: '成员甲',
        role: 'member',
      },
    });
    const memberId = (created.json() as AuthUserResponse).user.id;

    const memberLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF_HEADERS,
      payload: { email: 'member@coboard.local', password: 'member-password-1' },
    });
    const memberCookie = sessionCookieFrom(memberLogin);

    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${memberId}`,
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: { isActive: false },
    });
    expect(patchRes.statusCode).toBe(200);
    expect((patchRes.json() as AuthUserResponse).user.isActive).toBe(false);

    // Existing session was revoked on deactivation.
    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: memberCookie },
    });
    expect(meRes.statusCode).toBe(401);

    // And a fresh login is refused.
    const reLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF_HEADERS,
      payload: { email: 'member@coboard.local', password: 'member-password-1' },
    });
    expect(reLogin.statusCode).toBe(401);
  });

  it('lets a user change their own password', async () => {
    const adminCookie = await setupAdmin();

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: { currentPassword: ADMIN.password, newPassword: 'brand-new-password-1' },
    });
    expect(res.statusCode).toBe(200);

    // Old password no longer works; new one does.
    const oldLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF_HEADERS,
      payload: { email: ADMIN.email, password: ADMIN.password },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: CSRF_HEADERS,
      payload: { email: ADMIN.email, password: 'brand-new-password-1' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('rejects a wrong current password on change with 400', async () => {
    const adminCookie = await setupAdmin();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: { currentPassword: 'not-the-current', newPassword: 'brand-new-password-1' },
    });
    expect(res.statusCode).toBe(400);
  });
});
