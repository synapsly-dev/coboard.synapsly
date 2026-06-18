import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ProjectRole, TaskTextsResponse } from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/session.js';
import { projectMembers, projects, tasks, taskTexts, users, type UserRow } from '../src/db/schema.js';

/**
 * Task text-deliverable tests (交付内容 §7.2). Covers submit (stores + lists with
 * author), multiple per task, delete permissions (author / lead / admin; a random
 * member gets 403), validation, and that a non-member can't read/submit.
 */

let seq = 0;

async function makeUser(ctx: TestContext, role: 'admin' | 'member' = 'member'): Promise<UserRow> {
  seq += 1;
  const [row] = await ctx.db
    .insert(users)
    .values({
      email: `text-user${seq}@example.com`,
      passwordHash: 'x',
      displayName: `用户${seq}`,
      avatarColor: '#3b82f6',
      role,
    })
    .returning();
  if (!row) throw new Error('failed to insert user');
  return row;
}

async function makeProject(ctx: TestContext, createdBy: string): Promise<string> {
  seq += 1;
  const [row] = await ctx.db
    .insert(projects)
    .values({ name: `项目${seq}`, key: `TPRJ${seq}`, createdBy })
    .returning();
  if (!row) throw new Error('failed to insert project');
  return row.id;
}

async function addMember(
  ctx: TestContext,
  projectId: string,
  userId: string,
  role: ProjectRole = 'member',
): Promise<void> {
  await ctx.db.insert(projectMembers).values({ projectId, userId, role });
}

async function makeTask(ctx: TestContext, projectId: string, createdBy: string): Promise<string> {
  seq += 1;
  const [row] = await ctx.db
    .insert(tasks)
    .values({ projectId, title: `任务${seq}`, createdBy, rank: `a${seq}` })
    .returning();
  if (!row) throw new Error('failed to insert task');
  return row.id;
}

async function authCookie(ctx: TestContext, userId: string): Promise<string> {
  const { token } = await createSession(ctx.db, userId);
  return `${SESSION_COOKIE}=${ctx.app.signCookie(token)}`;
}

function headers(cookie: string): Record<string, string> {
  return { cookie, 'x-requested-with': 'fetch' };
}

describe('task text deliverables (交付内容)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.cleanup();
  });
  afterEach(async () => {
    await ctx.db.delete(taskTexts);
  });

  async function setup() {
    const author = await makeUser(ctx, 'member');
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id, 'member');
    const taskId = await makeTask(ctx, projectId, author.id);
    return { author, projectId, taskId };
  }

  it('submits a text deliverable and lists it back with its author', async () => {
    const { author, taskId } = await setup();
    const cookie = await authCookie(ctx, author.id);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/texts`,
      headers: headers(cookie),
      payload: { content: '已完成接口，详见 **README**。' },
    });
    expect(res.statusCode).toBe(201);
    const created = (res.json() as TaskTextsResponse).texts[0]!;
    expect(created.content).toContain('README');
    expect(created.author.id).toBe(author.id);
    expect(typeof created.author.displayName).toBe('string');

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/texts`,
      headers: headers(cookie),
    });
    expect(listRes.statusCode).toBe(200);
    const list = (listRes.json() as TaskTextsResponse).texts;
    expect(list).toHaveLength(1);
    expect(list[0]!.author.id).toBe(author.id);
  });

  it('allows multiple text deliverables per task (oldest first)', async () => {
    const { author, taskId } = await setup();
    const cookie = await authCookie(ctx, author.id);
    const post = (content: string) =>
      ctx.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/texts`, headers: headers(cookie), payload: { content } });
    await post('第一条');
    await post('第二条');

    const list = (
      (await ctx.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/texts`, headers: headers(cookie) })).json() as TaskTextsResponse
    ).texts;
    expect(list.map((t) => t.content)).toEqual(['第一条', '第二条']);
  });

  it('rejects empty content (400)', async () => {
    const { author, taskId } = await setup();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/texts`,
      headers: headers(await authCookie(ctx, author.id)),
      payload: { content: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('lets the author delete their own deliverable', async () => {
    const { author, taskId } = await setup();
    const cookie = await authCookie(ctx, author.id);
    const id = (
      (await ctx.app.inject({ method: 'POST', url: `/api/tasks/${taskId}/texts`, headers: headers(cookie), payload: { content: 'x' } })).json() as TaskTextsResponse
    ).texts[0]!.id;

    const del = await ctx.app.inject({ method: 'DELETE', url: `/api/tasks/${taskId}/texts/${id}`, headers: headers(cookie) });
    expect(del.statusCode).toBe(204);
    const list = (
      (await ctx.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/texts`, headers: headers(cookie) })).json() as TaskTextsResponse
    ).texts;
    expect(list).toHaveLength(0);
  });

  it('forbids a different member from deleting (403); lets a lead delete any', async () => {
    const { author, projectId, taskId } = await setup();
    const other = await makeUser(ctx, 'member');
    await addMember(ctx, projectId, other.id, 'member');
    const lead = await makeUser(ctx, 'member');
    await addMember(ctx, projectId, lead.id, 'lead');

    const id = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/tasks/${taskId}/texts`,
          headers: headers(await authCookie(ctx, author.id)),
          payload: { content: 'x' },
        })
      ).json() as TaskTextsResponse
    ).texts[0]!.id;

    const otherDel = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}/texts/${id}`,
      headers: headers(await authCookie(ctx, other.id)),
    });
    expect(otherDel.statusCode).toBe(403);

    const leadDel = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}/texts/${id}`,
      headers: headers(await authCookie(ctx, lead.id)),
    });
    expect(leadDel.statusCode).toBe(204);
  });

  it('freezes text deliverables on a completed task — submit + delete both 409', async () => {
    const { author, taskId } = await setup();
    const cookie = await authCookie(ctx, author.id);
    const id = (
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/tasks/${taskId}/texts`,
          headers: headers(cookie),
          payload: { content: '交付一' },
        })
      ).json() as TaskTextsResponse
    ).texts[0]!.id;

    await ctx.db.update(tasks).set({ status: 'done' }).where(eq(tasks.id, taskId));

    const submit = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/texts`,
      headers: headers(cookie),
      payload: { content: '交付二' },
    });
    expect(submit.statusCode).toBe(409);

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}/texts/${id}`,
      headers: headers(cookie),
    });
    expect(del.statusCode).toBe(409);
  });

  it('forbids a non-member from reading or submitting (403)', async () => {
    const { taskId } = await setup();
    const outsider = await makeUser(ctx, 'member');
    const cookie = await authCookie(ctx, outsider.id);

    const read = await ctx.app.inject({ method: 'GET', url: `/api/tasks/${taskId}/texts`, headers: headers(cookie) });
    expect(read.statusCode).toBe(403);
    const submit = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/texts`,
      headers: headers(cookie),
      payload: { content: 'x' },
    });
    expect(submit.statusCode).toBe(403);
  });
});
