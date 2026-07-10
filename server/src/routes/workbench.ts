import type { FastifyPluginAsync } from 'fastify';
import type { BoardResponse } from 'shared';
import { requireAuth } from '../lib/guards.js';
import { listRejectedTasks, listReviewQueue } from '../services/taskService.js';

/**
 * 个人工作台 read endpoints (P2 §4). Thin route layer over `taskService`: both
 * return the standard `BoardResponse` (fully serialized tasks with claimants /
 * labels / project context) so the workbench renders with the same card components
 * as the boards.
 */

const workbenchRoutes: FastifyPluginAsync = async (fastify) => {
  const { db } = fastify;

  // GET /me/review-queue — 待我审核: every pending_review task the caller may act
  // on now (admin: all; lead/赛道经理: their projects', minus first-approved ones).
  fastify.get('/me/review-queue', async (request): Promise<BoardResponse> => {
    const user = requireAuth(request);
    const tasks = await listReviewQueue(db, user);
    return { tasks };
  });

  // GET /me/rejected-tasks — 我被退回: my in_progress claims whose latest review
  // was a reject within the last 14 days.
  fastify.get('/me/rejected-tasks', async (request): Promise<BoardResponse> => {
    const user = requireAuth(request);
    const tasks = await listRejectedTasks(db, user);
    return { tasks };
  });
};

export default workbenchRoutes;
