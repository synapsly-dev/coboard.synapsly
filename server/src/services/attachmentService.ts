import { asc, eq, inArray } from 'drizzle-orm';
import type { Attachment } from 'shared';
import type { Database } from '../db/index.js';
import { commentFiles, ideaFiles } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { publishChange } from './activityService.js';
import { bus, type RealtimeBus } from '../realtime/bus.js';

/**
 * Idea / comment attachment service. Owns the data access for files uploaded
 * against an idea (§7.1) or a comment: batch metadata loads (embedded into the
 * idea/comment wire shapes — never the bytes), byte loads for the download
 * routes, and create/delete with the matching realtime fan-out. Same storage
 * recipe as taskFileService (bytea in-DB, 5MB cap enforced at the route layer);
 * authorization is enforced by the routes.
 */

// ---------------------------------------------------------------------------
// Row -> wire mapping
// ---------------------------------------------------------------------------

interface AttachmentRowLike {
  id: string;
  uploaderId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  createdAt: Date;
}

function toAttachment(row: AttachmentRowLike): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    uploaderId: row.uploaderId,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Batch metadata loads (embedded into list responses)
// ---------------------------------------------------------------------------

/**
 * Load the attachments (metadata only, oldest first) of a set of ideas, keyed by
 * idea id. Ideas without files are simply absent from the map — callers default
 * to []. One query regardless of list size.
 */
export async function listIdeaFilesByIdea(
  db: Database,
  ideaIds: readonly string[],
): Promise<Map<string, Attachment[]>> {
  if (ideaIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: ideaFiles.id,
      ideaId: ideaFiles.ideaId,
      uploaderId: ideaFiles.uploaderId,
      filename: ideaFiles.filename,
      mime: ideaFiles.mime,
      sizeBytes: ideaFiles.sizeBytes,
      createdAt: ideaFiles.createdAt,
    })
    .from(ideaFiles)
    .where(inArray(ideaFiles.ideaId, [...ideaIds]))
    .orderBy(asc(ideaFiles.createdAt));

  const byIdea = new Map<string, Attachment[]>();
  for (const row of rows) {
    const list = byIdea.get(row.ideaId) ?? [];
    list.push(toAttachment(row));
    byIdea.set(row.ideaId, list);
  }
  return byIdea;
}

/** Like {@link listIdeaFilesByIdea}, for comments. */
export async function listCommentFilesByComment(
  db: Database,
  commentIds: readonly string[],
): Promise<Map<string, Attachment[]>> {
  if (commentIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: commentFiles.id,
      commentId: commentFiles.commentId,
      uploaderId: commentFiles.uploaderId,
      filename: commentFiles.filename,
      mime: commentFiles.mime,
      sizeBytes: commentFiles.sizeBytes,
      createdAt: commentFiles.createdAt,
    })
    .from(commentFiles)
    .where(inArray(commentFiles.commentId, [...commentIds]))
    .orderBy(asc(commentFiles.createdAt));

  const byComment = new Map<string, Attachment[]>();
  for (const row of rows) {
    const list = byComment.get(row.commentId) ?? [];
    list.push(toAttachment(row));
    byComment.set(row.commentId, list);
  }
  return byComment;
}

// ---------------------------------------------------------------------------
// Loaders (ownership checks + download bytes)
// ---------------------------------------------------------------------------

export interface AttachmentMeta {
  id: string;
  /** Owning idea/comment id. */
  ownerId: string;
  uploaderId: string;
}

/** Load an idea file's ownership fields (no bytes) or throw 404. */
export async function loadIdeaFileOrThrow(db: Database, fileId: string): Promise<AttachmentMeta> {
  const rows = await db
    .select({ id: ideaFiles.id, ownerId: ideaFiles.ideaId, uploaderId: ideaFiles.uploaderId })
    .from(ideaFiles)
    .where(eq(ideaFiles.id, fileId))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('文件不存在');
  return row;
}

/** Load a comment file's ownership fields (no bytes) or throw 404. */
export async function loadCommentFileOrThrow(
  db: Database,
  fileId: string,
): Promise<AttachmentMeta> {
  const rows = await db
    .select({
      id: commentFiles.id,
      ownerId: commentFiles.commentId,
      uploaderId: commentFiles.uploaderId,
    })
    .from(commentFiles)
    .where(eq(commentFiles.id, fileId))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound('文件不存在');
  return row;
}

export interface AttachmentBytes {
  filename: string;
  mime: string;
  bytes: Buffer;
}

/** Load an idea file's raw bytes for the download route; null when gone. */
export async function getIdeaFileBytes(
  db: Database,
  fileId: string,
): Promise<AttachmentBytes | null> {
  const rows = await db
    .select({ filename: ideaFiles.filename, mime: ideaFiles.mime, data: ideaFiles.data })
    .from(ideaFiles)
    .where(eq(ideaFiles.id, fileId))
    .limit(1);
  const row = rows[0];
  return row ? { filename: row.filename, mime: row.mime, bytes: row.data } : null;
}

