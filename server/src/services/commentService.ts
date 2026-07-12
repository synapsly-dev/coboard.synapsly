import { asc, eq } from 'drizzle-orm';
import type {
  ActivityWithActor,
  Attachment,
  CommentWithAuthor,
  User,
} from 'shared';
import type { Database } from '../db/index.js';
import {
  activities,
  comments,
  tasks,
  users,
  type ActivityRow,
  type CommentRow,
  type TaskRow,
  type UserRow,
} from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { publishChange, recordActivity } from './activityService.js';
import { listCommentFilesByComment } from './attachmentService.js';
import type { RealtimeBus } from '../realtime/bus.js';
import { bus } from '../realtime/bus.js';

/**
 * Comments & activity-feed service (§5, §6.5, §7). Handles listing/creating/
 * editing/deleting comments on a task and listing the task's activity timeline.
 * Authorization (project membership, author-only edits) is enforced by the route
 * via guards; this layer owns the data access, @mention parsing, activity
 * recording, and realtime fan-out. This module is owned by the comments agent.
 */

// ---------------------------------------------------------------------------
// Mention parsing
// ---------------------------------------------------------------------------

/**
 * Match `@<uuid>` mention tokens embedded in a comment body. The composer encodes
 * a mention as `@<userId>` (a v4-style uuid). We accept any uuid shape here and
 * intersect against real project members downstream so unknown ids are dropped.
 */
const MENTION_PATTERN =
  /@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g;

/**
 * Extract mentioned user ids from a markdown body and merge them with any
 * explicit `mentions` supplied by the client. Returns a de-duplicated,
 * lower-cased list. The route validates membership of the resulting ids.
 */
export function parseMentions(body: string, explicit: readonly string[] = []): string[] {
  const found = new Set<string>();
  for (const id of explicit) {
    found.add(id.toLowerCase());
  }
  for (const match of body.matchAll(MENTION_PATTERN)) {
    const id = match[1];
    if (id) found.add(id.toLowerCase());
  }
  return [...found];
}

/**
 * Of `candidateIds`, keep only those that are active users. Keeps stored
 * `mentions` referentially clean (so a stale @mention never points at a deleted
 * account). Returns ids in a stable, de-duplicated order.
 */
export async function filterValidMentions(
  db: Database,
  candidateIds: readonly string[],
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const unique = [...new Set(candidateIds.map((id) => id.toLowerCase()))];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isActive, true));
  const existing = new Set(rows.map((r) => r.id.toLowerCase()));
  return unique.filter((id) => existing.has(id));
}

// ---------------------------------------------------------------------------
// Row -> wire mapping
// ---------------------------------------------------------------------------

/** Map a user row to the public-safe wire shape (drops password_hash). */
function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarColor: row.avatarColor,
    role: row.role,
    isActive: row.isActive,
    hasAvatar: row.avatarMime != null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Map a comment row + its author (+ attachments) to the §7 `CommentWithAuthor` wire shape. */
function toCommentWithAuthor(
  row: CommentRow,
  author: UserRow,
  files: Attachment[] = [],
): CommentWithAuthor {
  return {
    id: row.id,
    taskId: row.taskId,
    authorId: row.authorId,
    body: row.body,
    mentions: row.mentions,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    author: toUser(author),
    files,
  };
}

/** Map an activity row + its actor to the §7 `ActivityWithActor` wire shape. */
function toActivityWithActor(row: ActivityRow, actor: UserRow): ActivityWithActor {
  return {
    id: row.id,
    taskId: row.taskId,
    projectId: row.projectId,
    actorId: row.actorId,
    type: row.type,
    meta: row.meta as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    actor: toUser(actor),
  };
}

// ---------------------------------------------------------------------------
// Task / comment loaders
// ---------------------------------------------------------------------------

/** Load a task by id or throw 404. Used to resolve the owning project. */
export async function loadTaskOrThrow(db: Database, taskId: string): Promise<TaskRow> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) {
    throw notFound('任务不存在');
  }
  return task;
}

/** Load a comment by id or throw 404. */
export async function loadCommentOrThrow(
  db: Database,
  commentId: string,
): Promise<CommentRow> {
  const rows = await db
    .select()
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1);
  const comment = rows[0];
  if (!comment) {
    throw notFound('评论不存在');
  }
  return comment;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List a task's comments (oldest first) joined with their authors (§7). */
export async function listComments(
  db: Database,
  taskId: string,
): Promise<CommentWithAuthor[]> {
  const rows = await db
    .select({ comment: comments, author: users })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(eq(comments.taskId, taskId))
    .orderBy(asc(comments.createdAt));
  const filesByComment = await listCommentFilesByComment(db, rows.map((r) => r.comment.id));
  return rows.map((r) =>
    toCommentWithAuthor(r.comment, r.author, filesByComment.get(r.comment.id) ?? []),
  );
}

