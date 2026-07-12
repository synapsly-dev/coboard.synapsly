import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { idParamSchema, type TaskFilesResponse } from 'shared';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { requireTaskVisibility } from '../lib/guards.js';
import { readUploadedFile, sendFileBytes } from '../lib/uploads.js';
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
 * non-members must not even learn the task exists. The multipart read (5MB cap) and
 * the hardened download response live in lib/uploads (shared with idea/comment
 * attachments); data access lives in taskFileService.
 */

/** Route param schema for /tasks/:id/files/:fileId. */
const fileParamsSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
});

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

    // A completed task's delivery content is frozen (撤销通过 first to amend it).
    if (task.status === 'done') {
      throw conflict('任务已完成，不能修改交付内容');
    }

    const upload = await readUploadedFile(request);

    const file = await createTaskFile(
      db,
      {
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

    return sendFileBytes(request, reply, file);
  });

  // --- DELETE /tasks/:id/files/:fileId (uploader / lead / admin) -----------
  fastify.delete('/tasks/:id/files/:fileId', async (request, reply) => {
    const { id, fileId } = parseParams(fileParamsSchema, request.params);
    const task = await loadTaskOrThrow(db, id);
    const { user, isLead } = await requireTaskVisibility(db, request, task);

    // A completed task's delivery content is frozen (撤销通过 first to amend it).
    if (task.status === 'done') {
      throw conflict('任务已完成，不能修改交付内容');
    }

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
