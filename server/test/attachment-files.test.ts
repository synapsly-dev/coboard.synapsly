import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ProjectRole } from 'shared';
import type { AttachmentsResponse, CommentsResponse, IdeasResponse } from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/session.js';
import {
  commentFiles,
  comments,
  ideaFiles,
  ideas,
  projectMembers,
  projects,
  tasks,
  users,
  type UserRow,
} from '../src/db/schema.js';

/**
 * Idea / comment attachment tests. Covers upload (author-only) + the metadata
 * embed in the idea/comment wire shapes, byte download with disposition, the
 * standalone-idea visibility rule, the pending-idea freeze, delete permissions,
 * and DB-level cascade when the owning row goes away.
 */

let seq = 0;

async function makeUser(
  ctx: TestContext,
  overrides: Partial<{ role: 'admin' | 'member'; displayName: string }> = {},
): Promise<UserRow> {
  seq += 1;
  const [row] = await ctx.db
    .insert(users)
    .values({
      email: `attach-user${seq}@example.com`,
      passwordHash: 'x',
      displayName: overrides.displayName ?? `用户${seq}`,
      avatarColor: '#3b82f6',
      role: overrides.role ?? 'member',
    })
    .returning();
  if (!row) throw new Error('failed to insert user');
  return row;
}

