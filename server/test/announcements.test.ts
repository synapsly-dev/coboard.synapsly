import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { AnnouncementResponse, AnnouncementsResponse } from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/session.js';
import { announcements, users, type UserRow } from '../src/db/schema.js';

/**
 * Announcement / 信息 tests. The critical behaviour is the admin gate: every
 * logged-in user may read, but only a global admin may create / edit / delete.
 */

let seq = 0;

async function makeUser(ctx: TestContext, role: 'admin' | 'member'): Promise<UserRow> {
  seq += 1;
  const [row] = await ctx.db
    .insert(users)
    .values({
      email: `ann-user${seq}@example.com`,
      passwordHash: 'x',
      displayName: `用户${seq}`,
      avatarColor: '#3b82f6',
      role,
    })
    .returning();
  if (!row) throw new Error('failed to insert user');
  return row;
}

async function authCookie(ctx: TestContext, userId: string): Promise<string> {
  const { token } = await createSession(ctx.db, userId);
  return `${SESSION_COOKIE}=${ctx.app.signCookie(token)}`;
}

function headers(cookie: string): Record<string, string> {
  return { cookie, 'x-requested-with': 'fetch' };
}

describe('announcements / 信息', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    await ctx.db.delete(announcements);
  });

  it('lets an admin publish a notice and lists it back (newest first)', async () => {
    const admin = await makeUser(ctx, 'admin');
    const cookie = await authCookie(ctx, admin.id);

    const createRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: headers(cookie),
      payload: { title: '系统维护通知', body: '本周六 **停机维护**。' },
    });
    expect(createRes.statusCode).toBe(201);
    const created = (createRes.json() as AnnouncementResponse).announcement;
    expect(created.title).toBe('系统维护通知');
    expect(created.author.id).toBe(admin.id);

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/announcements',
      headers: headers(cookie),
    });
    expect(listRes.statusCode).toBe(200);
    const { announcements: list } = listRes.json() as AnnouncementsResponse;
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('系统维护通知');
  });

  it('forbids a non-admin from publishing (403)', async () => {
    const member = await makeUser(ctx, 'member');
    const cookie = await authCookie(ctx, member.id);

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: headers(cookie),
      payload: { title: 'x', body: 'y' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets any logged-in user read the list', async () => {
    const admin = await makeUser(ctx, 'admin');
    const member = await makeUser(ctx, 'member');
    await ctx.app.inject({
      method: 'POST',
      url: '/api/announcements',
      headers: headers(await authCookie(ctx, admin.id)),
      payload: { title: '公告', body: '内容' },
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/announcements',
      headers: headers(await authCookie(ctx, member.id)),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as AnnouncementsResponse).announcements).toHaveLength(1);
  });

  it('lets an admin edit a notice and bumps updatedAt', async () => {
    const admin = await makeUser(ctx, 'admin');
    const cookie = await authCookie(ctx, admin.id);
    const created = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/announcements',
          headers: headers(cookie),
          payload: { title: '旧标题', body: '旧内容' },
        })
      ).json() as AnnouncementResponse
    ).announcement;

    const editRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/announcements/${created.id}`,
      headers: headers(cookie),
      payload: { title: '新标题' },
    });
    expect(editRes.statusCode).toBe(200);
    const edited = (editRes.json() as AnnouncementResponse).announcement;
    expect(edited.title).toBe('新标题');
    expect(edited.body).toBe('旧内容');
    expect(Date.parse(edited.updatedAt)).toBeGreaterThanOrEqual(Date.parse(edited.createdAt));
  });

  it('forbids a non-admin from editing or deleting (403)', async () => {
    const admin = await makeUser(ctx, 'admin');
    const member = await makeUser(ctx, 'member');
    const created = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/announcements',
          headers: headers(await authCookie(ctx, admin.id)),
          payload: { title: '公告', body: '内容' },
        })
      ).json() as AnnouncementResponse
    ).announcement;
    const memberCookie = await authCookie(ctx, member.id);

    const editRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/announcements/${created.id}`,
      headers: headers(memberCookie),
      payload: { title: 'hijack' },
    });
    expect(editRes.statusCode).toBe(403);

    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/announcements/${created.id}`,
      headers: headers(memberCookie),
    });
    expect(delRes.statusCode).toBe(403);
  });

  it('lets an admin delete a notice', async () => {
    const admin = await makeUser(ctx, 'admin');
    const cookie = await authCookie(ctx, admin.id);
    const created = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/announcements',
          headers: headers(cookie),
          payload: { title: '公告', body: '内容' },
        })
      ).json() as AnnouncementResponse
    ).announcement;

    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/announcements/${created.id}`,
      headers: headers(cookie),
    });
    expect(delRes.statusCode).toBe(204);

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/announcements',
      headers: headers(cookie),
    });
    expect((listRes.json() as AnnouncementsResponse).announcements).toHaveLength(0);
  });

  it('rejects an empty title or body (400)', async () => {
    const admin = await makeUser(ctx, 'admin');
    const cookie = await authCookie(ctx, admin.id);
    for (const payload of [{ title: '', body: '内容' }, { title: '标题', body: '' }]) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/announcements',
        headers: headers(cookie),
        payload,
      });
      expect(res.statusCode).toBe(400);
    }
  });
});
