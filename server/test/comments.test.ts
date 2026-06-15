import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  ActivitiesResponse,
  CommentsResponse,
  ProjectRole,
} from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/session.js';
import {
  activities,
  comments,
  projectMembers,
  projects,
  tasks,
  users,
  type UserRow,
} from '../src/db/schema.js';

/**
 * Comments & activity-feed tests (§6.5, §7, §10). Exercises the happy paths and
 * the key authorization rules: post/list a comment, author-only edits, the
 * `commented` activity recorded on create, and project-member gating.
 */

let seq = 0;

/** Insert a user row and return it. */
async function makeUser(
  ctx: TestContext,
  overrides: Partial<{ role: 'admin' | 'member'; displayName: string }> = {},
): Promise<UserRow> {
  seq += 1;
  const [row] = await ctx.db
    .insert(users)
    .values({
      email: `user${seq}@example.com`,
      passwordHash: 'x',
      displayName: overrides.displayName ?? `用户${seq}`,
      avatarColor: '#3b82f6',
      role: overrides.role ?? 'member',
    })
    .returning();
  if (!row) throw new Error('failed to insert user');
  return row;
}

/** Insert a project and return its id. */
async function makeProject(ctx: TestContext, createdBy: string): Promise<string> {
  seq += 1;
  const [row] = await ctx.db
    .insert(projects)
    .values({
      name: `项目${seq}`,
      key: `PRJ${seq}`,
      createdBy,
    })
    .returning();
  if (!row) throw new Error('failed to insert project');
  return row.id;
}

/** Add a project membership. */
async function addMember(
  ctx: TestContext,
  projectId: string,
  userId: string,
  role: ProjectRole = 'member',
): Promise<void> {
  await ctx.db.insert(projectMembers).values({ projectId, userId, role });
}

/** Insert a task in a project and return its id. */
async function makeTask(
  ctx: TestContext,
  projectId: string,
  createdBy: string,
): Promise<string> {
  seq += 1;
  const [row] = await ctx.db
    .insert(tasks)
    .values({
      projectId,
      title: `任务${seq}`,
      createdBy,
      rank: 'a0',
    })
    .returning();
  if (!row) throw new Error('failed to insert task');
  return row.id;
}

/** Build a signed session cookie for a user (matches the auth pre-handler). */
async function authCookie(ctx: TestContext, userId: string): Promise<string> {
  const { token } = await createSession(ctx.db, userId);
  const signed = ctx.app.signCookie(token);
  return `${SESSION_COOKIE}=${signed}`;
}

/** Headers carrying auth + the required CSRF header for unsafe methods. */
function headers(cookie: string): Record<string, string> {
  return { cookie, 'x-requested-with': 'fetch' };
}

