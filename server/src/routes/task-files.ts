import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { idParamSchema, isInlinePreviewable, type TaskFilesResponse } from 'shared';
import { AppError, ErrorCode, forbidden, notFound, validationError } from '../lib/errors.js';
import { requireTaskVisibility } from '../lib/guards.js';
import { parseParams } from '../lib/validate.js';
import { loadTaskOrThrow } from '../services/commentService.js';
import {
  createTaskFile,
  deleteTaskFile,
  getTaskFileBytes,
  listTaskFiles,
  loadTaskFileOrThrow,
} from '../services/taskFileService.js';

/**
 * Task file / attachment routes (§7.2):
 * - GET    /tasks/:id/files            list a task's attachments (metadata only)
 * - POST   /tasks/:id/files            upload one file (multipart/form-data; ≤5MB)
 * - GET    /tasks/:id/files/:fileId    download the bytes (Content-Disposition)
 * - DELETE /tasks/:id/files/:fileId    delete (uploader / project lead / global admin)
 *
 * Every endpoint requires the caller to be a member of the task's project (§6.3);
 * non-members must not even learn the task exists. The 5MB single-file cap is
 * enforced server-side via @fastify/multipart's per-stream `fileSize` limit (busboy
 * truncates the stream at the cap and we reject the truncated upload). Data access
 * lives in taskFileService.
 */

/** Single-file upload cap (§7.2): 5 MB. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Route param schema for /tasks/:id/files/:fileId. */
const fileParamsSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
});

/**
 * Build a Content-Disposition value that survives non-ASCII (e.g. Chinese)
 * filenames. Provides an ASCII fallback plus the RFC 5987 `filename*` form so
 * browsers preserve the original name. `type` is `attachment` (download) by
 * default, or `inline` for an in-app preview of a whitelisted mime.
 */
function contentDisposition(filename: string, type: 'attachment' | 'inline' = 'attachment'): string {
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

const taskFilesRoutes: FastifyPluginAsync = async (fastify) => {
  const { db, bus } = fastify;

  // --- GET /tasks/:id/files ------------------------------------------------
  fastify.get('/tasks/:id/files', async (request): Promise<TaskFilesResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const task = await loadTaskOrThrow(db, id);
    // Project membership (project task) or any authenticated user (pool task, §8).
    await requireTaskVisibility(db, request, task);

    const files = await listTaskFiles(db, id);
    return { files };
  });

  // --- POST /tasks/:id/files (multipart, single file ≤5MB) -----------------
  fastify.post('/tasks/:id/files', async (request, reply): Promise<TaskFilesResponse> => {
    const { id } = parseParams(idParamSchema, request.params);

    const task = await loadTaskOrThrow(db, id);
    // Any project member (project task) or any authenticated user (pool task, §8).
    const { user } = await requireTaskVisibility(db, request, task);

    if (!request.isMultipart()) {
      throw validationError('请使用 multipart/form-data 上传文件');
    }

    // Stream the single file field; busboy hard-caps the read at MAX_FILE_BYTES.
    const part = await request.file({ limits: { fileSize: MAX_FILE_BYTES } });
    if (!part) {
      throw validationError('未找到上传的文件');
    }

    // busboy hard-caps the stream at MAX_FILE_BYTES; with throwFileSizeLimit (the
    // default) `toBuffer()` THROWS once the cap is hit. Translate that into a 413
    // with a friendly message. The truncated-flag check is a belt-and-suspenders
    // guard for the non-throwing path (§7.2 5MB cap).
    let data: Buffer;
    try {
      data = await part.toBuffer();
    } catch (err) {
      if ((err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        throw new AppError(413, ErrorCode.VALIDATION, '文件过大，单个文件不能超过 5MB');
      }
      throw err;
    }
    if (part.file.truncated || data.length > MAX_FILE_BYTES) {
      throw new AppError(413, ErrorCode.VALIDATION, '文件过大，单个文件不能超过 5MB');
    }
    if (data.length === 0) {
      throw validationError('文件为空');
    }

    const file = await createTaskFile(
      db,
      {
        taskId: task.id,
        projectId: task.projectId,
        uploaderId: user.id,
        filename: part.filename || '未命名文件',
        mime: part.mimetype || 'application/octet-stream',
        data,
      },
      bus,
    );

    reply.code(201);
    return { files: [file] };
  });

  // --- GET /tasks/:id/files/:fileId (download bytes) -----------------------
  fastify.get('/tasks/:id/files/:fileId', async (request, reply) => {
    const { id, fileId } = parseParams(fileParamsSchema, request.params);
    const task = await loadTaskOrThrow(db, id);
    await requireTaskVisibility(db, request, task);

    // Ensure the file belongs to this task (404 otherwise).
    const meta = await loadTaskFileOrThrow(db, fileId);
    if (meta.taskId !== id) {
      throw notFound('文件不存在');
    }

    const file = await getTaskFileBytes(db, fileId);
    if (!file) {
      throw notFound('文件不存在');
    }

    // Serve inline only when the client asks (?inline=1) AND the mime is on the
    // preview whitelist (images + PDF). Anything else is always a download, so an
    // uploaded HTML/SVG/etc. can never be rendered as a document in our origin.
    // `nosniff` stops the browser sniffing a different (executable) type.
    const wantsInline = (request.query as { inline?: string } | undefined)?.inline === '1';
    const inline = wantsInline && isInlinePreviewable(file.mime);

    reply.header('Content-Type', file.mime);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Disposition', contentDisposition(file.filename, inline ? 'inline' : 'attachment'));
    reply.header('Cache-Control', 'private, max-age=0, must-revalidate');
    return reply.send(file.bytes);
  });

  // --- DELETE /tasks/:id/files/:fileId (uploader / lead / admin) -----------
  fastify.delete('/tasks/:id/files/:fileId', async (request, reply) => {
    const { id, fileId } = parseParams(fileParamsSchema, request.params);
    const task = await loadTaskOrThrow(db, id);
    const { user, isLead } = await requireTaskVisibility(db, request, task);

    const meta = await loadTaskFileOrThrow(db, fileId);
    if (meta.taskId !== id) {
      throw notFound('文件不存在');
    }

    // Uploader, project lead/admin, or — for a pool task — the task creator/admin may
    // delete (§6.3 / §7.2 / §8, the lead-equivalent is carried in `isLead`).
    const isUploader = meta.uploaderId === user.id;
    if (!isUploader && !isLead) {
      throw forbidden('只能删除自己上传的文件');
    }

    await deleteTaskFile(db, { id: meta.id, taskId: meta.taskId }, task.projectId, bus);
    return reply.code(204).send();
  });
};

export default taskFilesRoutes;
