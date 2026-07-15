import type { FastifyPluginAsync } from 'fastify';
import {
  createUserInputSchema,
  idParamSchema,
  updateUserInputSchema,
  type AuthUserResponse,
  type UsersListResponse,
  isSuperAdminRole,
} from 'shared';
import { requireAdmin, requireAuth } from '../lib/guards.js';
import { forbidden, notFound, validationError } from '../lib/errors.js';
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
 * User management routes, admin-only (§7, §6.3): GET /users, POST /users
 * (pre-provision a passwordless account), PATCH /users/:id (rename / change role /
 * (de)activate). Every handler gates on requireAdmin first.
 */
const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/users', async (request): Promise<UsersListResponse> => {
    requireAdmin(request);
    const users = await listUsersWithProjects(fastify.db);
    return { users };
  });

  fastify.post('/users', async (request, reply): Promise<AuthUserResponse> => {
    const actor = requireAdmin(request);
    const input = parseBody(createUserInputSchema, request.body);
    if (input.role === 'super_admin') {
      throw validationError('超级管理员唯一，不能通过新建账号创建');
    }
    if (input.role === 'admin' && !isSuperAdminRole(actor.role)) {
      throw forbidden('只有超级管理员可以创建管理员');
    }
    const user = await createUser(fastify.db, createUserParamsFromInput(input));
    reply.code(201);
    return { user: serializeUser(user) };
  });

  fastify.patch('/users/:id', async (request): Promise<AuthUserResponse> => {
    const actor = requireAdmin(request);
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(updateUserInputSchema, request.body);
    if (input.role !== undefined) {
      if (!isSuperAdminRole(actor.role)) {
        throw forbidden('只有超级管理员可以调整全局角色');
      }
      if (input.role === 'super_admin') {
        throw validationError('超级管理员唯一，不能通过用户管理转移');
      }
    }
    const user = await updateUser(fastify.db, id, input, fastify.bus, actor.id);
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
