import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { UsersListResponse } from 'shared';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../src/auth/session.js';
import { projectMembers, projects, sessions, users } from '../src/db/schema.js';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';

/**
 * Admin GET /users embeds each account's project memberships (§6.3) so the
 * console can show per-user project chips and flag orphaned users (in no project).
 */
describe('GET /users — project memberships', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });

  async function seedAdminCookie(): Promise<string> {
    const [admin] = await ctx.db
      .insert(users)
      .values({
        email: `${randomUUID()}@example.com`,
        passwordHash: 'x',
        displayName: 'Admin',
        avatarColor: '#3b82f6',
        role: 'admin',
      })
      .returning();
    if (!admin) throw new Error('seed admin failed');
    const token = randomUUID();
    await ctx.db.insert(sessions).values({
      id: token,
      userId: admin.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      lastSeenAt: new Date(),
    });
    return `${SESSION_COOKIE}=${ctx.app.signCookie(token)}`;
  }

  it('lists a member with their project + role, and an orphan with none', async () => {
    const cookie = await seedAdminCookie();

    const [member] = await ctx.db
      .insert(users)
      .values({
        email: `${randomUUID()}@example.com`,
        passwordHash: 'x',
        displayName: 'Member',
        avatarColor: '#10b981',
        role: 'member',
      })
      .returning();
    const [orphan] = await ctx.db
      .insert(users)
      .values({
        email: `${randomUUID()}@example.com`,
        passwordHash: 'x',
        displayName: 'Orphan',
        avatarColor: '#ef4444',
        role: 'member',
      })
      .returning();
    if (!member || !orphan) throw new Error('seed members failed');

    const [project] = await ctx.db
      .insert(projects)
      .values({
        name: '验证项目',
        key: `K${randomUUID().slice(0, 6)}`,
        createdBy: member.id,
      })
      .returning();
    if (!project) throw new Error('seed project failed');
    await ctx.db
      .insert(projectMembers)
      .values({ projectId: project.id, userId: member.id, role: 'lead' });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/users',
      headers: { cookie, 'x-requested-with': 'fetch' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as UsersListResponse;

    const m = body.users.find((u) => u.id === member.id);
    expect(m?.projects).toEqual([
      { projectId: project.id, projectName: '验证项目', role: 'lead' },
    ]);

    const o = body.users.find((u) => u.id === orphan.id);
    expect(o?.projects).toEqual([]);
  });
});
