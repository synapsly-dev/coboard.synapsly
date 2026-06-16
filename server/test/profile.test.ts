import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUserResponse } from 'shared';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../src/auth/session.js';
import { sessions, users } from '../src/db/schema.js';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';

/**
 * Self-service profile update (§7 PATCH /auth/profile): a user can change their
 * own display name (and only that — never role/active state). Requires auth.
 */
describe('PATCH /auth/profile', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  async function seedUserCookie(): Promise<{ id: string; cookie: string }> {
    const [user] = await ctx.db
      .insert(users)
      .values({
        email: `${randomUUID()}@example.com`,
        passwordHash: 'x',
        displayName: '旧名字',
        avatarColor: '#3b82f6',
        role: 'member',
      })
      .returning();
    if (!user) throw new Error('seed failed');
    const token = randomUUID();
    await ctx.db.insert(sessions).values({
      id: token,
      userId: user.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      lastSeenAt: new Date(),
    });
    return { id: user.id, cookie: `${SESSION_COOKIE}=${ctx.app.signCookie(token)}` };
  }

  it('updates the caller’s display name and reflects it in /me', async () => {
    const me = await seedUserCookie();
    const headers = { cookie: me.cookie, 'x-requested-with': 'fetch', 'content-type': 'application/json' };

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      headers,
      payload: { displayName: '新名字' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as AuthUserResponse).user.displayName).toBe('新名字');

    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: me.cookie, 'x-requested-with': 'fetch' },
    });
    expect((meRes.json() as AuthUserResponse).user.displayName).toBe('新名字');
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/profile',
      headers: { 'x-requested-with': 'fetch', 'content-type': 'application/json' },
      payload: { displayName: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });
});
