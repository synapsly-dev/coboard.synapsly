import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { BarChart3 } from 'lucide-react';
import type { LeaderboardEntry, StatsSort, TrendBucket, TrendPoint } from 'shared';
import { EmptyState, Spinner } from '../../components/ui';
import { useMediaQuery, useReducedMotion } from '../../lib/use-media-query';
import { useTheme } from '../../lib/theme';

/**
 * Contribution charts (§6.4 视图, Recharts):
 *  - {@link TrendChart}: completed tasks over time (line) for one person.
 *  - {@link PerPersonChart}: completed/points per person (bar) across the team.
 *
 * Presentational: data + sort are supplied by the page. Both fill their parent
 * via {@link ResponsiveContainer}; the parent must give them a height.
 *
 * Colours track the quiet-luxe monochrome theme rather than a fixed saturated
 * blue: the trend line is the ink foreground (theme-aware), grid/ticks are the
 * neutral border/muted greys, and per-person bars reuse each member's own (muted)
 * avatar colour so the chart reads as one system with the rest of the app. Recharts
 * needs concrete colour strings (SVG attributes don't resolve CSS vars), so we
 * resolve them from the active theme in JS.
 */

/** Tailwind `sm` breakpoint (640px) and up — i.e. not a phone. */
const DESKTOP_QUERY = '(min-width: 640px)';

/** Theme-aware chart colours mirroring the design tokens (border / muted-fg /
 * foreground). */
function useChartColors(): {
  grid: string;
  tick: string;
  line: string;
  cursorStroke: string;
  cursorFill: string;
} {
  const { resolved } = useTheme();
  const dark = resolved === 'dark';
  return dark
    ? {
        grid: 'hsl(240 5% 18%)',
        tick: 'hsl(240 3% 62%)',
        line: 'hsl(60 5% 92%)',
        cursorStroke: 'hsl(60 5% 92% / 0.3)',
        cursorFill: 'hsl(240 5% 30% / 0.35)',
      }
    : {
        grid: 'hsl(60 6% 89%)',
        tick: 'hsl(240 2% 42%)',
        line: 'hsl(240 5% 12%)',
        cursorStroke: 'hsl(240 5% 12% / 0.22)',
        cursorFill: 'hsl(60 6% 85% / 0.5)',
      };
}

/** Muted fallback hues for per-person bars (mirrors the avatar palette), used
 * only if an entry somehow lacks its own avatar colour. */
const BAR_PALETTE = [
  '#96604e',
  '#4f7377',
  '#5e6e8c',
  '#8f7440',
  '#6f5a78',
  '#97606a',
  '#557165',
  '#7e6e4f',
];

/** Format a "YYYY-MM-DD" bucket start for the x-axis given its granularity. */
function formatBucketLabel(date: string, bucket: TrendBucket): string {
  try {
    const d = parseISO(date);
    return bucket === 'week' ? format(d, 'MM/dd') : format(d, 'M/d');
  } catch {
    return date;
  }
}

interface ChartCardProps {
  title: string;
  /** Optional caption shown under the title. */
  caption?: string;
  children: React.ReactNode;
}

