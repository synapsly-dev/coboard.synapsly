import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema.js';
import { createSession } from '../src/auth/session.js';
import { createTestContext, type TestContext } from './helpers.js';

describe('Bearer session authentication', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('resolves the same server session from an Authorization header', async () => {
    const [user] = await ctx.db
      .insert(users)
      .values({
        email: 'miniapp@example.com',
        displayName: 'Miniapp User',
        avatarColor: '#3b82f6',
        role: 'member',
      })
      .returning();
    if (!user) throw new Error('failed to seed user');
    const session = await createSession(ctx.db, user.id);

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${session.token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.id).toBe(user.id);
  });

  it('rejects an unknown Bearer token', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${'x'.repeat(43)}` },
    });
    expect(response.statusCode).toBe(401);
  });
});
