/**
 * Barrel for the contribution-stats feature (§6.4). The StatsPage composes these;
 * keep this the single import surface for the feature.
 */
export { StatFilters } from './StatFilters';
export { Leaderboard } from './Leaderboard';
export { PersonalSummary } from './PersonalSummary';
export { ChartCard, TrendChart, PerPersonChart } from './ContributionChart';
export {
  ALL_PROJECTS,
  DEFAULT_FILTERS,
  type StatFilterState,
  type ProjectFilter,
  type TimeRangePreset,
} from './types';
export { resolveStatsQuery, bucketForRange, type ResolvedStatsQuery } from './dateRange';
