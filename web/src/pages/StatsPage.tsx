import { useMemo, useState } from 'react';
import { useLeaderboard, useTrackStats, useTrend } from '../api/stats';
import { useAuth } from '../lib/auth-context';
import {
  ChartCard,
  DEFAULT_FILTERS,
  Leaderboard,
  PerPersonChart,
  PersonalSummary,
  StatFilters,
  TrackStatsPanel,
  TrendChart,
  bucketForRange,
  resolveStatsQuery,
  type StatFilterState,
} from '../features/stats';

/**
 * Contribution statistics page (§6.4). Composes the filter bar, a personal
 * summary card for the current user, the team leaderboard, and two Recharts
 * views (the current user's completed-over-time trend + a per-person bar). All
 * driven by a single {@link StatFilterState}; SSE invalidation keeps the numbers
 * live as tasks complete (§6.5).
 */

const RANGE_LABELS: Record<StatFilterState['range'], string> = {
  week: '本周',
  month: '本月',
  all: '全部',
  custom: '自定义',
};

export default function StatsPage(): JSX.Element {
  const { user } = useAuth();
  const [filters, setFilters] = useState<StatFilterState>(DEFAULT_FILTERS);

  // Resolve the UI filters to absolute API params. Recompute on filter change.
  const resolved = useMemo(() => resolveStatsQuery(filters), [filters]);
  const bucket = bucketForRange(filters.range);

  const leaderboard = useLeaderboard({
    projectId: resolved.projectId,
    from: resolved.from,
    to: resolved.to,
    sort: filters.sort,
  });

  // Trend for the current user across the same window.
  const trend = useTrend({
    userId: user?.id,
    from: resolved.from,
    to: resolved.to,
    bucket,
  });

  // Per-赛道 rollup over the same window (P0 §2). Not project-scoped.
  const trackStats = useTrackStats({ from: resolved.from, to: resolved.to });

  // The current user's 1-based rank within the (already sorted) leaderboard.
  const myRank = useMemo(() => {
    if (!user || !leaderboard.data) return undefined;
    const index = leaderboard.data.findIndex((e) => e.user.id === user.id);
    return index >= 0 ? index + 1 : undefined;
  }, [leaderboard.data, user]);

  const rangeLabel = RANGE_LABELS[filters.range];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">贡献统计</h1>
          <p className="text-sm text-muted-foreground">
            按完成任务数与点数衡量团队贡献，支持按项目与时间范围筛选。
          </p>
        </header>

        {/* Personal summary sits above the filter bar (per design); the filters
            below it drive the range/project it reflects. */}
        <PersonalSummary
          from={resolved.from}
          to={resolved.to}
          rangeLabel={rangeLabel}
          rank={myRank}
        />

        <StatFilters value={filters} onChange={setFilters} />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Left rail: leaderboard */}
          <div className="flex flex-col gap-3 lg:col-span-2">
            <h2 className="text-sm font-semibold text-foreground">排行榜</h2>
            <Leaderboard
              entries={leaderboard.data}
              sort={filters.sort}
              isLoading={leaderboard.isLoading}
              currentUserId={user?.id}
            />
          </div>

          {/* Right rail: charts */}
          <div className="flex flex-col gap-5">
            <ChartCard
              title="我的完成趋势"
              caption={bucket === 'day' ? '按天统计' : '按周统计'}
            >
              <TrendChart
                points={trend.data}
                bucket={bucket}
                metric={filters.sort}
                isLoading={trend.isLoading}
              />
            </ChartCard>
            <ChartCard
              title="成员对比"
              caption={filters.sort === 'points' ? '按点数' : '按完成数'}
            >
              <PerPersonChart
                entries={leaderboard.data}
                metric={filters.sort}
                isLoading={leaderboard.isLoading}
              />
            </ChartCard>
          </div>
        </div>

        {/* Per-赛道 rollup (P0 §2) — spans the full width below the leaderboard. */}
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">按赛道</h2>
          <TrackStatsPanel entries={trackStats.data} isLoading={trackStats.isLoading} />
        </div>
      </div>
    </div>
  );
}
