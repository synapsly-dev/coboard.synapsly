import type { FastifyPluginAsync } from 'fastify';
import {
  createTrackInputSchema,
  idParamSchema,
  setTrackMembersInputSchema,
  updateTrackInputSchema,
  type TrackMemberCandidatesResponse,
  type TracksResponse,
} from 'shared';
import { requireAdmin, requireAuth, requireTrackManagerOrAdmin } from '../lib/guards.js';
import { parseBody, parseParams } from '../lib/validate.js';
import {
  createTrack,
  deleteTrack,
  listTracks,
  setTrackMembers,
  joinTrack,
  leaveTrack,
  listTrackMemberCandidates,
  loadTrackOrThrow,
  updateTrack,
} from '../services/trackService.js';

/**
 * 赛道 (Track) routes (P0 §2). Handlers stay thin: run the auth/admin guards,
 * validate against the shared zod contracts, then delegate to trackService. Reads
 * are open to every logged-in user (used to group the project list). Structural
 * mutations are global-admin only; current track managers may manage their own
 * roster and read the public-safe candidate directory for that purpose.
 *
 *   GET    /tracks                 — all tracks (any logged-in user)
 *   POST   /tracks                 — admin; create a track
 *   PATCH  /tracks/:id             — admin; edit name/desc/weeklyGoal/archived
 *   DELETE /tracks/:id             — admin; delete (409 if it still owns projects)
 *   GET    /tracks/:id/member-candidates — admin/current manager; active users
 *   PUT    /tracks/:id/members     — admin/current manager; replace roster
 *   POST   /tracks/:id/join        — any member; self-join as an ordinary member
 *   POST   /tracks/:id/leave       — any member; self-leave (managers must hand off)
 */
const tracksRoutes: FastifyPluginAsync = async (fastify) => {
  const { db } = fastify;

  // List all tracks (with people + project counts); any logged-in user.
  fastify.get('/tracks', async (request): Promise<TracksResponse> => {
    requireAuth(request);
    const tracks = await listTracks(db);
    return { tracks };
  });

  // Public-safe active-user directory for this track's roster editor.
  fastify.get(
    '/tracks/:id/member-candidates',
    async (request): Promise<TrackMemberCandidatesResponse> => {
      const { id } = parseParams(idParamSchema, request.params);
      requireAuth(request);
      await loadTrackOrThrow(db, id);
      await requireTrackManagerOrAdmin(db, request, id);
      const users = await listTrackMemberCandidates(db);
      return { users };
    },
  );

  // Create a track (global admin only).
  fastify.post('/tracks', async (request, reply) => {
    const admin = requireAdmin(request);
    const input = parseBody(createTrackInputSchema, request.body);
    const track = await createTrack(db, admin, input);
    return reply.code(201).send({ track });
  });

  // Edit a track (global admin only).
  fastify.patch('/tracks/:id', async (request) => {
    requireAdmin(request);
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(updateTrackInputSchema, request.body);
    const track = await updateTrack(db, id, input);
    return { track };
  });

  // Delete a track (global admin only); 409 while it still owns projects.
  fastify.delete('/tracks/:id', async (request, reply) => {
    requireAdmin(request);
    const { id } = parseParams(idParamSchema, request.params);
    await deleteTrack(db, id);
    return reply.code(204).send();
  });

  // Replace a track's roster (managers + members); global admin or current manager.
  fastify.put('/tracks/:id/members', async (request) => {
    const { id } = parseParams(idParamSchema, request.params);
    await requireTrackManagerOrAdmin(db, request, id);
    const actor = requireAuth(request);
    const input = parseBody(setTrackMembersInputSchema, request.body);
    const track = await setTrackMembers(db, id, input, fastify.bus, actor.id);
    return { track };
  });

  // Direct self-service membership; this does not implicitly join Track projects.
  fastify.post('/tracks/:id/join', async (request) => {
    const user = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    const track = await joinTrack(db, id, user);
    return { track };
  });

  fastify.post('/tracks/:id/leave', async (request) => {
    const user = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    const track = await leaveTrack(db, id, user);
    return { track };
  });
};

export default tracksRoutes;
