import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ProjectRole, TaskFilesResponse } from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/session.js';
import {
  projectMembers,
  projects,
  taskFiles,
  tasks,
  users,
  type UserRow,
} from '../src/db/schema.js';

/**
 * Task file / attachment tests (§7.2). Covers multipart upload (stores the file +
 * appears in the metadata list), download (returns the bytes + content-type +
 * disposition), the 5MB cap (>5MB is rejected), and deletion permissions (uploader
 * may delete; a random member gets 403; a non-member gets 403 everywhere).
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
      email: `file-user${seq}@example.com`,
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
    .values({ name: `项目${seq}`, key: `FPRJ${seq}`, createdBy })
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

async function makeTask(
  ctx: TestContext,
  projectId: string,
  createdBy: string,
): Promise<string> {
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
  const signed = ctx.app.signCookie(token);
  return `${SESSION_COOKIE}=${signed}`;
}

/**
 * Build a multipart/form-data body for `fastify.inject`. Returns the raw payload
 * Buffer + the matching Content-Type header (with the boundary).
 */
function multipartBody(
  field: string,
  filename: string,
  mime: string,
  content: Buffer,
): { payload: Buffer; contentType: string } {
  const boundary = '----coboardtestboundary1234567890';
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
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

describe('task files / attachments', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    await ctx.db.delete(taskFiles);
    await ctx.db.delete(tasks);
    await ctx.db.delete(projectMembers);
    await ctx.db.delete(projects);
    await ctx.db.delete(users);
    seq = 0;
  });

  it('uploads a file and lists it back (metadata only)', async () => {
    const uploader = await makeUser(ctx);
    const projectId = await makeProject(ctx, uploader.id);
    await addMember(ctx, projectId, uploader.id, 'member');
    const taskId = await makeTask(ctx, projectId, uploader.id);
    const cookie = await authCookie(ctx, uploader.id);

    const content = Buffer.from('hello, 交付文件 content', 'utf8');
    const { payload, contentType } = multipartBody(
      'file',
      'deliver.txt',
      'text/plain',
      content,
    );

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/files`,
      headers: uploadHeaders(cookie, contentType),
      payload,
    });
    expect(uploadRes.statusCode).toBe(201);
    const uploaded = uploadRes.json() as TaskFilesResponse;
    expect(uploaded.files).toHaveLength(1);
    const file = uploaded.files[0]!;
    expect(file.filename).toBe('deliver.txt');
    expect(file.mime).toBe('text/plain');
    expect(file.sizeBytes).toBe(content.length);
    expect(file.uploaderId).toBe(uploader.id);
    // The bytes never appear in the metadata shape.
    expect((file as Record<string, unknown>).data).toBeUndefined();

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/files`,
      headers: headers(cookie),
    });
    expect(listRes.statusCode).toBe(200);
    const listed = listRes.json() as TaskFilesResponse;
    expect(listed.files).toHaveLength(1);
    expect(listed.files[0]?.id).toBe(file.id);
  });

  it('downloads the stored bytes with content-type + disposition', async () => {
    const uploader = await makeUser(ctx);
    const projectId = await makeProject(ctx, uploader.id);
    await addMember(ctx, projectId, uploader.id, 'member');
    const taskId = await makeTask(ctx, projectId, uploader.id);
    const cookie = await authCookie(ctx, uploader.id);

    const content = Buffer.from([0x01, 0x02, 0x03, 0xff, 0x00, 0x42]);
    const { payload, contentType } = multipartBody(
      'file',
      '附件.bin',
      'application/octet-stream',
      content,
    );

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/files`,
      headers: uploadHeaders(cookie, contentType),
      payload,
    });
    const fileId = (uploadRes.json() as TaskFilesResponse).files[0]!.id;

    const downloadRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/files/${fileId}`,
      headers: headers(cookie),
    });
    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.headers['content-type']).toContain('application/octet-stream');
    const disposition = downloadRes.headers['content-disposition'] as string;
    expect(disposition).toContain('attachment');
    // The non-ASCII filename is carried via the RFC 5987 filename* form.
    expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent('附件.bin')}`);
    // Raw bytes round-trip exactly.
    expect(Buffer.from(downloadRes.rawPayload).equals(content)).toBe(true);
  });

  it('rejects a file larger than 5MB', async () => {
    const uploader = await makeUser(ctx);
    const projectId = await makeProject(ctx, uploader.id);
    await addMember(ctx, projectId, uploader.id, 'member');
    const taskId = await makeTask(ctx, projectId, uploader.id);
    const cookie = await authCookie(ctx, uploader.id);

    // 5MB + 1KB of bytes — over the cap.
    const oversize = Buffer.alloc(5 * 1024 * 1024 + 1024, 0x61);
    const { payload, contentType } = multipartBody(
      'file',
      'big.bin',
      'application/octet-stream',
      oversize,
    );

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/files`,
      headers: uploadHeaders(cookie, contentType),
      payload,
    });
    expect(uploadRes.statusCode).toBe(413);

    // Nothing was stored.
    const rows = await ctx.db.select().from(taskFiles).where(eq(taskFiles.taskId, taskId));
    expect(rows).toHaveLength(0);
  });

  it('lets the uploader delete their file', async () => {
    const uploader = await makeUser(ctx);
    const projectId = await makeProject(ctx, uploader.id);
    await addMember(ctx, projectId, uploader.id, 'member');
    const taskId = await makeTask(ctx, projectId, uploader.id);
    const cookie = await authCookie(ctx, uploader.id);

    const { payload, contentType } = multipartBody(
      'file',
      'mine.txt',
      'text/plain',
      Buffer.from('mine', 'utf8'),
    );
    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/files`,
      headers: uploadHeaders(cookie, contentType),
      payload,
    });
    const fileId = (uploadRes.json() as TaskFilesResponse).files[0]!.id;

    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}/files/${fileId}`,
      headers: headers(cookie),
    });
    expect(delRes.statusCode).toBe(204);

    const rows = await ctx.db.select().from(taskFiles).where(eq(taskFiles.id, fileId));
    expect(rows).toHaveLength(0);
  });

  it('forbids a random member from deleting someone else\'s file (403)', async () => {
    const uploader = await makeUser(ctx);
    const other = await makeUser(ctx);
    const projectId = await makeProject(ctx, uploader.id);
    await addMember(ctx, projectId, uploader.id, 'member');
    await addMember(ctx, projectId, other.id, 'member');
    const taskId = await makeTask(ctx, projectId, uploader.id);
    const uploaderCookie = await authCookie(ctx, uploader.id);
    const otherCookie = await authCookie(ctx, other.id);

    const { payload, contentType } = multipartBody(
      'file',
      'mine.txt',
      'text/plain',
      Buffer.from('mine', 'utf8'),
    );
    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/files`,
      headers: uploadHeaders(uploaderCookie, contentType),
      payload,
    });
    const fileId = (uploadRes.json() as TaskFilesResponse).files[0]!.id;

    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}/files/${fileId}`,
      headers: headers(otherCookie),
    });
    expect(delRes.statusCode).toBe(403);

    // The file survives.
    const rows = await ctx.db.select().from(taskFiles).where(eq(taskFiles.id, fileId));
    expect(rows).toHaveLength(1);
  });

  it('lets a project lead delete any file', async () => {
    const lead = await makeUser(ctx);
    const member = await makeUser(ctx);
    const projectId = await makeProject(ctx, lead.id);
    await addMember(ctx, projectId, lead.id, 'lead');
    await addMember(ctx, projectId, member.id, 'member');
    const taskId = await makeTask(ctx, projectId, lead.id);
    const memberCookie = await authCookie(ctx, member.id);
    const leadCookie = await authCookie(ctx, lead.id);

    const { payload, contentType } = multipartBody(
      'file',
      'theirs.txt',
      'text/plain',
      Buffer.from('theirs', 'utf8'),
    );
    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/files`,
      headers: uploadHeaders(memberCookie, contentType),
      payload,
    });
    const fileId = (uploadRes.json() as TaskFilesResponse).files[0]!.id;

    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}/files/${fileId}`,
      headers: headers(leadCookie),
    });
    expect(delRes.statusCode).toBe(204);
  });

  it('forbids a non-member from uploading, listing, downloading, or deleting (403)', async () => {
    const owner = await makeUser(ctx);
    const outsider = await makeUser(ctx);
    const projectId = await makeProject(ctx, owner.id);
    await addMember(ctx, projectId, owner.id, 'member');
    const taskId = await makeTask(ctx, projectId, owner.id);
    const ownerCookie = await authCookie(ctx, owner.id);
    const outsiderCookie = await authCookie(ctx, outsider.id);

    // Owner uploads a file first.
    const { payload, contentType } = multipartBody(
      'file',
      'secret.txt',
      'text/plain',
      Buffer.from('secret', 'utf8'),
    );
    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/files`,
      headers: uploadHeaders(ownerCookie, contentType),
      payload,
    });
    const fileId = (uploadRes.json() as TaskFilesResponse).files[0]!.id;

    const listRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/files`,
      headers: headers(outsiderCookie),
    });
    expect(listRes.statusCode).toBe(403);

    const downloadRes = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/files/${fileId}`,
      headers: headers(outsiderCookie),
    });
    expect(downloadRes.statusCode).toBe(403);

    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}/files/${fileId}`,
      headers: headers(outsiderCookie),
    });
    expect(delRes.statusCode).toBe(403);

    const outsiderUpload = multipartBody(
      'file',
      'intrude.txt',
      'text/plain',
      Buffer.from('intrude', 'utf8'),
    );
    const uploadForbidden = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/files`,
      headers: uploadHeaders(outsiderCookie, outsiderUpload.contentType),
      payload: outsiderUpload.payload,
    });
    expect(uploadForbidden.statusCode).toBe(403);
  });
});
