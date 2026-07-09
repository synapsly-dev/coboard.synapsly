import type { FastifyPluginAsync } from 'fastify';
import {
  createTrackInputSchema,
  idParamSchema,
  setTrackMembersInputSchema,
  updateTrackInputSchema,
  type TracksResponse,
} from 'shared';
import { requireAdmin, requireAuth } from '../lib/guards.js';
import { parseBody, parseParams } from '../lib/validate.js';
import {
  createTrack,
  deleteTrack,
  listTracks,
  setTrackMembers,
  updateTrack,
} from '../services/trackService.js';

/**
 * 赛道 (Track) routes (P0 §2). Handlers stay thin: run the auth/admin guards,
 * validate against the shared zod contracts, then delegate to trackService. Reads
 * are open to every logged-in user (used to group the project list); all mutations
 * are global-admin only. Track managers gain their authority over the track's
 * projects via guards.isTrackManager, not through these endpoints.
 *
 *   GET    /tracks                 — all tracks (any logged-in user)
 *   POST   /tracks                 — admin; create a track
 *   PATCH  /tracks/:id             — admin; edit name/desc/weeklyGoal/archived
 *   DELETE /tracks/:id             — admin; delete (409 if it still owns projects)
 *   PUT    /tracks/:id/members     — admin; replace managers + members
 */
const tracksRoutes: FastifyPluginAsync = async (fastify) => {
  const { db } = fastify;

  // List all tracks (with people + project counts); any logged-in user.
  fastify.get('/tracks', async (request): Promise<TracksResponse> => {
    requireAuth(request);
    const tracks = await listTracks(db);
    return { tracks };
  });

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

  // Replace a track's roster (managers + members); global admin only.
  fastify.put('/tracks/:id/members', async (request) => {
    requireAdmin(request);
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(setTrackMembersInputSchema, request.body);
    const track = await setTrackMembers(db, id, input);
    return { track };
  });
};

export default tracksRoutes;
