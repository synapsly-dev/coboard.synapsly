import type { FastifyPluginAsync } from 'fastify';
import {
  assetsQuerySchema,
  createAssetInputSchema,
  idParamSchema,
  updateAssetInputSchema,
  type AssetResponse,
  type AssetsResponse,
} from 'shared';
import { requireAuth } from '../lib/guards.js';
import { parseBody, parseParams, parseQuery } from '../lib/validate.js';
import {
  createAsset,
  deleteAsset,
  listAssets,
  updateAsset,
} from '../services/assetService.js';

/**
 * 资产库 (Asset) routes (P3 §1, 运营需求 §9):
 * - GET    /assets?kind&trackId  list, newest first (any logged-in user)
 * - POST   /assets               create an asset (any logged-in user)
 * - PATCH  /assets/:id           edit (author; admin / 赛道经理 for all)
 * - DELETE /assets/:id           delete (author; admin / 赛道经理 for all)
 *
 * Reads are team-wide; the author/curator write gate lives in assetService (the
 * routes only establish the authenticated user). Data access + realtime fan-out
 * live in assetService.
 */
const assetsRoutes: FastifyPluginAsync = async (fastify) => {
  const { db, bus } = fastify;

  fastify.get('/assets', async (request): Promise<AssetsResponse> => {
    requireAuth(request);
    const query = parseQuery(assetsQuerySchema, request.query);
    const assets = await listAssets(db, query);
    return { assets };
  });

  fastify.post('/assets', async (request, reply): Promise<AssetResponse> => {
    const user = requireAuth(request);
    const input = parseBody(createAssetInputSchema, request.body);
    const asset = await createAsset(db, user, input, bus);
    reply.code(201);
    return { asset };
  });

  fastify.patch('/assets/:id', async (request): Promise<AssetResponse> => {
    const user = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(updateAssetInputSchema, request.body);
    const asset = await updateAsset(db, user, id, input, bus);
    return { asset };
  });

  fastify.delete('/assets/:id', async (request, reply) => {
    const user = requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    await deleteAsset(db, user, id, bus);
    return reply.code(204).send();
  });
};

export default assetsRoutes;