/** Shared titled container so both charts share chrome. */
export function ChartCard({ title, caption, children }: ChartCardProps): JSX.Element {
  return (
    <section className="flex flex-col rounded-xl border border-border bg-card p-4">
      <header className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
      </header>
      <div className="h-64 w-full">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Trend (completed over time)
// ---------------------------------------------------------------------------

interface TrendChartProps {
  points: TrendPoint[] | undefined;
  bucket: TrendBucket;
  /** Which metric to plot — completed count or points sum. */
  metric: StatsSort;
  isLoading?: boolean;
}

export function TrendChart({
  points,
  bucket,
  metric,
  isLoading,
}: TrendChartProps): JSX.Element {
  const data = useMemo(
    () =>
      (points ?? []).map((p) => ({
        label: formatBucketLabel(p.date, bucket),
        value: metric === 'points' ? p.pointsSum : p.completedCount,
      })),
    [points, bucket, metric],
  );

  const hasData = data.some((d) => d.value > 0);
  const metricLabel = metric === 'points' ? '点数' : '完成数';
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const c = useChartColors();
  const reduced = useReducedMotion();
  // On phones a negative left margin clips the Y-axis ticks on the narrow card.
  const leftMargin = isDesktop ? -16 : 0;

  if (isLoading && !points) {
    return <ChartLoading />;
  }
  if (!hasData) {
    return (
      <EmptyState
        icon={BarChart3}
        title="暂无趋势数据"
        description="所选范围内没有完成记录。"
        className="h-full"
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: leftMargin, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 12, fill: c.tick }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 12, fill: c.tick }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip
          cursor={{ stroke: c.cursorStroke, strokeWidth: 1 }}
          content={<ChartTooltip metricLabel={metricLabel} />}
        />
        <Line
          type="monotone"
          dataKey="value"
          name={metricLabel}
          stroke={c.line}
          strokeWidth={2}
          dot={{ r: 3, fill: c.line }}
          activeDot={{ r: 5 }}
          isAnimationActive={!reduced}
          animationDuration={600}
          animationEasing="ease-out"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Per-person (bar)
// ---------------------------------------------------------------------------

interface PerPersonChartProps {
  entries: LeaderboardEntry[] | undefined;
  metric: StatsSort;
  isLoading?: boolean;
  /** Cap on bars to keep the chart legible (top N by current sort). */
  limit?: number;
}

export function PerPersonChart({
  entries,
  metric,
  isLoading,
  limit = 8,
}: PerPersonChartProps): JSX.Element {
  // On phones the vertical bars force every Chinese name onto the x-axis where
  // they collide/clip at ~390px. Render a horizontal bar chart instead (names
  // on the y-axis) and cap the bar count so each row stays legible.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const c = useChartColors();
  const reduced = useReducedMotion();
  const effectiveLimit = isDesktop ? limit : Math.min(limit, 5);
  const data = useMemo(
    () =>
      (entries ?? []).slice(0, effectiveLimit).map((e) => ({
        name: e.user.displayName,
        value: metric === 'points' ? e.pointsSum : e.completedCount,
        // Tie each bar to the member's own (muted) avatar colour.
        color: e.user.avatarColor,
      })),
    [entries, metric, effectiveLimit],
  );

  const hasData = data.some((d) => d.value > 0);
  const metricLabel = metric === 'points' ? '点数' : '完成数';

  if (isLoading && !entries) {
    return <ChartLoading />;
  }
  if (!hasData) {
    return (
      <EmptyState
        icon={BarChart3}
        title="暂无成员数据"
        description="所选范围内还没有人完成任务。"
        className="h-full"
      />
    );
  }

  // Phone: horizontal bars with names down the y-axis (no overlap/clipping).
  if (!isDesktop) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: c.tick }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 12, fill: c.tick }}
            tickLine={false}
            axisLine={false}
            width={72}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: c.cursorFill }}
            content={<ChartTooltip metricLabel={metricLabel} />}
          />
          <Bar
            dataKey="value"
            name={metricLabel}
            radius={[0, 4, 4, 0]}
            maxBarSize={28}
            isAnimationActive={!reduced}
            animationDuration={600}
            animationEasing="ease-out"
          >
            {data.map((d, index) => (
              <Cell key={index} fill={d.color ?? BAR_PALETTE[index % BAR_PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12, fill: c.tick }}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 12, fill: c.tick }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip
          cursor={{ fill: c.cursorFill }}
          content={<ChartTooltip metricLabel={metricLabel} />}
        />
        <Bar
          dataKey="value"
          name={metricLabel}
          radius={[4, 4, 0, 0]}
          maxBarSize={48}
          isAnimationActive={!reduced}
          animationDuration={600}
          animationEasing="ease-out"
        >
          {data.map((d, index) => (
            <Cell key={index} fill={d.color ?? BAR_PALETTE[index % BAR_PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function ChartLoading(): JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="h-6 w-6" label="加载图表" />
    </div>
  );
}

interface TooltipPayloadItem {
  value?: number | string;
}

/** Minimal Chinese tooltip matching Recharts' content render contract. */
function ChartTooltip({
  active,
  label,
  payload,
  metricLabel,
}: {
  active?: boolean;
  label?: string | number;
  payload?: TooltipPayloadItem[];
  metricLabel: string;
}): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0]?.value ?? 0;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{label}</p>
      <p className="text-muted-foreground">
        {metricLabel}：<span className="font-semibold text-foreground">{value}</span>
      </p>
    </div>
  );
}
