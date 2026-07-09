import { Route } from 'lucide-react';
import type { TrackStatsEntry } from 'shared';
import { EmptyState, Spinner } from '../../components/ui';
import { cn } from '../../lib/utils';

/**
 * Per-赛道 contribution panel (P0 §2 stats dimension). A compact ranked bar list of
 * tracks by 点数 (pointsSum), with 完成数 alongside — mirrors the leaderboard's card
 * styling. The synthetic no-track bucket renders as 「未归类」 and is de-emphasized.
 */
interface TrackStatsPanelProps {
  entries: TrackStatsEntry[] | undefined;
  isLoading?: boolean;
}

export function TrackStatsPanel({ entries, isLoading }: TrackStatsPanelProps): JSX.Element {
  if (isLoading && !entries) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-card py-16">
        <Spinner className="h-6 w-6" label="加载赛道统计" />
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <EmptyState
        icon={Route}
        title="暂无赛道数据"
        description="所选时间范围内还没有完成的任务。"
      />
    );
  }

  // Rank by points; ties keep server order. Scale bars to the top track.
  const sorted = [...entries].sort((a, b) => b.pointsSum - a.pointsSum);
  const max = Math.max(1, ...sorted.map((e) => e.pointsSum));

  return (
    <ol className="flex flex-col gap-2 motion-safe:animate-fade-in" aria-label="赛道贡献排行">
      {sorted.map((entry) => {
        const name = entry.trackName ?? '未归类';
        const isPool = entry.trackId === null;
        const pct = Math.round((entry.pointsSum / max) * 100);
        return (
          <li
            key={entry.trackId ?? '__ungrouped__'}
            className="rounded-xl border border-border bg-card px-4 py-3"
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={cn(
                  'min-w-0 truncate text-sm font-medium',
                  isPool ? 'italic text-muted-foreground' : 'text-foreground',
                )}
              >
                {name}
              </span>
              <div className="flex shrink-0 items-baseline gap-3 text-right tabular-nums">
                <span className="text-base font-bold text-foreground">{entry.pointsSum}</span>
                <span className="text-[11px] text-muted-foreground">点</span>
                <span className="text-xs text-muted-foreground">{entry.completedCount} 完成</span>
              </div>
            </div>
            {/* Relative-points bar */}
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={cn('h-full rounded-full', isPool ? 'bg-muted-foreground/40' : 'bg-primary')}
                style={{ width: `${pct}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
