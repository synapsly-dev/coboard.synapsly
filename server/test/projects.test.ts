import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LightMyRequestResponse } from 'fastify';
import { SESSION_COOKIE, SESSION_TTL_MS } from '../src/auth/session.js';
import {
  projectMembers,
  projects,
  sessions,
  users,
} from '../src/db/schema.js';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';

/**
 * Project & membership API tests (§6.3, §7). Covers member visibility (non-members
 * cannot see a project), lead/admin-only mutations, and add/remove member flows.
 * Auth is exercised end-to-end via signed session cookies + the CSRF header that
 * the app requires on unsafe methods (§8).
 */

interface SeededUser {
  id: string;
  /** Cookie header value carrying the signed session token. */
  cookie: string;
}

/** Insert a user + session and return its id and ready-to-send cookie header. */
async function seedUser(
  ctx: TestContext,
  opts: { role?: 'admin' | 'member'; displayName?: string } = {},
): Promise<SeededUser> {
  const [user] = await ctx.db
    .insert(users)
    .values({
      email: `${randomUUID()}@example.com`,
      passwordHash: 'x', // not exercised by these tests
      displayName: opts.displayName ?? 'Tester',
      avatarColor: '#3b82f6',
      role: opts.role ?? 'member',
    })
    .returning();
  if (!user) throw new Error('seedUser: insert returned no row');

  const token = randomUUID();
  await ctx.db.insert(sessions).values({
    id: token,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    lastSeenAt: new Date(),
  });

  const signed = ctx.app.signCookie(token);
  return { id: user.id, cookie: `${SESSION_COOKIE}=${signed}` };
}

/** Headers for an authenticated, CSRF-passing request carrying a JSON body. */
function authHeaders(user: SeededUser): Record<string, string> {
  return {
    cookie: user.cookie,
    'x-requested-with': 'fetch',
    'content-type': 'application/json',
  };
}

/**
 * Headers for an authenticated request with NO body (GET/DELETE). We omit
 * `content-type: application/json` so Fastify's content-type parser doesn't reject
 * the empty body with FST_ERR_CTP_EMPTY_JSON_BODY.
 */
function authHeadersNoBody(user: SeededUser): Record<string, string> {
  return {
    cookie: user.cookie,
    'x-requested-with': 'fetch',
  };
}

function json<T>(res: LightMyRequestResponse): T {
  return res.json() as T;
}

/**
 * Read the error code from a §7 error response. Tolerant of both the nested
 * `{ error: { code } }` contract shape and Fastify's flat default error shape, so
 * these tests assert behaviour (status + code) independent of how the foundation's
 * global error handler currently serializes thrown AppErrors.
 */
function errorCode(res: LightMyRequestResponse): string | undefined {
  const body = res.json() as {
    error?: { code?: string } | string;
    code?: string;
  };
  if (body.error && typeof body.error === 'object') return body.error.code;
  return body.code;
}

