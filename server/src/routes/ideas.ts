import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  adoptIdeaInputSchema,
  createIdeaInputSchema,
  idParamSchema,
  ideasQuerySchema,
  type IdeaResponse,
  type IdeasResponse,
  type IdeasWithContextResponse,
} from 'shared';
import { projectMembers, type UserRow } from '../db/schema.js';
import { forbidden } from '../lib/errors.js';
import { requireAuth, requireTaskVisibility } from '../lib/guards.js';
import { parseBody, parseParams, parseQuery } from '../lib/validate.js';
import { loadTaskOrThrow } from '../services/commentService.js';
import {
  adoptIdea,
  createIdea,
  listTaskIdeas,
  listVisibleIdeas,
  loadIdeaOrThrow,
  rejectIdea,
  type IdeaScope,
} from '../services/ideaService.js';
import type { Database } from '../db/index.js';

/**
 * Idea / inspiration routes (§7.1):
 * - GET    /tasks/:id/ideas   list a task's ideas (project member)
 * - POST   /tasks/:id/ideas   post an idea on a task (project member)
 * - GET    /ideas             the cross-project 灵感区 (auth; visible projects)
 * - POST   /ideas/:id/adopt   adopt + reward (project lead / global admin)
 * - POST   /ideas/:id/reject  reject (project lead / global admin)
 *
 * Membership / lead gating uses the shared guards; data access + realtime fan-out
 * live in ideaService. The per-task endpoints resolve the owning project from the
 * task; the cross-project listing scopes to the caller's visible projects.
 */

/**
 * Resolve the project scope for the cross-project 灵感区 listing: every project for a
 * global admin, otherwise the projects the user is a member of (mirrors the stats
 * visibility scope).
 */
async function resolveIdeaScope(db: Database, user: UserRow): Promise<IdeaScope> {
  if (user.role === 'admin') {
    return { kind: 'all' };
  }
  const rows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, user.id));
  return { kind: 'projects', projectIds: rows.map((r) => r.projectId) };
}

const ideasRoutes: FastifyPluginAsync = async (fastify) => {
  const { db, bus } = fastify;

  // --- GET /tasks/:id/ideas ------------------------------------------------
  fastify.get('/tasks/:id/ideas', async (request): Promise<IdeasResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const task = await loadTaskOrThrow(db, id);
    // Project membership (project task) or any authenticated user (pool task, §8).
    await requireTaskVisibility(db, request, task);

    const ideas = await listTaskIdeas(db, id);
    return { ideas };
  });

  // --- POST /tasks/:id/ideas -----------------------------------------------
  fastify.post('/tasks/:id/ideas', async (request, reply): Promise<IdeasResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(createIdeaInputSchema, request.body);

    const task = await loadTaskOrThrow(db, id);
    // Any project member (project task) or any authenticated user (pool task, §8).
    const { user } = await requireTaskVisibility(db, request, task);

    const idea = await createIdea(
      db,
      {
        taskId: task.id,
        projectId: task.projectId,
        authorId: user.id,
        body: input.body,
      },
      bus,
    );

    reply.code(201);
    return { ideas: [idea] };
  });

  // --- GET /ideas (灵感区) --------------------------------------------------
  fastify.get('/ideas', async (request): Promise<IdeasWithContextResponse> => {
    const user = requireAuth(request);
    const query = parseQuery(ideasQuerySchema, request.query);

    const scope = await resolveIdeaScope(db, user);
    const ideas = await listVisibleIdeas(db, scope, query.status);
    return { ideas };
  });

  // --- POST /ideas/:id/adopt (lead / admin) --------------------------------
  fastify.post('/ideas/:id/adopt', async (request): Promise<IdeaResponse> => {
    const { id } = parseParams(idParamSchema, request.params);
    const input = parseBody(adoptIdeaInputSchema, request.body);

    const idea = await loadIdeaOrThrow(db, id);
    const task = await loadTaskOrThrow(db, idea.taskId);
    // Project lead / global admin (project task), or the task creator / admin (pool
    // task, §8) — the lead-equivalent is carried in `isLead`.
    const { user, isLead } = await requireTaskVisibility(db, request, task);
    if (!isLead) {
      throw forbidden('需要项目负责人权限');
    }

    const adopted = await adoptIdea(
      db,
      idea,
      task.projectId,
      user.id,
      input.rewardPoints,
      bus,
    );
    return { idea: adopted };
  });

  // --- POST /ideas/:id/reject (lead / admin) -------------------------------
  fastify.post('/ideas/:id/reject', async (request): Promise<IdeaResponse> => {
    const { id } = parseParams(idParamSchema, request.params);

    const idea = await loadIdeaOrThrow(db, id);
    const task = await loadTaskOrThrow(db, idea.taskId);
    // Project lead / global admin (project task), or the task creator / admin (pool
    // task, §8) — the lead-equivalent is carried in `isLead`.
    const { user, isLead } = await requireTaskVisibility(db, request, task);
    if (!isLead) {
      throw forbidden('需要项目负责人权限');
    }

    const rejected = await rejectIdea(db, idea, task.projectId, user.id, bus);
    return { idea: rejected };
  });
};

export default ideasRoutes;
