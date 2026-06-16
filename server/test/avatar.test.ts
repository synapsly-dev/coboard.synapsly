import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthUserResponse } from 'shared';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../src/auth/session.js';
import { sessions, users } from '../src/db/schema.js';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';

/**
 * Avatar upload (Change 1): a user can upload/replace/remove their own profile
 * picture (POST/DELETE /auth/avatar) and any logged-in user can fetch another
 * user's avatar bytes (GET /users/:id/avatar). The big base64 lives off the
 * users row so list selects stay light; `hasAvatar` flips with the upload.
 */

// A real, minimal 1x1 transparent PNG, base64-encoded.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_DATA_URL = `data:image/png;base64,${PNG_1X1}`;

describe('avatar upload', () => {
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
        displayName: '头像测试',
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

  function writeHeaders(cookie: string): Record<string, string> {
    return { cookie, 'x-requested-with': 'fetch', 'content-type': 'application/json' };
  }

  it('uploads a valid png, serves it, then removes it', async () => {
    const me = await seedUserCookie();

    // Upload → 200 + hasAvatar true.
    const upload = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/avatar',
      headers: writeHeaders(me.cookie),
      payload: { image: PNG_DATA_URL },
    });
    expect(upload.statusCode).toBe(200);
    expect((upload.json() as AuthUserResponse).user.hasAvatar).toBe(true);

    // /me reflects hasAvatar.
    const meRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: me.cookie, 'x-requested-with': 'fetch' },
    });
    expect((meRes.json() as AuthUserResponse).user.hasAvatar).toBe(true);

    // GET avatar → 200 with the right content-type and an ETag.
    const get = await ctx.app.inject({
      method: 'GET',
      url: `/api/users/${me.id}/avatar`,
      headers: { cookie: me.cookie, 'x-requested-with': 'fetch' },
    });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['etag']).toBeTruthy();
    expect(get.rawPayload.length).toBeGreaterThan(0);

    // If-None-Match with the same ETag → 304.
    const etag = get.headers['etag'] as string;
    const notModified = await ctx.app.inject({
      method: 'GET',
      url: `/api/users/${me.id}/avatar`,
      headers: { cookie: me.cookie, 'x-requested-with': 'fetch', 'if-none-match': etag },
    });
    expect(notModified.statusCode).toBe(304);

    // DELETE → hasAvatar false.
    const del = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/auth/avatar',
      headers: { cookie: me.cookie, 'x-requested-with': 'fetch' },
    });
    expect(del.statusCode).toBe(200);
    expect((del.json() as AuthUserResponse).user.hasAvatar).toBe(false);

    // GET now 404s (no avatar).
    const gone = await ctx.app.inject({
      method: 'GET',
      url: `/api/users/${me.id}/avatar`,
      headers: { cookie: me.cookie, 'x-requested-with': 'fetch' },
    });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects a non-image payload with 400', async () => {
    const me = await seedUserCookie();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/avatar',
      headers: writeHeaders(me.cookie),
      payload: { image: 'data:text/plain;base64,aGVsbG8=' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an oversized image with 400', async () => {
    const me = await seedUserCookie();
    // ~960k base64 chars decode to ~720k bytes — over the 700_000 service cap
    // but still under the 1 MB request body limit, so we reach our validation.
    const big = 'A'.repeat(960_000);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/avatar',
      headers: writeHeaders(me.cookie),
      payload: { image: `data:image/png;base64,${big}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s when fetching an avatar for a user that has none', async () => {
    const me = await seedUserCookie();
    const other = await seedUserCookie();
    // `me` is logged in; `other` has no avatar → 404.
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/users/${other.id}/avatar`,
      headers: { cookie: me.cookie, 'x-requested-with': 'fetch' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires auth to fetch an avatar', async () => {
    const target = await seedUserCookie();
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/users/${target.id}/avatar`,
      headers: { 'x-requested-with': 'fetch' },
    });
    expect(res.statusCode).toBe(401);
  });
});
