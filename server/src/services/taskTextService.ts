import { asc, eq } from 'drizzle-orm';
import type { TaskText, UserSummary } from 'shared';
import type { Database } from '../db/index.js';
import { taskTexts, users, type TaskTextRow, type UserRow } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { publishChange } from './activityService.js';
import { bus, type RealtimeBus } from '../realtime/bus.js';

/**
 * Task text-deliverable service (交付内容 §7.2). Owns text deliverables submitted
 * against a task — like attachments but a Markdown text body; multiple per task,
 * each carrying its author. Mirrors taskFileService: any member with task visibility
 * may submit; the author or a project lead/admin may delete (enforced by the route).
 * Mutations publish a `task`-entity realtime event so the drawer refreshes (§6.5).
 */

function toUserSummary(
  u: Pick<UserRow, 'id' | 'displayName' | 'avatarColor' | 'avatarMime'>,
): UserSummary {
  return {
    id: u.id,
    displayName: u.displayName,
    avatarColor: u.avatarColor,
    hasAvatar: u.avatarMime != null,
  };
}

function toTaskText(row: TaskTextRow, author: UserSummary): TaskText {
  return {
    id: row.id,
    taskId: row.taskId,
    author,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

/** List a task's text deliverables (oldest first), each joined with its author. */
export async function listTaskTexts(db: Database, taskId: string): Promise<TaskText[]> {
  const rows = await db
    .select({ text: taskTexts, author: users })
    .from(taskTexts)
    .innerJoin(users, eq(users.id, taskTexts.authorId))
    .where(eq(taskTexts.taskId, taskId))
    .orderBy(asc(taskTexts.createdAt));
  return rows.map((r) => toTaskText(r.text, toUserSummary(r.author)));
}

/** Load a text deliverable's ownership fields by id, or throw 404. */
export async function loadTaskTextOrThrow(
  db: Database,
  textId: string,
): Promise<{ id: string; taskId: string; authorId: string }> {
  const rows = await db
    .select({ id: taskTexts.id, taskId: taskTexts.taskId, authorId: taskTexts.authorId })
    .from(taskTexts)
    .where(eq(taskTexts.id, textId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw notFound('交付内容不存在');
  }
  return row;
}

export interface CreateTaskTextParams {
  taskId: string;
  /** Owning project, or null for a no-project (pool) task (§8). */
  projectId: string | null;
  authorId: string;
  content: string;
}

/** Submit a text deliverable against a task. Returns it with its author summary. */
export async function createTaskText(
  db: Database,
  params: CreateTaskTextParams,
  realtimeBus: RealtimeBus = bus,
): Promise<TaskText> {
  const [inserted] = await db
    .insert(taskTexts)
    .values({ taskId: params.taskId, authorId: params.authorId, content: params.content })
    .returning();
  if (!inserted) {
    throw new Error('提交交付内容失败：未返回插入行');
  }

  const [author] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarColor: users.avatarColor,
      avatarMime: users.avatarMime,
    })
    .from(users)
    .where(eq(users.id, params.authorId))
    .limit(1);
  if (!author) {
    throw new Error('提交交付内容失败：作者不存在');
  }

  publishTaskTextChange(realtimeBus, 'text_delivered', params.projectId, params.taskId);
  return toTaskText(inserted, toUserSummary(author));
}

/** Delete a text deliverable (author / project lead / global admin — route-enforced). */
export async function deleteTaskText(
  db: Database,
  text: { id: string; taskId: string },
  projectId: string | null,
  realtimeBus: RealtimeBus = bus,
): Promise<void> {
  await db.delete(taskTexts).where(eq(taskTexts.id, text.id));
  publishTaskTextChange(realtimeBus, 'text_deleted', projectId, text.taskId);
}

/** Publish a `task`-entity realtime event so peers refresh the task's deliverables. */
function publishTaskTextChange(
  realtimeBus: RealtimeBus,
  type: string,
  projectId: string | null,
  taskId: string,
): void {
  publishChange({ type, projectId, entity: 'task', payload: { taskId } }, realtimeBus);
}
