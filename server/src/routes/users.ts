import type { FastifyPluginAsync } from 'fastify';
import {
  createUserInputSchema,
  idParamSchema,
  updateUserInputSchema,
  type AuthUserResponse,
  type UsersListResponse,
} from 'shared';
import { requireAdmin } from '../lib/guards.js';
import { parseBody, parseParams } from '../lib/validate.js';
import {
  createUser,
  createUserParamsFromInput,
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
};

export default usersRoutes;