describe('comments & activities', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    // Order matters: activities/comments reference tasks/projects/users.
    await ctx.db.delete(activities);
    await ctx.db.delete(comments);
    await ctx.db.delete(tasks);
    await ctx.db.delete(projectMembers);
    await ctx.db.delete(projects);
    await ctx.db.delete(users);
  });

  it('posts a comment and lists it back', async () => {
    const author = await makeUser(ctx);
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id, 'member');
    const taskId = await makeTask(ctx, projectId, author.id);
    const cookie = await authCookie(ctx, author.id);

    const postRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/comments`,
      headers: headers(cookie),
      payload: { body: '第一条评论' },
    });
    expect(postRes.statusCode).toBe(201);
    const posted = postRes.json() as CommentsResponse;
    expect(posted.comments).toHaveLength(1);
    expect(posted.comments[0]?.body).toBe('第一条评论');
    expect(posted.comments[0]?.authorId).toBe(author.id);
    expect(posted.comments[0]?.author.id).toBe(author.id);

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/comments`,
      headers: headers(cookie),
    });
    expect(listRes.statusCode).toBe(200);
    const listed = listRes.json() as CommentsResponse;
    expect(listed.comments).toHaveLength(1);
    expect(listed.comments[0]?.body).toBe('第一条评论');
  });

  it('parses @mentions in the body into the mentions array', async () => {
    const author = await makeUser(ctx);
    const mentioned = await makeUser(ctx);
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id, 'member');
    const taskId = await makeTask(ctx, projectId, author.id);
    const cookie = await authCookie(ctx, author.id);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/comments`,
      headers: headers(cookie),
      payload: { body: `请看一下 @${mentioned.id} 谢谢` },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as CommentsResponse;
    expect(body.comments[0]?.mentions).toContain(mentioned.id.toLowerCase());
  });

  it('records a `commented` activity on comment create', async () => {
    const author = await makeUser(ctx);
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id, 'member');
    const taskId = await makeTask(ctx, projectId, author.id);
    const cookie = await authCookie(ctx, author.id);

    await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/comments`,
      headers: headers(cookie),
      payload: { body: '触发活动' },
    });

    const rows = await ctx.db
      .select()
      .from(activities)
      .where(eq(activities.taskId, taskId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('commented');
    expect(rows[0]?.actorId).toBe(author.id);

    const actRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/activities`,
      headers: headers(cookie),
    });
    expect(actRes.statusCode).toBe(200);
    const activitiesBody = actRes.json() as ActivitiesResponse;
    expect(activitiesBody.activities).toHaveLength(1);
    expect(activitiesBody.activities[0]?.type).toBe('commented');
    expect(activitiesBody.activities[0]?.actor.id).toBe(author.id);
  });

  it('publishes a realtime event on comment create', async () => {
    const author = await makeUser(ctx);
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id, 'member');
    const taskId = await makeTask(ctx, projectId, author.id);
    const cookie = await authCookie(ctx, author.id);

    const received: string[] = [];
    const unsubscribe = ctx.bus.subscribe([projectId], (event) => {
      received.push(event.entity);
    });

    await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/comments`,
      headers: headers(cookie),
      payload: { body: '广播一下' },
    });
    unsubscribe();

    // recordActivity fans out an `activity` event; the service also fans out a
    // `comment` event so the client refreshes the comment list (§6.5).
    expect(received).toContain('comment');
    expect(received).toContain('activity');
  });

  it('lets only the author edit their comment', async () => {
    const author = await makeUser(ctx);
    const other = await makeUser(ctx);
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id, 'member');
    await addMember(ctx, projectId, other.id, 'member');
    const taskId = await makeTask(ctx, projectId, author.id);
    const authorCookie = await authCookie(ctx, author.id);
    const otherCookie = await authCookie(ctx, other.id);

    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/comments`,
      headers: headers(authorCookie),
      payload: { body: '原始内容' },
    });
    const commentId = (created.json() as CommentsResponse).comments[0]?.id;
    expect(commentId).toBeDefined();

    // A different member cannot edit.
    const forbiddenRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/comments/${commentId}`,
      headers: headers(otherCookie),
      payload: { body: '篡改内容' },
    });
    expect(forbiddenRes.statusCode).toBe(403);

    // The author can edit; edited_at is stamped.
    const okRes = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/comments/${commentId}`,
      headers: headers(authorCookie),
      payload: { body: '修改后的内容' },
    });
    expect(okRes.statusCode).toBe(200);
    const edited = okRes.json() as CommentsResponse;
    expect(edited.comments[0]?.body).toBe('修改后的内容');
    expect(edited.comments[0]?.editedAt).not.toBeNull();
  });

  it('lets a project lead delete another member\'s comment', async () => {
    const lead = await makeUser(ctx);
    const member = await makeUser(ctx);
    const projectId = await makeProject(ctx, lead.id);
    await addMember(ctx, projectId, lead.id, 'lead');
    await addMember(ctx, projectId, member.id, 'member');
    const taskId = await makeTask(ctx, projectId, lead.id);
    const memberCookie = await authCookie(ctx, member.id);
    const leadCookie = await authCookie(ctx, lead.id);

    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/comments`,
      headers: headers(memberCookie),
      payload: { body: '成员评论' },
    });
    const commentId = (created.json() as CommentsResponse).comments[0]?.id;

    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/comments/${commentId}`,
      headers: headers(leadCookie),
    });
    expect(delRes.statusCode).toBe(204);

    const remaining = await ctx.db
      .select()
      .from(comments)
      .where(eq(comments.taskId, taskId));
    expect(remaining).toHaveLength(0);
  });

  it('forbids non-members from reading or commenting', async () => {
    const owner = await makeUser(ctx);
    const outsider = await makeUser(ctx);
    const projectId = await makeProject(ctx, owner.id);
    await addMember(ctx, projectId, owner.id, 'member');
    const taskId = await makeTask(ctx, projectId, owner.id);
    const outsiderCookie = await authCookie(ctx, outsider.id);

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/comments`,
      headers: headers(outsiderCookie),
    });
    expect(listRes.statusCode).toBe(403);

    const postRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/comments`,
      headers: headers(outsiderCookie),
      payload: { body: '我不该看到这个项目' },
    });
    expect(postRes.statusCode).toBe(403);
  });

  it('requires authentication', async () => {
    const author = await makeUser(ctx);
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id, 'member');
    const taskId = await makeTask(ctx, projectId, author.id);

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/comments`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects an empty comment body with 400', async () => {
    const author = await makeUser(ctx);
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id, 'member');
    const taskId = await makeTask(ctx, projectId, author.id);
    const cookie = await authCookie(ctx, author.id);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/comments`,
      headers: headers(cookie),
      payload: { body: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });
});