describe('projects & membership', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // Clean the project graph between tests so visibility assertions are isolated.
  beforeEach(async () => {
    await ctx.db.delete(projectMembers);
    await ctx.db.delete(projects);
  });

  describe('POST /api/projects', () => {
    it('lets an admin create a project and auto-adds the creator as lead', async () => {
      const admin = await seedUser(ctx, { role: 'admin' });

      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeaders(admin),
        payload: { name: '协作看板', key: 'COBO', description: '团队主项目' },
      });

      expect(res.statusCode).toBe(201);
      const body = json<{ project: { id: string; key: string; createdBy: string } }>(res);
      expect(body.project.key).toBe('COBO');
      expect(body.project.createdBy).toBe(admin.id);

      // Creator should be enrolled as lead.
      const members = await ctx.db.select().from(projectMembers);
      expect(members).toHaveLength(1);
      expect(members[0]?.userId).toBe(admin.id);
      expect(members[0]?.role).toBe('lead');
    });

    it('forbids a non-admin from creating a project', async () => {
      const member = await seedUser(ctx, { role: 'member' });

      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeaders(member),
        payload: { name: '私房项目', key: 'NOPE' },
      });

      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('forbidden');
    });

    it('rejects a duplicate project key with 409', async () => {
      const admin = await seedUser(ctx, { role: 'admin' });
      const create = (): Promise<LightMyRequestResponse> =>
        ctx.app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: authHeaders(admin),
          payload: { name: '项目', key: 'DUP' },
        });

      expect((await create()).statusCode).toBe(201);
      const dup = await create();
      expect(dup.statusCode).toBe(409);
      expect(errorCode(dup)).toBe('conflict');
    });

    it('rejects an invalid key with a 400 validation error', async () => {
      const admin = await seedUser(ctx, { role: 'admin' });
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeaders(admin),
        payload: { name: '项目', key: 'lower' }, // must be uppercase A-Z0-9
      });
      expect(res.statusCode).toBe(400);
      expect(errorCode(res)).toBe('validation_error');
    });
  });

  describe('GET /api/projects visibility', () => {
    it('returns only the projects a member belongs to; admins see all', async () => {
      const admin = await seedUser(ctx, { role: 'admin' });
      const member = await seedUser(ctx, { role: 'member' });

      // Two projects; member is added to only one.
      const createProject = async (key: string): Promise<string> => {
        const res = await ctx.app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: authHeaders(admin),
          payload: { name: key, key },
        });
        return json<{ project: { id: string } }>(res).project.id;
      };
      const visibleId = await createProject('ALPHA');
      await createProject('BETA');

      await ctx.db.insert(projectMembers).values({
        projectId: visibleId,
        userId: member.id,
        role: 'member',
      });

      const memberRes = await ctx.app.inject({
        method: 'GET',
        url: '/api/projects',
        headers: authHeaders(member),
      });
      expect(memberRes.statusCode).toBe(200);
      const memberProjects = json<{ projects: { id: string }[] }>(memberRes).projects;
      expect(memberProjects).toHaveLength(1);
      expect(memberProjects[0]?.id).toBe(visibleId);

      const adminRes = await ctx.app.inject({
        method: 'GET',
        url: '/api/projects',
        headers: authHeaders(admin),
      });
      expect(json<{ projects: unknown[] }>(adminRes).projects).toHaveLength(2);
    });

    it('hides project members from a non-member (403)', async () => {
      const admin = await seedUser(ctx, { role: 'admin' });
      const outsider = await seedUser(ctx, { role: 'member' });

      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeaders(admin),
        payload: { name: 'Secret', key: 'SECRET' },
      });
      const projectId = json<{ project: { id: string } }>(created).project.id;

      const res = await ctx.app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/members`,
        headers: authHeaders(outsider),
      });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res)).toBe('forbidden');
    });

    it('lets a member view the member list', async () => {
      const admin = await seedUser(ctx, { role: 'admin' });
      const member = await seedUser(ctx, { role: 'member' });

      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeaders(admin),
        payload: { name: 'Team', key: 'TEAM' },
      });
      const projectId = json<{ project: { id: string } }>(created).project.id;
      await ctx.db.insert(projectMembers).values({
        projectId,
        userId: member.id,
        role: 'member',
      });

      const res = await ctx.app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/members`,
        headers: authHeaders(member),
      });
      expect(res.statusCode).toBe(200);
      const members = json<{ members: { userId: string; user: { email: string } }[] }>(res).members;
      // Creator (lead) + added member.
      expect(members).toHaveLength(2);
      expect(members.some((m) => m.userId === member.id)).toBe(true);
      // Member rows must carry the joined public user (no password leak).
      for (const m of members) {
        expect(m.user.email).toContain('@');
        expect(m.user).not.toHaveProperty('passwordHash');
      }
    });
  });

  describe('PATCH /api/projects/:id', () => {
    it('lets a lead rename/archive the project', async () => {
      const admin = await seedUser(ctx, { role: 'admin' });
      const lead = await seedUser(ctx, { role: 'member' });

      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeaders(admin),
        payload: { name: 'Old', key: 'PROJ' },
      });
      const projectId = json<{ project: { id: string } }>(created).project.id;
      await ctx.db.insert(projectMembers).values({
        projectId,
        userId: lead.id,
        role: 'lead',
      });

      const res = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/projects/${projectId}`,
        headers: authHeaders(lead),
        payload: { name: 'New', archived: true },
      });
      expect(res.statusCode).toBe(200);
      const project = json<{ project: { name: string; archived: boolean } }>(res).project;
      expect(project.name).toBe('New');
      expect(project.archived).toBe(true);
    });

    it('forbids a plain member from mutating the project', async () => {
      const admin = await seedUser(ctx, { role: 'admin' });
      const member = await seedUser(ctx, { role: 'member' });

      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeaders(admin),
        payload: { name: 'Proj', key: 'MEMB' },
      });
      const projectId = json<{ project: { id: string } }>(created).project.id;
      await ctx.db.insert(projectMembers).values({
        projectId,
        userId: member.id,
        role: 'member',
      });

      const res = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/projects/${projectId}`,
        headers: authHeaders(member),
        payload: { name: 'Hacked' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('members add/remove', () => {
    async function setupProject(): Promise<{
      admin: SeededUser;
      projectId: string;
    }> {
      const admin = await seedUser(ctx, { role: 'admin' });
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeaders(admin),
        payload: { name: 'Proj', key: 'MEMBERS' },
      });
      const projectId = json<{ project: { id: string } }>(created).project.id;
      return { admin, projectId };
    }

    it('lets a lead/admin add a member with a role', async () => {
      const { admin, projectId } = await setupProject();
      const newcomer = await seedUser(ctx, { role: 'member' });

      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/members`,
        headers: authHeaders(admin),
        payload: { userId: newcomer.id, role: 'member' },
      });
      expect(res.statusCode).toBe(201);
      const member = json<{ member: { userId: string; role: string } }>(res).member;
      expect(member.userId).toBe(newcomer.id);
      expect(member.role).toBe('member');

      const rows = await ctx.db.select().from(projectMembers);
      expect(rows.some((r) => r.userId === newcomer.id)).toBe(true);
    });

    it('rejects adding the same member twice with 409', async () => {
      const { admin, projectId } = await setupProject();
      const newcomer = await seedUser(ctx, { role: 'member' });
      const add = (): Promise<LightMyRequestResponse> =>
        ctx.app.inject({
          method: 'POST',
          url: `/api/projects/${projectId}/members`,
          headers: authHeaders(admin),
          payload: { userId: newcomer.id, role: 'member' },
        });

      expect((await add()).statusCode).toBe(201);
      expect((await add()).statusCode).toBe(409);
    });

    it('returns 404 when adding an unknown user', async () => {
      const { admin, projectId } = await setupProject();
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/members`,
        headers: authHeaders(admin),
        payload: { userId: randomUUID(), role: 'member' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('lets a lead/admin remove a member', async () => {
      const { admin, projectId } = await setupProject();
      const newcomer = await seedUser(ctx, { role: 'member' });
      await ctx.db.insert(projectMembers).values({
        projectId,
        userId: newcomer.id,
        role: 'member',
      });

      const res = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/projects/${projectId}/members/${newcomer.id}`,
        headers: authHeadersNoBody(admin),
      });
      expect(res.statusCode).toBe(204);

      const rows = await ctx.db.select().from(projectMembers);
      expect(rows.some((r) => r.userId === newcomer.id)).toBe(false);
    });

    it('returns 404 when removing a non-member', async () => {
      const { admin, projectId } = await setupProject();
      const res = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/projects/${projectId}/members/${randomUUID()}`,
        headers: authHeadersNoBody(admin),
      });
      expect(res.statusCode).toBe(404);
    });

    it('refuses to remove the project last lead', async () => {
      // The creator is the only lead; removing them would orphan the project.
      const admin = await seedUser(ctx, { role: 'admin' });
      const lead = await seedUser(ctx, { role: 'member' });
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: authHeaders(admin),
        payload: { name: 'Proj', key: 'LASTLEAD' },
      });
      const projectId = json<{ project: { id: string } }>(created).project.id;
      // Promote a second member to lead, then leave the original admin-lead as the
      // only remaining lead after they (the admin) are excluded.
      await ctx.db.insert(projectMembers).values({
        projectId,
        userId: lead.id,
        role: 'lead',
      });
      // Remove the admin-creator (a lead) — still one lead left, allowed.
      const ok = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/projects/${projectId}/members/${admin.id}`,
        headers: authHeadersNoBody(admin),
      });
      expect(ok.statusCode).toBe(204);

      // Now `lead` is the only lead; removing them must be refused.
      const refused = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/projects/${projectId}/members/${lead.id}`,
        headers: authHeadersNoBody(admin),
      });
      expect(refused.statusCode).toBe(403);
    });
  });

  describe('auth & CSRF', () => {
    it('rejects unauthenticated access with 401', async () => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/projects',
        headers: { 'x-requested-with': 'fetch' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects an unsafe request missing the CSRF header with 403', async () => {
      const admin = await seedUser(ctx, { role: 'admin' });
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { cookie: admin.cookie, 'content-type': 'application/json' },
        payload: { name: 'X', key: 'CSRF' },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