/** Load a comment file's raw bytes for the download route; null when gone. */
export async function getCommentFileBytes(
  db: Database,
  fileId: string,
): Promise<AttachmentBytes | null> {
  const rows = await db
    .select({ filename: commentFiles.filename, mime: commentFiles.mime, data: commentFiles.data })
    .from(commentFiles)
    .where(eq(commentFiles.id, fileId))
    .limit(1);
  const row = rows[0];
  return row ? { filename: row.filename, mime: row.mime, bytes: row.data } : null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateAttachmentParams {
  /** Owning idea/comment id. */
  ownerId: string;
  /**
   * Owning task id for the realtime payload — null for a file on a STANDALONE
   * 灵感区 idea.
   */
  taskId: string | null;
  /** Owning project for the realtime channel; null = pool task / standalone idea. */
  projectId: string | null;
  uploaderId: string;
  filename: string;
  mime: string;
  data: Buffer;
}

/**
 * Store an uploaded file against an idea. Publishes an `idea`-entity realtime
 * event (same payload shape as ideaService) so idea lists refresh everywhere.
 */
export async function createIdeaFile(
  db: Database,
  params: CreateAttachmentParams,
  realtimeBus: RealtimeBus = bus,
): Promise<Attachment> {
  const [inserted] = await db
    .insert(ideaFiles)
    .values({
      ideaId: params.ownerId,
      uploaderId: params.uploaderId,
      filename: params.filename,
      mime: params.mime,
      sizeBytes: params.data.length,
      data: params.data,
    })
    .returning({
      id: ideaFiles.id,
      uploaderId: ideaFiles.uploaderId,
      filename: ideaFiles.filename,
      mime: ideaFiles.mime,
      sizeBytes: ideaFiles.sizeBytes,
      createdAt: ideaFiles.createdAt,
    });
  if (!inserted) {
    // Unreachable: insert..returning yields a row on success.
    throw new Error('上传文件失败：未返回插入行');
  }

  publishAttachmentChange(realtimeBus, 'idea', 'idea_file_uploaded', params);
  return toAttachment(inserted);
}

/** Store an uploaded file against a comment (+ `comment`-entity realtime event). */
export async function createCommentFile(
  db: Database,
  params: CreateAttachmentParams,
  realtimeBus: RealtimeBus = bus,
): Promise<Attachment> {
  const [inserted] = await db
    .insert(commentFiles)
    .values({
      commentId: params.ownerId,
      uploaderId: params.uploaderId,
      filename: params.filename,
      mime: params.mime,
      sizeBytes: params.data.length,
      data: params.data,
    })
    .returning({
      id: commentFiles.id,
      uploaderId: commentFiles.uploaderId,
      filename: commentFiles.filename,
      mime: commentFiles.mime,
      sizeBytes: commentFiles.sizeBytes,
      createdAt: commentFiles.createdAt,
    });
  if (!inserted) {
    // Unreachable: insert..returning yields a row on success.
    throw new Error('上传文件失败：未返回插入行');
  }

  publishAttachmentChange(realtimeBus, 'comment', 'comment_file_uploaded', params);
  return toAttachment(inserted);
}

export interface DeleteAttachmentParams {
  fileId: string;
  /** Owning idea/comment id. */
  ownerId: string;
  taskId: string | null;
  projectId: string | null;
}

/** Delete an idea file (authorization enforced by the route) + realtime event. */
export async function deleteIdeaFile(
  db: Database,
  params: DeleteAttachmentParams,
  realtimeBus: RealtimeBus = bus,
): Promise<void> {
  await db.delete(ideaFiles).where(eq(ideaFiles.id, params.fileId));
  publishAttachmentChange(realtimeBus, 'idea', 'idea_file_deleted', params);
}

/** Delete a comment file (authorization enforced by the route) + realtime event. */
export async function deleteCommentFile(
  db: Database,
  params: DeleteAttachmentParams,
  realtimeBus: RealtimeBus = bus,
): Promise<void> {
  await db.delete(commentFiles).where(eq(commentFiles.id, params.fileId));
  publishAttachmentChange(realtimeBus, 'comment', 'comment_file_deleted', params);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Publish the owning entity's realtime event for an attachment change: `idea`
 * events refresh the task's ideas + the 灵感区 list; `comment` events refresh
 * the task's comment thread. Payload key matches the entity's own events.
 */
function publishAttachmentChange(
  realtimeBus: RealtimeBus,
  entity: 'idea' | 'comment',
  type: string,
  params: { ownerId: string; taskId: string | null; projectId: string | null },
): void {
  publishChange(
    {
      type,
      projectId: params.projectId,
      entity,
      payload:
        entity === 'idea'
          ? { ideaId: params.ownerId, taskId: params.taskId }
          : { commentId: params.ownerId, taskId: params.taskId },
    },
    realtimeBus,
  );
}
