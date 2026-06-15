import type { FastifyPluginAsync } from 'fastify';
import {
  leaderboardQuerySchema,
  myStatsQuerySchema,
  trendQuerySchema,
  type LeaderboardResponse,
  type MyStatsResponse,
  type TrendResponse,
} from 'shared';
import { requireAuth, requireProjectMember } from '../lib/guards.js';
import { parseQuery } from '../lib/validate.js';
import {
  getLeaderboard,
  getMyStats,
  getTrend,
  resolveVisibleScope,
  type StatsScope,
} from '../services/statsService.js';

/**
 * Contribution-stats routes (§7, §6.4). All endpoints require an authenticated
 * session; results are computed live from `tasks` (no aggregation table).
 *
 * - GET /stats/leaderboard?projectId&from&to&sort=count|points — ranked per-user
 *   completed count + points sum. Scoped to one project (membership-checked) or,
 *   absent `projectId`, to every project the caller can see.
 * - GET /stats/me?from&to — the caller's own completed count + points sum.
 * - GET /stats/trend?userId&from&to&bucket — completed-per-bucket series for a
 *   user, restricted to the caller's visible projects.
 *
 * `from`/`to` arrive as ISO-8601 datetime strings (validated by the shared zod
 * schemas) and are converted to `Date` for the `completed_at` window filter.
 */

/** Parse an optional ISO datetime query field into a Date (undefined if absent). */
function toDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

const statsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/stats/leaderboard', async (request) => {
    const user = requireAuth(request);
    const query = parseQuery(leaderboardQuerySchema, request.query);

    let scope: StatsScope;
    if (query.projectId) {
      // Membership guard authorizes access and scopes to this one project.
      await requireProjectMember(fastify.db, request, query.projectId);
      scope = { kind: 'project', projectId: query.projectId };
    } else {
      scope = await resolveVisibleScope(fastify.db, user);
    }

    const entries = await getLeaderboard(fastify.db, {
      scope,
      from: toDate(query.from),
      to: toDate(query.to),
      // zod `.default('count')` guarantees a value at runtime.
      sort: query.sort ?? 'count',
    });

    const body: LeaderboardResponse = { entries };
    return body;
  });

  fastify.get('/stats/me', async (request) => {
    const user = requireAuth(request);
    const query = parseQuery(myStatsQuerySchema, request.query);

    const body: MyStatsResponse = await getMyStats(fastify.db, {
      userId: user.id,
      from: toDate(query.from),
      to: toDate(query.to),
    });
    return body;
  });

  fastify.get('/stats/trend', async (request) => {
    const user = requireAuth(request);
    const query = parseQuery(trendQuerySchema, request.query);

    // Trend is per-user; default to the caller. Restrict attribution to the
    // projects the caller can see so non-admins cannot probe other projects.
    const scope = await resolveVisibleScope(fastify.db, user);
    const points = await getTrend(fastify.db, {
      scope,
      userId: query.userId ?? user.id,
      from: toDate(query.from),
      to: toDate(query.to),
      // zod `.default('day')` guarantees a value at runtime.
      bucket: query.bucket ?? 'day',
    });

    const body: TrendResponse = { points };
    return body;
  });
};

export default statsRoutes;
