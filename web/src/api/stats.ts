import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  LeaderboardEntry,
  MyStatsResponse,
  StatsSort,
  TrackStatsEntry,
  TrendBucket,
  TrendPoint,
} from 'shared';
import { queryKeys } from 'client-core';
import { coboardClient } from '../platform/coboard-client';

/**
 * Contribution-statistics data hooks (§6.4, §7). Three read endpoints:
 * - `GET /stats/leaderboard?projectId&from&to&sort` — per-user ranking.
 * - `GET /stats/me?from&to` — the current user's own totals.
 * - `GET /stats/trend?userId&from&to&bucket` — completed-over-time series.
 *
 * Stats are recomputed on the server (no pre-aggregation, §6.4). SSE invalidates
 * the whole `['stats']` key on task completion/reopen (see lib/sse.ts), so these
 * queries stay live without manual refetch.
 */

/** Arguments for the leaderboard query (undefined params are dropped). */
export interface LeaderboardParams {
  projectId?: string;
  /** Inclusive lower bound (ISO-8601) on `completed_at`. */
  from?: string;
  /** Exclusive/inclusive upper bound (ISO-8601) on `completed_at`. */
  to?: string;
  sort?: StatsSort;
}

/** Arguments for the personal-totals query. */
export interface MyStatsParams {
  from?: string;
  to?: string;
}

/** Arguments for the trend query. */
export interface TrendParams {
  /** Whose trend to fetch; defaults (server-side) to the current user. */
  userId?: string;
  from?: string;
  to?: string;
  bucket?: TrendBucket;
}

/**
 * Build a stable, serializable key fragment from params. Drops `undefined` so the
 * query key (and cache entry) is identical regardless of property order.
 */
function toKeyParams(
  params: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** Low-level fetchers — shared by hooks (and any future imperative refetch). */
/** Ranked per-user contribution list (§7 GET /stats/leaderboard). */
export function useLeaderboard(params: LeaderboardParams): UseQueryResult<LeaderboardEntry[]> {
  const keyParams = toKeyParams({
    projectId: params.projectId,
    from: params.from,
    to: params.to,
    sort: params.sort,
  });
  return useQuery<LeaderboardEntry[]>({
    queryKey: queryKeys.leaderboard(keyParams),
    queryFn: async ({ signal }) => {
      const res = await coboardClient.stats.leaderboard(params, signal);
      return res.entries;
    },
  });
}

/** The current user's own completed count + points sum (§7 GET /stats/me). */
export function useMyStats(params: MyStatsParams): UseQueryResult<MyStatsResponse> {
  const keyParams = toKeyParams({ from: params.from, to: params.to });
  return useQuery<MyStatsResponse>({
    queryKey: queryKeys.myStats(keyParams),
    queryFn: ({ signal }) => coboardClient.stats.me(params, signal),
  });
}

/** Contribution rolled up by 赛道 (P0 §2 GET /stats/tracks). */
export function useTrackStats(params: MyStatsParams): UseQueryResult<TrackStatsEntry[]> {
  const keyParams = toKeyParams({ from: params.from, to: params.to });
  return useQuery<TrackStatsEntry[]>({
    queryKey: queryKeys.trackStats(keyParams),
    queryFn: async ({ signal }) => {
      const res = await coboardClient.stats.tracks(params, signal);
      return res.entries;
    },
  });
}

/** Completed-over-time series for one user (§7 GET /stats/trend). */
export function useTrend(params: TrendParams): UseQueryResult<TrendPoint[]> {
  const keyParams = toKeyParams({
    userId: params.userId,
    from: params.from,
    to: params.to,
    bucket: params.bucket,
  });
  return useQuery<TrendPoint[]>({
    queryKey: queryKeys.trend(keyParams),
    queryFn: async ({ signal }) => {
      const res = await coboardClient.stats.trend(params, signal);
      return res.points;
    },
  });
}