/** List a task's activity timeline (oldest first) joined with actors (§7). */
export async function listActivities(
  db: Database,
  taskId: string,
): Promise<ActivityWithActor[]> {
  const rows = await db
    .select({ activity: activities, actor: users })
    .from(activities)
    .innerJoin(users, eq(activities.actorId, users.id))
    .where(eq(activities.taskId, taskId))
    .orderBy(asc(activities.createdAt));
  return rows.map((r) => toActivityWithActor(r.activity, r.actor));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateCommentParams {
  task: TaskRow;
  authorId: string;
  body: string;
  /** Explicit mentions from the client; merged with body-parsed @mentions. */
  explicitMentions?: readonly string[];
}

/**
 * Create a comment on a task, record a `commented` activity, and publish realtime
 * events for both the comment and the activity (§6.2, §6.5). Returns the new
 * comment joined with its author. The body's @mentions are parsed, merged with
 * any explicit mentions, and filtered to real active users.
 */
export async function createComment(
  db: Database,
  params: CreateCommentParams,
  realtimeBus: RealtimeBus = bus,
): Promise<CommentWithAuthor> {
  const { task, authorId, body } = params;

  const mentions = await filterValidMentions(
    db,
    parseMentions(body, params.explicitMentions ?? []),
  );

  const [inserted] = await db
    .insert(comments)
    .values({
      taskId: task.id,
      authorId,
      body,
      mentions,
    })
    .returning();

  if (!inserted) {
    // Unreachable: insert..returning yields a row on success.
    throw new Error('创建评论失败：未返回插入行');
  }

  const author = await loadUserOrThrow(db, authorId);

  // Record the activity (also publishes an `activity`-entity realtime event).
  await recordActivity(
    db,
    {
      taskId: task.id,
      projectId: task.projectId,
      actorId: authorId,
      type: 'commented',
      meta: { commentId: inserted.id },
    },
    realtimeBus,
  );

  // Publish a comment-entity event so clients refresh the comment list (§6.5).
  publishChange(
    {
      type: 'commented',
      projectId: task.projectId,
      entity: 'comment',
      payload: { commentId: inserted.id, taskId: task.id, authorId },
    },
    realtimeBus,
  );

  return toCommentWithAuthor(inserted, author);
}

export interface UpdateCommentParams {
  comment: CommentRow;
  task: TaskRow;
  body: string;
  explicitMentions?: readonly string[];
}

/**
 * Edit a comment's body (author-only; the route enforces authorship). Re-parses
 * @mentions, stamps `edited_at`, and publishes a comment-entity realtime event.
 */
export async function updateComment(
  db: Database,
  params: UpdateCommentParams,
  realtimeBus: RealtimeBus = bus,
): Promise<CommentWithAuthor> {
  const { comment, task, body } = params;

  const mentions = await filterValidMentions(
    db,
    parseMentions(body, params.explicitMentions ?? []),
  );

  const [updated] = await db
    .update(comments)
    .set({ body, mentions, editedAt: new Date() })
    .where(eq(comments.id, comment.id))
    .returning();

  if (!updated) {
    // Unreachable: the route loads the comment before calling this.
    throw notFound('评论不存在');
  }

  const author = await loadUserOrThrow(db, updated.authorId);

  publishChange(
    {
      type: 'comment_updated',
      projectId: task.projectId,
      entity: 'comment',
      payload: { commentId: updated.id, taskId: task.id },
    },
    realtimeBus,
  );

  const files = (await listCommentFilesByComment(db, [updated.id])).get(updated.id) ?? [];
  return toCommentWithAuthor(updated, author, files);
}

/**
 * Delete a comment (author / project lead / global admin; the route enforces
 * permission). Publishes a comment-entity realtime event.
 */
export async function deleteComment(
  db: Database,
  comment: CommentRow,
  task: TaskRow,
  realtimeBus: RealtimeBus = bus,
): Promise<void> {
  await db.delete(comments).where(eq(comments.id, comment.id));

  publishChange(
    {
      type: 'comment_deleted',
      projectId: task.projectId,
      entity: 'comment',
      payload: { commentId: comment.id, taskId: task.id },
    },
    realtimeBus,
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Load a user row by id or throw 404 (author of a just-written comment). */
async function loadUserOrThrow(db: Database, userId: string): Promise<UserRow> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) {
    throw notFound('用户不存在');
  }
  return user;
}
