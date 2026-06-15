import type { StatsSort } from 'shared';

/**
 * Local UI state for the stats page filters (§6.4 维度). Project + time range +
 * sort. The time range is stored as a preset; concrete `from`/`to` ISO strings
 * are derived for the API (see {@link ./dateRange}). `custom` keeps explicit
 * calendar bounds.
 */

/** Sentinel for "all projects" in the project filter (vs a concrete project id). */
export const ALL_PROJECTS = 'all' as const;
export type ProjectFilter = typeof ALL_PROJECTS | string;

/** Time-range presets surfaced in the UI (§6.4: 本周 / 本月 / 全部 / 自定义). */
export type TimeRangePreset = 'week' | 'month' | 'all' | 'custom';

export interface StatFilterState {
  project: ProjectFilter;
  range: TimeRangePreset;
  /** Custom-range calendar bounds ("YYYY-MM-DD"); only used when range==='custom'. */
  customFrom: string;
  customTo: string;
  sort: StatsSort;
}

/** Sensible defaults: all projects, this week, sorted by completed count. */
export const DEFAULT_FILTERS: StatFilterState = {
  project: ALL_PROJECTS,
  range: 'week',
  customFrom: '',
  customTo: '',
  sort: 'count',
};
