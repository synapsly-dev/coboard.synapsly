import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { idParamSchema, type AttachmentsResponse } from 'shared';
import { forbidden, notFound } from '../lib/errors.js';
import { requireTaskVisibility } from '../lib/guards.js';
import { readUploadedFile, sendFileBytes } from '../lib/uploads.js';
import { parseParams } from '../lib/validate.js';
import { loadCommentOrThrow, loadTaskOrThrow } from '../services/commentService.js';
import {
  createCommentFile,
  deleteCommentFile,
  getCommentFileBytes,
  loadCommentFileOrThrow,
} from '../services/attachmentService.js';

/**
 * Comment attachment routes:
 * - POST   /comments/:id/files            upload one file (comment author only)
 * - GET    /comments/:id/files/:fileId    download the bytes
 * - DELETE /comments/:id/files/:fileId    delete (uploader / lead — mirrors the
 *                                         comment's own delete permission)
 *
 * Visibility mirrors the comment thread: the caller must be able to see the
 * owning task (project member; pool task = any logged-in user). Attachment
 * metadata is embedded in the comment wire shape (`files`) — no list endpoint.
 * Comments stay editable (no done-task freeze), so their attachments do too.
 */

/** Route param schema for /comments/:id/files/:fileId. */
const fileParamsSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
});

const commentFilesRoutes: FastifyPluginAsync = async (fastify) => {
  const { db, bus } = fastify;

  // --- POST /comments/:id/files (multipart, single file ≤5MB) --------------
  fastify.post('/comments/:id/files', async (request, reply): Promise<AttachmentsResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const comment = await loadCommentOrThrow(db, id);
    const task = await loadTaskOrThrow(db, comment.taskId);
    const { user } = await requireTaskVisibility(db, request, task);

    // Attachments are part of the comment — only its author adds them (mirrors
    // the edit permission).
    if (comment.authorId !== user.id) {
      throw forbidden('只能为自己的评论上传附件');
    }

    const upload = await readUploadedFile(request);
    const file = await createCommentFile(
      db,
      {
        ownerId: comment.id,
        taskId: task.id,
        projectId: task.projectId,
        uploaderId: user.id,
        filename: upload.filename,
        mime: upload.mime,
        data: upload.data,
      },
      bus,
    );

    reply.code(201);
    return { files: [file] };
  });

  // --- GET /comments/:id/files/:fileId (download bytes) --------------------
  fastify.get('/comments/:id/files/:fileId', async (request, reply) => {
    const { id, fileId } = parseParams(fileParamsSchema, request.params);
    const comment = await loadCommentOrThrow(db, id);
    const task = await loadTaskOrThrow(db, comment.taskId);
    await requireTaskVisibility(db, request, task);

    // Ensure the file belongs to this comment (404 otherwise).
    const meta = await loadCommentFileOrThrow(db, fileId);
    if (meta.ownerId !== id) {
      throw notFound('文件不存在');
    }

    const file = await getCommentFileBytes(db, fileId);
    if (!file) {
      throw notFound('文件不存在');
    }
    return sendFileBytes(request, reply, file);
  });

  // --- DELETE /comments/:id/files/:fileId -----------------------------------
  fastify.delete('/comments/:id/files/:fileId', async (request, reply) => {
    const { id, fileId } = parseParams(fileParamsSchema, request.params);
    const comment = await loadCommentOrThrow(db, id);
    const task = await loadTaskOrThrow(db, comment.taskId);
    const { user, isLead } = await requireTaskVisibility(db, request, task);

    const meta = await loadCommentFileOrThrow(db, fileId);
    if (meta.ownerId !== id) {
      throw notFound('文件不存在');
    }

    // Uploader or lead/admin — mirrors who may delete the comment itself.
    const isUploader = meta.uploaderId === user.id;
    if (!isUploader && !isLead) {
      throw forbidden('只能删除自己上传的文件');
    }

    await deleteCommentFile(
      db,
      { fileId: meta.id, ownerId: comment.id, taskId: task.id, projectId: task.projectId },
      bus,
    );
    return reply.code(204).send();
  });
};

export default commentFilesRoutes;
