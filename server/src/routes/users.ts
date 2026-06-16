import type { FastifyPluginAsync } from 'fastify';
import {
  createUserInputSchema,
  idParamSchema,
  updateUserInputSchema,
  type AuthUserResponse,
  type UsersListResponse,
} from 'shared';
import { requireAdmin, requireAuth } from '../lib/guards.js';
import { notFound } from '../lib/errors.js';
import { parseBody, parseParams } from '../lib/validate.js';
import {
  createUser,
  createUserParamsFromInput,
  getUserAvatar,
  listUsersWithProjects,
  serializeUser,
  updateUser,
} from '../services/userService.js';

/**
 * User management routes, admin-only (§7, §6.3): GET /users, POST /users (create
 * an account with an initial password), PATCH /users/:id (rename / change role /
 * (de)activate). Every handler gates on requireAdmin first.
 */
const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/users', async (request): Promise<UsersListResponse> => {
    requireAdmin(request);
    const users = await listUsersWithProjects(fastify.db);
    return { users };
  });

  fastify.post('/users', async (request, reply): Promise<AuthUserResponse> => {
    requireAdmin(request);
    const input = parseBody(createUserInputSchema, request.body);
    const user = await createUser(fastify.db, createUserParamsFromInput(input));
    reply.code(201);
    return { user: serializeUser(user) };
  });

  fastify.patch('/users/:id', async (request): Promise<AuthUserResponse> => {
    requireAdmin(request);
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(updateUserInputSchema, request.body);
    const user = await updateUser(fastify.db, id, input);
    return { user: serializeUser(user) };
  });

  /**
   * Serve a user's uploaded avatar (Change 1). Any logged-in user may view any
   * user's avatar (not admin-only). Returns the raw image bytes with a private,
   * revalidating cache and an ETag so the browser can 304 on repeat fetches. The
   * base64 bytes never appear in any other response.
   */
  fastify.get('/users/:id/avatar', async (request, reply) => {
    requireAuth(request);
    const { id } = parseParams(idParamSchema, request.params);
    const avatar = await getUserAvatar(fastify.db, id);
    if (!avatar) {
      throw notFound('该用户没有头像');
    }

    reply.header('Cache-Control', 'private, max-age=0, must-revalidate');
    reply.header('ETag', avatar.etag);

    const ifNoneMatch = request.headers['if-none-match'];
    if (ifNoneMatch && ifNoneMatch === avatar.etag) {
      return reply.code(304).send();
    }

    reply.header('Content-Type', avatar.mime);
    return reply.send(avatar.bytes);
  });
};

export default usersRoutes;
