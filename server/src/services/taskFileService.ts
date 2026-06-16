import { asc, eq } from 'drizzle-orm';
import type { TaskFile } from 'shared';
import type { Database } from '../db/index.js';
import { taskFiles, type TaskFileRow } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { publishChange } from './activityService.js';
import { bus, type RealtimeBus } from '../realtime/bus.js';

/**
 * Task file / attachment service (§7.2). Owns the data access for files uploaded
 * against a task: listing metadata (never the bytes), creating a file from the
 * captured upload, loading the bytes for download, and deleting. The raw bytes live
 * in the `task_files.data` bytea column so files ride along with DB backups. The
 * 5MB single-file cap is enforced at the route/multipart layer before this runs;
 * authorization (project membership, uploader/lead/admin delete) is enforced by the
 * route via guards.
 */

// ---------------------------------------------------------------------------
// Row -> wire mapping
// ---------------------------------------------------------------------------

/**
 * Map a task-file row to the §7.2 `TaskFile` metadata wire shape. The `data` bytea
 * is deliberately omitted — list queries never select it and it never crosses the
 * wire here (it is streamed only by the download route).
 */
function toTaskFile(row: Omit<TaskFileRow, 'data'>): TaskFile {
  return {
    id: row.id,
    taskId: row.taskId,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    uploaderId: row.uploaderId,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** Load a task file's metadata by id or throw 404 (no bytes selected). */
export async function loadTaskFileOrThrow(
  db: Database,
  fileId: string,
): Promise<TaskFile & { taskId: string }> {
  const rows = await db
    .select({
      id: taskFiles.id,
      taskId: taskFiles.taskId,
      filename: taskFiles.filename,
      mime: taskFiles.mime,
      sizeBytes: taskFiles.sizeBytes,
      uploaderId: taskFiles.uploaderId,
      createdAt: taskFiles.createdAt,
    })
    .from(taskFiles)
    .where(eq(taskFiles.id, fileId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw notFound('文件不存在');
  }
  return toTaskFile(row);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List a task's attachments (oldest first) — metadata only, never the bytes. */
export async function listTaskFiles(db: Database, taskId: string): Promise<TaskFile[]> {
  const rows = await db
    .select({
      id: taskFiles.id,
      taskId: taskFiles.taskId,
      filename: taskFiles.filename,
      mime: taskFiles.mime,
      sizeBytes: taskFiles.sizeBytes,
      uploaderId: taskFiles.uploaderId,
      createdAt: taskFiles.createdAt,
    })
    .from(taskFiles)
    .where(eq(taskFiles.taskId, taskId))
    .orderBy(asc(taskFiles.createdAt));
  return rows.map(toTaskFile);
}

export interface TaskFileBytes {
  filename: string;
  mime: string;
  /** Raw file bytes for the download stream. */
  bytes: Buffer;
}

/**
 * Load a task file's raw bytes + filename/mime for the download route. Returns null
 * when the file no longer exists so the route can 404. The bytes are read only here.
 */
export async function getTaskFileBytes(
  db: Database,
  fileId: string,
): Promise<TaskFileBytes | null> {
  const rows = await db
    .select({
      filename: taskFiles.filename,
      mime: taskFiles.mime,
      data: taskFiles.data,
    })
    .from(taskFiles)
    .where(eq(taskFiles.id, fileId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { filename: row.filename, mime: row.mime, bytes: row.data };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateTaskFileParams {
  taskId: string;
  /** Owning project, or null for a file on a no-project (pool) task (§8). */
  projectId: string | null;
  uploaderId: string;
  filename: string;
  mime: string;
  data: Buffer;
}

/**
 * Store an uploaded file against a task (§7.2). The byte size is derived from the
 * buffer (the 5MB cap is enforced upstream). Publishes a `task`-entity realtime
 * event so other clients refresh the attachment list. Returns the new file metadata
 * (without the bytes).
 */
export async function createTaskFile(
  db: Database,
  params: CreateTaskFileParams,
  realtimeBus: RealtimeBus = bus,
): Promise<TaskFile> {
  const [inserted] = await db
    .insert(taskFiles)
    .values({
      taskId: params.taskId,
      uploaderId: params.uploaderId,
      filename: params.filename,
      mime: params.mime,
      sizeBytes: params.data.length,
      data: params.data,
    })
    .returning({
      id: taskFiles.id,
      taskId: taskFiles.taskId,
      filename: taskFiles.filename,
      mime: taskFiles.mime,
      sizeBytes: taskFiles.sizeBytes,
      uploaderId: taskFiles.uploaderId,
      createdAt: taskFiles.createdAt,
    });

  if (!inserted) {
    // Unreachable: insert..returning yields a row on success.
    throw new Error('上传文件失败：未返回插入行');
  }

  publishTaskFileChange(realtimeBus, 'file_uploaded', params.projectId, params.taskId);
  return toTaskFile(inserted);
}

/**
 * Delete a task file (§7.2; uploader / project lead / global admin — enforced by the
 * route). Publishes a `task`-entity realtime event so the attachment list refreshes.
 */
export async function deleteTaskFile(
  db: Database,
  file: { id: string; taskId: string },
  projectId: string | null,
  realtimeBus: RealtimeBus = bus,
): Promise<void> {
  await db.delete(taskFiles).where(eq(taskFiles.id, file.id));
  publishTaskFileChange(realtimeBus, 'file_deleted', projectId, file.taskId);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Publish a `task`-entity realtime event for an attachment change so peers refresh
 * the task's file list (it lives in the task detail drawer keyed off the task).
 */
function publishTaskFileChange(
  realtimeBus: RealtimeBus,
  type: string,
  projectId: string | null,
  taskId: string,
): void {
  publishChange(
    {
      type,
      projectId,
      entity: 'task',
      payload: { taskId },
    },
    realtimeBus,
  );
}
