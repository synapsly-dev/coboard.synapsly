import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthConfigResponse, AuthUserResponse, UserRole, UsersListResponse } from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { SESSION_COOKIE, createSession } from '../src/auth/session.js';
import { users, type UserRow } from '../src/db/schema.js';

/**
 * Auth / users API tests (§7, §8, §10) for the Synapsly-SSO world. Identity comes
 * from SSO, so tests authenticate by seeding a user + session row directly and
 * signing the session cookie — exactly what the production auth pre-handler reads.
 * Also covers the /auth/config probe, logout, the dev fake-login, and the /users
 * admin guard (accounts are now created passwordless, by email).
 */

const CSRF_HEADERS = { 'x-requested-with': 'XMLHttpRequest' } as const;

describe('auth + users', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  /** Seed a user and return its row plus a signed session cookie header. */
  async function seedUser(
    role: UserRole,
    email = `${role}@coboard.local`,
  ): Promise<{ user: UserRow; cookie: string }> {
    const [user] = await ctx.db
      .insert(users)
      .values({
        email,
        passwordHash: null,
        synapslySub: `sub:${email}`,
        displayName: role === 'super_admin' ? '超级管理员' : role === 'admin' ? '管理员' : '成员',
        avatarColor: '#0b0b0c',
        role,
        isActive: true,
      })
      .returning();
    if (!user) throw new Error('seed user failed');
    const { token } = await createSession(ctx.db, user.id);
    return { user, cookie: `${SESSION_COOKIE}=${ctx.app.signCookie(token)}` };
  }

  it('/auth/config reports SSO disabled + dev-login off by default', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json() as AuthConfigResponse).toEqual({
      synapslyEnabled: false,
      devLogin: false,
    });
  });

  it('/me requires authentication', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('a seeded session authenticates /me', async () => {
    const { cookie, user } = await seedUser('admin');
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AuthUserResponse;
    expect(body.user.email).toBe(user.email);
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  it('logout deletes the session so /me is no longer authenticated', async () => {
    const { cookie } = await seedUser('admin');
    const logoutRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { ...CSRF_HEADERS, cookie },
    });
    expect(logoutRes.statusCode).toBe(200);
    expect((logoutRes.json() as { ok: true }).ok).toBe(true);

    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    });
    expect(meRes.statusCode).toBe(401);
  });

  it('admin can list and create users (passwordless, by email)', async () => {
    const { cookie: adminCookie } = await seedUser('admin');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: { email: 'member@coboard.local', displayName: '成员甲', role: 'member' },
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as AuthUserResponse).user.role).toBe('member');

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie: adminCookie },
    });
    expect(listRes.statusCode).toBe(200);
    expect((listRes.json() as UsersListResponse).users).toHaveLength(2);
  });

  it('super admin can create admin accounts', async () => {
    const { cookie: superAdminCookie } = await seedUser('super_admin');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { ...CSRF_HEADERS, cookie: superAdminCookie },
      payload: { email: 'admin-created@coboard.local', displayName: '管理员乙', role: 'admin' },
    });
    expect(created.statusCode).toBe(201);
    expect((created.json() as AuthUserResponse).user.role).toBe('admin');
  });

  it('ordinary admin cannot create admins or adjust global roles', async () => {
    const { cookie: adminCookie } = await seedUser('admin');
    const { user: member } = await seedUser('member', 'role-target@coboard.local');

    const createAdmin = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: { email: 'admin-denied@coboard.local', displayName: '管理员丙', role: 'admin' },
    });
    expect(createAdmin.statusCode).toBe(403);

    const promote = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${member.id}`,
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: { role: 'admin' },
    });
    expect(promote.statusCode).toBe(403);
  });

  it('super admin can promote and demote ordinary admins', async () => {
    const { cookie: superAdminCookie } = await seedUser('super_admin');
    const { user: member } = await seedUser('member', 'promote-target@coboard.local');

    const promote = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${member.id}`,
      headers: { ...CSRF_HEADERS, cookie: superAdminCookie },
      payload: { role: 'admin' },
    });
    expect(promote.statusCode).toBe(200);
    expect((promote.json() as AuthUserResponse).user.role).toBe('admin');

    const demote = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${member.id}`,
      headers: { ...CSRF_HEADERS, cookie: superAdminCookie },
      payload: { role: 'member' },
    });
    expect(demote.statusCode).toBe(200);
    expect((demote.json() as AuthUserResponse).user.role).toBe('member');
  });

  it('does not allow creating, assigning, demoting, or deactivating super admin through user management', async () => {
    const { cookie: superAdminCookie, user: superAdmin } = await seedUser('super_admin');
    const { user: member } = await seedUser('member', 'sa-target@coboard.local');

    const createSecond = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { ...CSRF_HEADERS, cookie: superAdminCookie },
      payload: { email: 'second-sa@coboard.local', displayName: 'SA2', role: 'super_admin' },
    });
    expect(createSecond.statusCode).toBe(400);

    const assignSecond = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${member.id}`,
      headers: { ...CSRF_HEADERS, cookie: superAdminCookie },
      payload: { role: 'super_admin' },
    });
    expect(assignSecond.statusCode).toBe(400);

    const demoteSelf = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${superAdmin.id}`,
      headers: { ...CSRF_HEADERS, cookie: superAdminCookie },
      payload: { role: 'member' },
    });
    expect(demoteSelf.statusCode).toBe(400);

    const deactivateSelf = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${superAdmin.id}`,
      headers: { ...CSRF_HEADERS, cookie: superAdminCookie },
      payload: { isActive: false },
    });
    expect(deactivateSelf.statusCode).toBe(400);
  });

  it('creating a user with a duplicate email returns 409', async () => {
    const { cookie: adminCookie, user } = await seedUser('admin');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: { email: user.email, displayName: '重复', role: 'member' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('blocks a non-admin member from the /users endpoints', async () => {
    const { cookie: memberCookie } = await seedUser('member');

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
      payload: { email: 'x@coboard.local', displayName: 'X', role: 'member' },
    });
    expect(createRes.statusCode).toBe(403);
  });

  it('admin can deactivate a user, ending their access', async () => {
    const { cookie: adminCookie } = await seedUser('admin');
    const { cookie: memberCookie, user: member } = await seedUser('member');

    const patchRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/users/${member.id}`,
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: { isActive: false },
    });
    expect(patchRes.statusCode).toBe(200);
    expect((patchRes.json() as AuthUserResponse).user.isActive).toBe(false);

    // The member's session was revoked on deactivation.
    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: memberCookie },
    });
    expect(meRes.statusCode).toBe(401);
  });

  it('dev-login is 404 when the server has it disabled', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      headers: CSRF_HEADERS,
      payload: { email: 'anyone@coboard.local' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('the complete-join endpoint 401s without a pending-join cookie', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/synapsly/complete-join',
      headers: CSRF_HEADERS,
      payload: { code: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('dev fake-login (DEV_LOGIN enabled)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({ authRuntime: { devLogin: true } });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('config advertises dev-login', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/auth/config' });
    expect((res.json() as AuthConfigResponse).devLogin).toBe(true);
  });

  it('creates + authenticates a super admin by email', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      headers: CSRF_HEADERS,
      payload: { email: 'newbie@coboard.local' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AuthUserResponse;
    expect(body.user.email).toBe('newbie@coboard.local');
    expect(body.user.role).toBe('super_admin');
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toBeDefined();

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${cookie!.value}` },
    });
    expect(me.statusCode).toBe(200);
  });
});
