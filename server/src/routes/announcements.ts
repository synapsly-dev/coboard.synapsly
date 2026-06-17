import type { FastifyPluginAsync } from 'fastify';
import {
  createAnnouncementInputSchema,
  idParamSchema,
  updateAnnouncementInputSchema,
  type AnnouncementResponse,
  type AnnouncementsResponse,
} from 'shared';
import { requireAdmin, requireAuth } from '../lib/guards.js';
import { parseBody, parseParams } from '../lib/validate.js';
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from '../services/announcementService.js';

/**
 * Announcement / 信息 routes:
 * - GET    /announcements      list all notices, newest first (any logged-in user)
 * - POST   /announcements      publish a notice (global admin)
 * - PATCH  /announcements/:id  edit a notice (global admin)
 * - DELETE /announcements/:id  delete a notice (global admin)
 *
 * Reads are open to every authenticated user; writes are gated to a global admin
 * via {@link requireAdmin}. Data access + realtime fan-out live in
 * announcementService.
 */
const announcementsRoutes: FastifyPluginAsync = async (fastify) => {
  const { db, bus } = fastify;

  fastify.get('/announcements', async (request): Promise<AnnouncementsResponse> => {
    requireAuth(request);
    const announcements = await listAnnouncements(db);
    return { announcements };
  });

  fastify.post('/announcements', async (request, reply): Promise<AnnouncementResponse> => {
    const admin = requireAdmin(request);
    const input = parseBody(createAnnouncementInputSchema, request.body);
    const announcement = await createAnnouncement(db, bus, admin.id, input);
    reply.code(201);
    return { announcement };
  });

  fastify.patch('/announcements/:id', async (request): Promise<AnnouncementResponse> => {
    requireAdmin(request);
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(updateAnnouncementInputSchema, request.body);
    const announcement = await updateAnnouncement(db, bus, id, input);
    return { announcement };
  });

  fastify.delete('/announcements/:id', async (request, reply) => {
    requireAdmin(request);
    const { id } = parseParams(idParamSchema, request.params);
    await deleteAnnouncement(db, bus, id);
    return reply.code(204).send();
  });
};

export default announcementsRoutes;