async function makeProject(ctx: TestContext, createdBy: string): Promise<string> {
  seq += 1;
  const [row] = await ctx.db
    .insert(projects)
    .values({ name: `项目${seq}`, key: `APRJ${seq}`, createdBy })
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

async function makeIdea(
  ctx: TestContext,
  authorId: string,
  taskId: string | null,
  status: 'pending' | 'adopted' | 'rejected' = 'pending',
): Promise<string> {
  const [row] = await ctx.db
    .insert(ideas)
    .values({ taskId, authorId, body: '一个想法', status })
    .returning();
  if (!row) throw new Error('failed to insert idea');
  return row.id;
}

async function makeComment(
  ctx: TestContext,
  taskId: string,
  authorId: string,
): Promise<string> {
  const [row] = await ctx.db
    .insert(comments)
    .values({ taskId, authorId, body: '一条评论', mentions: [] })
    .returning();
  if (!row) throw new Error('failed to insert comment');
  return row.id;
}

async function authCookie(ctx: TestContext, userId: string): Promise<string> {
  const { token } = await createSession(ctx.db, userId);
  const signed = ctx.app.signCookie(token);
  return `${SESSION_COOKIE}=${signed}`;
}

/** Build a multipart/form-data body for `fastify.inject` (raw payload + header). */
function multipartBody(
  filename: string,
  mime: string,
  content: Buffer,
): { payload: Buffer; contentType: string } {
  const boundary = '----coboardattachboundary1234567890';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
    'utf8',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([head, content, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function uploadHeaders(cookie: string, contentType: string): Record<string, string> {
  return { cookie, 'x-requested-with': 'fetch', 'content-type': contentType };
}

function headers(cookie: string): Record<string, string> {
  return { cookie, 'x-requested-with': 'fetch' };
}

async function upload(
  ctx: TestContext,
  cookie: string,
  url: string,
  filename = 'note.txt',
  mime = 'text/plain',
  content = Buffer.from('附件内容', 'utf8'),
): Promise<{ statusCode: number; fileId?: string }> {
  const { payload, contentType } = multipartBody(filename, mime, content);
  const res = await ctx.app.inject({
    method: 'POST',
    url,
    headers: uploadHeaders(cookie, contentType),
    payload,
  });
  const fileId =
    res.statusCode === 201 ? (res.json() as AttachmentsResponse).files[0]?.id : undefined;
  return { statusCode: res.statusCode, fileId };
}

describe('idea / comment attachments', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    await ctx.db.delete(ideaFiles);
    await ctx.db.delete(commentFiles);
    await ctx.db.delete(ideas);
    await ctx.db.delete(comments);
    await ctx.db.delete(tasks);
    await ctx.db.delete(projectMembers);
    await ctx.db.delete(projects);
    await ctx.db.delete(users);
    seq = 0;
  });

  // --- idea files -----------------------------------------------------------

  it('author uploads to a task idea; metadata embeds in GET /tasks/:id/ideas', async () => {
    const author = await makeUser(ctx);
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id);
    const taskId = await makeTask(ctx, projectId, author.id);
    const ideaId = await makeIdea(ctx, author.id, taskId);
    const cookie = await authCookie(ctx, author.id);

    const content = Buffer.from('灵感草图', 'utf8');
    const { statusCode, fileId } = await upload(
      ctx,
      cookie,
      `/api/ideas/${ideaId}/files`,
      '草图.txt',
      'text/plain',
      content,
    );
    expect(statusCode).toBe(201);
    expect(fileId).toBeTruthy();

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/ideas`,
      headers: headers(cookie),
    });
    const listed = (listRes.json() as IdeasResponse).ideas[0]!;
    expect(listed.files).toHaveLength(1);
    expect(listed.files[0]!.filename).toBe('草图.txt');
    expect(listed.files[0]!.sizeBytes).toBe(content.length);
    // The bytes never appear in the metadata shape.
    expect((listed.files[0] as Record<string, unknown>).data).toBeUndefined();
  });

  it('downloads idea file bytes with disposition; any logged-in user can read a standalone idea file', async () => {
    const author = await makeUser(ctx);
    const stranger = await makeUser(ctx); // no shared project
    const ideaId = await makeIdea(ctx, author.id, null); // standalone 灵感区
    const authorCookie = await authCookie(ctx, author.id);
    const strangerCookie = await authCookie(ctx, stranger.id);

    const content = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { fileId } = await upload(
      ctx,
      authorCookie,
      `/api/ideas/${ideaId}/files`,
      '灵感.png',
      'image/png',
      content,
    );

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/ideas/${ideaId}/files/${fileId}`,
      headers: headers(strangerCookie),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain(
      `filename*=UTF-8''${encodeURIComponent('灵感.png')}`,
    );
    expect(Buffer.from(res.rawPayload).equals(content)).toBe(true);

    // ?inline=1 serves the whitelisted mime inline (nosniff).
    const inlineRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/ideas/${ideaId}/files/${fileId}?inline=1`,
      headers: headers(strangerCookie),
    });
    expect(inlineRes.headers['content-disposition']).toContain('inline');
    expect(inlineRes.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects idea uploads from non-authors (403) and on handled ideas (409)', async () => {
    const author = await makeUser(ctx);
    const other = await makeUser(ctx);
    const ideaId = await makeIdea(ctx, author.id, null);
    const adoptedId = await makeIdea(ctx, author.id, null, 'adopted');

    const otherRes = await upload(ctx, await authCookie(ctx, other.id), `/api/ideas/${ideaId}/files`);
    expect(otherRes.statusCode).toBe(403);

    const authorCookie = await authCookie(ctx, author.id);
    const frozenRes = await upload(ctx, authorCookie, `/api/ideas/${adoptedId}/files`);
    expect(frozenRes.statusCode).toBe(409);
  });

  it('forbids task-idea file access for non-members of the project', async () => {
    const author = await makeUser(ctx);
    const outsider = await makeUser(ctx);
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id);
    const taskId = await makeTask(ctx, projectId, author.id);
    const ideaId = await makeIdea(ctx, author.id, taskId);

    const authorCookie = await authCookie(ctx, author.id);
    const { fileId } = await upload(ctx, authorCookie, `/api/ideas/${ideaId}/files`);

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/ideas/${ideaId}/files/${fileId}`,
      headers: headers(await authCookie(ctx, outsider.id)),
    });
    expect(res.statusCode).toBe(403);
  });

  it('idea file delete: uploader while pending; 409 after adoption; admin anytime', async () => {
    const author = await makeUser(ctx);
    const admin = await makeUser(ctx, { role: 'admin' });
    const ideaId = await makeIdea(ctx, author.id, null);
    const authorCookie = await authCookie(ctx, author.id);

    const first = await upload(ctx, authorCookie, `/api/ideas/${ideaId}/files`);
    const second = await upload(ctx, authorCookie, `/api/ideas/${ideaId}/files`);

    // Uploader deletes while pending.
    const del1 = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/ideas/${ideaId}/files/${first.fileId}`,
      headers: headers(authorCookie),
    });
    expect(del1.statusCode).toBe(204);

    // Adopt → author frozen out, admin still may delete.
    await ctx.db.update(ideas).set({ status: 'adopted' }).where(eq(ideas.id, ideaId));
    const del2 = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/ideas/${ideaId}/files/${second.fileId}`,
      headers: headers(authorCookie),
    });
    expect(del2.statusCode).toBe(409);

    const del3 = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/ideas/${ideaId}/files/${second.fileId}`,
      headers: headers(await authCookie(ctx, admin.id)),
    });
    expect(del3.statusCode).toBe(204);
  });

  it('deleting an idea cascades its files away', async () => {
    const author = await makeUser(ctx);
    const ideaId = await makeIdea(ctx, author.id, null);
    const cookie = await authCookie(ctx, author.id);
    await upload(ctx, cookie, `/api/ideas/${ideaId}/files`);

    await ctx.db.delete(ideas).where(eq(ideas.id, ideaId));
    const rows = await ctx.db.select().from(ideaFiles).where(eq(ideaFiles.ideaId, ideaId));
    expect(rows).toHaveLength(0);
  });

  // --- comment files ----------------------------------------------------------

  it('comment author uploads; metadata embeds in GET /tasks/:id/comments; bytes round-trip', async () => {
    const author = await makeUser(ctx);
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id);
    const taskId = await makeTask(ctx, projectId, author.id);
    const commentId = await makeComment(ctx, taskId, author.id);
    const cookie = await authCookie(ctx, author.id);

    const content = Buffer.from([0x01, 0xff, 0x42]);
    const { statusCode, fileId } = await upload(
      ctx,
      cookie,
      `/api/comments/${commentId}/files`,
      '记录.bin',
      'application/octet-stream',
      content,
    );
    expect(statusCode).toBe(201);

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/comments`,
      headers: headers(cookie),
    });
    const listed = (listRes.json() as CommentsResponse).comments[0]!;
    expect(listed.files).toHaveLength(1);
    expect(listed.files[0]!.id).toBe(fileId);

    const dl = await ctx.app.inject({
      method: 'GET',
      url: `/api/comments/${commentId}/files/${fileId}`,
      headers: headers(cookie),
    });
    expect(dl.statusCode).toBe(200);
    expect(Buffer.from(dl.rawPayload).equals(content)).toBe(true);
  });

  it('rejects comment uploads from non-authors (403) and access from non-members (403)', async () => {
    const author = await makeUser(ctx);
    const member = await makeUser(ctx);
    const outsider = await makeUser(ctx);
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id);
    await addMember(ctx, projectId, member.id);
    const taskId = await makeTask(ctx, projectId, author.id);
    const commentId = await makeComment(ctx, taskId, author.id);

    // A fellow member may read the thread but not attach to someone else's comment.
    const memberRes = await upload(
      ctx,
      await authCookie(ctx, member.id),
      `/api/comments/${commentId}/files`,
    );
    expect(memberRes.statusCode).toBe(403);

    const { fileId } = await upload(
      ctx,
      await authCookie(ctx, author.id),
      `/api/comments/${commentId}/files`,
    );
    const outsiderRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/comments/${commentId}/files/${fileId}`,
      headers: headers(await authCookie(ctx, outsider.id)),
    });
    expect(outsiderRes.statusCode).toBe(403);
  });

  it('comment file delete: uploader or lead may; another member may not', async () => {
    const author = await makeUser(ctx);
    const member = await makeUser(ctx);
    const lead = await makeUser(ctx);
    const projectId = await makeProject(ctx, lead.id);
    await addMember(ctx, projectId, author.id);
    await addMember(ctx, projectId, member.id);
    await addMember(ctx, projectId, lead.id, 'lead');
    const taskId = await makeTask(ctx, projectId, lead.id);
    const commentId = await makeComment(ctx, taskId, author.id);
    const authorCookie = await authCookie(ctx, author.id);

    const first = await upload(ctx, authorCookie, `/api/comments/${commentId}/files`);
    const second = await upload(ctx, authorCookie, `/api/comments/${commentId}/files`);

    const memberDel = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/comments/${commentId}/files/${first.fileId}`,
      headers: headers(await authCookie(ctx, member.id)),
    });
    expect(memberDel.statusCode).toBe(403);

    const authorDel = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/comments/${commentId}/files/${first.fileId}`,
      headers: headers(authorCookie),
    });
    expect(authorDel.statusCode).toBe(204);

    const leadDel = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/comments/${commentId}/files/${second.fileId}`,
      headers: headers(await authCookie(ctx, lead.id)),
    });
    expect(leadDel.statusCode).toBe(204);
  });

  it('灵感区 listing includes pool-task ideas for ordinary members (§8 visibility)', async () => {
    const author = await makeUser(ctx);
    const other = await makeUser(ctx); // no shared project with the author
    // A no-project pool task + an idea on it.
    const [poolTask] = await ctx.db
      .insert(tasks)
      .values({ projectId: null, title: '池任务', createdBy: author.id, rank: 'p1' })
      .returning();
    const ideaId = await makeIdea(ctx, author.id, poolTask!.id);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/ideas',
      headers: headers(await authCookie(ctx, other.id)),
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { ideas: { id: string }[] }).ideas.map((i) => i.id);
    expect(ids).toContain(ideaId);
  });

  it('deleting a comment cascades its files away', async () => {
    const author = await makeUser(ctx);
    const projectId = await makeProject(ctx, author.id);
    await addMember(ctx, projectId, author.id);
    const taskId = await makeTask(ctx, projectId, author.id);
    const commentId = await makeComment(ctx, taskId, author.id);
    await upload(ctx, await authCookie(ctx, author.id), `/api/comments/${commentId}/files`);

    await ctx.db.delete(comments).where(eq(comments.id, commentId));
    const rows = await ctx.db
      .select()
      .from(commentFiles)
      .where(eq(commentFiles.commentId, commentId));
    expect(rows).toHaveLength(0);
  });
});
