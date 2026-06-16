import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../src/auth/session.js';
import { sessions, users } from '../src/db/schema.js';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';

/**
 * Regression: bodyless POST/DELETE must not 415 when a proxy (cloudflared / HTTP-2)
 * attaches a non-JSON Content-Type to the empty request. Logout is the canonical
 * case — a 415 there left the session alive, so the user got auto-logged-in again.
 */
describe('bodyless POST tolerates a proxy-added Content-Type', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  it('logout succeeds (200) with application/octet-stream + empty body, ending the session', async () => {
    const [user] = await ctx.db
      .insert(users)
      .values({
        email: `${randomUUID()}@example.com`,
        passwordHash: 'x',
        displayName: 'U',
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
    const cookie = `${SESSION_COOKIE}=${ctx.app.signCookie(token)}`;

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie,
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'application/octet-stream',
      },
    });
    expect(res.statusCode).toBe(200);

    // The session row is gone, so /me with the same cookie is now unauthenticated.
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie, 'x-requested-with': 'fetch' },
    });
    expect(me.statusCode).toBe(401);
  });
});
