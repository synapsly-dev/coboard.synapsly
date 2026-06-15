import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { TrendBucket } from 'shared';
import { ALL_PROJECTS, type StatFilterState, type TimeRangePreset } from './types';

/**
 * Resolve the page's filter state into the concrete query params the stats API
 * expects (§7). Time presets map to absolute ISO-8601 `from`/`to` bounds on
 * `completed_at`; "全部" (all) leaves both undefined so the server counts all
 * history. Weeks start on Monday to match the team's expectations (zh-CN).
 */

/** Resolved API params derived from the UI filters. */
export interface ResolvedStatsQuery {
  /** Concrete project id, or undefined for "all projects". */
  projectId: string | undefined;
  /** ISO-8601 lower bound, or undefined for unbounded. */
  from: string | undefined;
  /** ISO-8601 upper bound, or undefined for unbounded. */
  to: string | undefined;
}

/** Monday-based week to match zh-CN calendars. */
const WEEK_OPTIONS = { weekStartsOn: 1 } as const;

/** Parse a "YYYY-MM-DD" string into a local Date, or null when malformed. */
function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Compute [from, to] Dates for a non-custom preset (or null for "all"). */
function rangeForPreset(preset: TimeRangePreset, now: Date): [Date, Date] | null {
  switch (preset) {
    case 'week':
      return [startOfWeek(now, WEEK_OPTIONS), endOfWeek(now, WEEK_OPTIONS)];
    case 'month':
      return [startOfMonth(now), endOfMonth(now)];
    case 'all':
      return null;
    case 'custom':
      // Custom is resolved by the caller from explicit bounds.
      return null;
    default: {
      const _never: never = preset;
      return _never;
    }
  }
}

/**
 * Derive `{ projectId, from, to }` from the filter state. `now` is injectable for
 * deterministic tests; defaults to the current time.
 */
export function resolveStatsQuery(
  filters: StatFilterState,
  now: Date = new Date(),
): ResolvedStatsQuery {
  const projectId = filters.project === ALL_PROJECTS ? undefined : filters.project;

  if (filters.range === 'custom') {
    const from = parseDateOnly(filters.customFrom);
    const to = parseDateOnly(filters.customTo);
    return {
      projectId,
      from: from ? from.toISOString() : undefined,
      // Inclusive end-of-day so the chosen end date is fully covered.
      to: to ? endOfDay(to).toISOString() : undefined,
    };
  }

  const range = rangeForPreset(filters.range, now);
  if (!range) {
    return { projectId, from: undefined, to: undefined };
  }
  const [from, to] = range;
  return { projectId, from: from.toISOString(), to: to.toISOString() };
}

/**
 * Pick a trend bucket appropriate for the selected range: daily granularity for a
 * single week, weekly for broader windows so the chart stays readable.
 */
export function bucketForRange(range: TimeRangePreset): TrendBucket {
  return range === 'week' ? 'day' : 'week';
}
