import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { idParamSchema, type AttachmentsResponse } from 'shared';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { requireIdeaVisibility } from '../lib/guards.js';
import { readUploadedFile, sendFileBytes } from '../lib/uploads.js';
import { parseParams } from '../lib/validate.js';
import { loadIdeaOrThrow } from '../services/ideaService.js';
import {
  createIdeaFile,
  deleteIdeaFile,
  getIdeaFileBytes,
  loadIdeaFileOrThrow,
} from '../services/attachmentService.js';

/**
 * Idea attachment routes (§7.1):
 * - POST   /ideas/:id/files            upload one file (author only, pending idea)
 * - GET    /ideas/:id/files/:fileId    download the bytes
 * - DELETE /ideas/:id/files/:fileId    delete (uploader on a pending idea / admin /
 *                                      — task idea — the project lead)
 *
 * Visibility mirrors the idea itself via the shared {@link requireIdeaVisibility}
 * guard (task idea → task visibility; standalone 灵感区 idea → any logged-in
 * user). Attachment metadata is embedded in the idea wire shape (`files`) — there
 * is no separate list endpoint. Once an idea has been adopted/rejected its content
 * is frozen for the author (reviewers judged it as submitted); leads/admins can
 * still delete files.
 */

/** Route param schema for /ideas/:id/files/:fileId. */
const fileParamsSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
});

const ideaFilesRoutes: FastifyPluginAsync = async (fastify) => {
  const { db, bus } = fastify;

  // --- POST /ideas/:id/files (multipart, single file ≤5MB) -----------------
  fastify.post('/ideas/:id/files', async (request, reply): Promise<AttachmentsResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const idea = await loadIdeaOrThrow(db, id);
    const access = await requireIdeaVisibility(db, request, idea);

    // Attachments are part of the idea's content — only its author adds them,
    // and only while the idea is still pending (adopt/reject freezes it).
    if (idea.authorId !== access.user.id) {
      throw forbidden('只能为自己的想法上传附件');
    }
    if (idea.status !== 'pending') {
      throw conflict('想法已处理，不能再修改附件');
    }

    const upload = await readUploadedFile(request);
    const file = await createIdeaFile(
      db,
      {
        ownerId: idea.id,
        taskId: access.taskId,
        projectId: access.projectId,
        uploaderId: access.user.id,
        filename: upload.filename,
        mime: upload.mime,
        data: upload.data,
      },
      bus,
    );

    reply.code(201);
    return { files: [file] };
  });

  // --- GET /ideas/:id/files/:fileId (download bytes) -----------------------
  fastify.get('/ideas/:id/files/:fileId', async (request, reply) => {
    const { id, fileId } = parseParams(fileParamsSchema, request.params);
    const idea = await loadIdeaOrThrow(db, id);
    await requireIdeaVisibility(db, request, idea);

    // Ensure the file belongs to this idea (404 otherwise).
    const meta = await loadIdeaFileOrThrow(db, fileId);
    if (meta.ownerId !== id) {
      throw notFound('文件不存在');
    }

    const file = await getIdeaFileBytes(db, fileId);
    if (!file) {
      throw notFound('文件不存在');
    }
    return sendFileBytes(request, reply, file);
  });

  // --- DELETE /ideas/:id/files/:fileId --------------------------------------
  fastify.delete('/ideas/:id/files/:fileId', async (request, reply) => {
    const { id, fileId } = parseParams(fileParamsSchema, request.params);
    const idea = await loadIdeaOrThrow(db, id);
    const access = await requireIdeaVisibility(db, request, idea);

    const meta = await loadIdeaFileOrThrow(db, fileId);
    if (meta.ownerId !== id) {
      throw notFound('文件不存在');
    }

    // Uploader may delete while the idea is pending; a lead/admin may always
    // (mirrors the idea's own delete permission).
    const isUploader = meta.uploaderId === access.user.id;
    if (!access.isLead) {
      if (!isUploader) {
        throw forbidden('只能删除自己上传的文件');
      }
      if (idea.status !== 'pending') {
        throw conflict('想法已处理，不能再修改附件');
      }
    }

    await deleteIdeaFile(
      db,
      { fileId: meta.id, ownerId: idea.id, taskId: access.taskId, projectId: access.projectId },
      bus,
    );
    return reply.code(204).send();
  });
};

export default ideaFilesRoutes;
