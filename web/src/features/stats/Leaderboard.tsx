import { Medal, Trophy } from 'lucide-react';
import type { LeaderboardEntry, StatsSort } from 'shared';
import { Avatar, Badge, EmptyState, Spinner, Tooltip } from '../../components/ui';
import { avatarUrl, cn } from '../../lib/utils';

/**
 * Contribution leaderboard (§6.4 排行榜). Ranked per-user list with avatar,
 * completed count, and points sum. Top 3 get medal styling; the metric the list
 * is sorted by (完成数 / 点数) is emphasized. Pure presentational — the page
 * supplies the data and current sort.
 */

interface LeaderboardProps {
  entries: LeaderboardEntry[] | undefined;
  /** Which metric the list is ranked by — drives emphasis. */
  sort: StatsSort;
  isLoading?: boolean;
  /** Optional: highlight the current user's row. */
  currentUserId?: string;
}

/** Tailwind classes for the top-3 medal accents (gold / silver / bronze). */
const MEDAL_STYLES: Record<number, { ring: string; icon: string; badge: string }> = {
  1: {
    ring: 'ring-2 ring-amber-400/70',
    icon: 'text-amber-500',
    badge: 'bg-amber-100 text-amber-700',
  },
  2: {
    ring: 'ring-2 ring-slate-300',
    icon: 'text-slate-400',
    badge: 'bg-slate-100 text-slate-600',
  },
  3: {
    ring: 'ring-2 ring-orange-400/60',
    icon: 'text-orange-600',
    badge: 'bg-orange-100 text-orange-700',
  },
};

function RankBadge({ rank }: { rank: number }): JSX.Element {
  const medal = MEDAL_STYLES[rank];
  if (medal) {
    return (
      <span
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold',
          medal.badge,
        )}
        aria-hidden
      >
        <Medal className={cn('h-4 w-4', medal.icon)} />
      </span>
    );
  }
  return (
    <span
      className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground"
      aria-hidden
    >
      {rank}
    </span>
  );
}

export function Leaderboard({
  entries,
  sort,
  isLoading,
  currentUserId,
}: LeaderboardProps): JSX.Element {
  if (isLoading && !entries) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-card py-16">
        <Spinner className="h-6 w-6" label="加载排行榜" />
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <EmptyState
        icon={Trophy}
        title="暂无贡献数据"
        description="所选时间范围内还没有完成的任务。"
      />
    );
  }

  return (
    <ol className="flex flex-col gap-2 motion-safe:animate-fade-in" aria-label="贡献排行榜">
      {entries.map((entry, index) => {
        const rank = index + 1;
        const medal = MEDAL_STYLES[rank];
        const isMe = currentUserId !== undefined && entry.user.id === currentUserId;
        return (
          <li
            key={entry.user.id}
            className={cn(
              'flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors',
              isMe && 'border-primary/40 bg-primary/5',
            )}
          >
            <RankBadge rank={rank} />
            <Avatar
              name={entry.user.displayName}
              color={entry.user.avatarColor}
              imageUrl={entry.user.hasAvatar ? avatarUrl(entry.user.id) : undefined}
              size="sm"
              className={medal?.ring}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">
                  {entry.user.displayName}
                </span>
                {isMe && (
                  <Badge variant="primary" className="shrink-0">
                    我
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-right sm:gap-5">
              <Metric
                label="完成"
                value={entry.completedCount}
                emphasized={sort === 'count'}
              />
              <Metric
                label="点数"
                value={entry.pointsSum}
                emphasized={sort === 'points'}
                // Breakdown: 任务点数 + 奖励点数 (§7.1), surfaced only when rewards exist.
                breakdown={
                  entry.rewardPoints > 0
                    ? `任务 ${entry.taskPoints} 点 + 奖励 ${entry.rewardPoints} 点`
                    : undefined
                }
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Metric({
  label,
  value,
  emphasized,
  breakdown,
}: {
  label: string;
  value: number;
  emphasized: boolean;
  /** Optional tooltip detail (e.g. the task-vs-reward points split). */
  breakdown?: string;
}): JSX.Element {
  const cell = (
    <div className="flex flex-col items-end">
      <span
        className={cn(
          'tabular-nums leading-tight',
          emphasized
            ? 'text-lg font-bold text-foreground'
            : 'text-base font-semibold text-muted-foreground',
          // The dotted underline only signals a hover tooltip, which never opens
          // on touch — so only show the affordance from sm+ where the tooltip works.
          breakdown && 'sm:cursor-help sm:underline sm:decoration-dotted sm:underline-offset-4',
        )}
      >
        {value}
      </span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {/* Phones can't open the hover tooltip, so surface the breakdown inline. */}
      {breakdown && (
        <span className="text-[10px] leading-tight tabular-nums text-muted-foreground sm:hidden">
          {breakdown}
        </span>
      )}
    </div>
  );
  if (!breakdown) return cell;
  // Keep the hover tooltip for sm+ (it's touch-inaccessible); the sm:hidden inline
  // caption inside `cell` already covers phones, so the tooltip is just a bonus there.
  return <Tooltip content={breakdown}>{cell}</Tooltip>;
}
