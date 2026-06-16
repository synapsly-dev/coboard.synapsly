import { CheckCircle2, Hash, TrendingUp } from 'lucide-react';
import { Avatar, Spinner } from '../../components/ui';
import { useAuth } from '../../lib/auth-context';
import { avatarUrl, cn } from '../../lib/utils';
import { useMyStats } from '../../api/stats';

/**
 * Personal contribution summary card for the current user (§6.4). Shows the
 * authenticated user's completed-task count and points sum for the selected time
 * range, plus their rank when the leaderboard is available. Time bounds come from
 * the page-level filters (resolved to ISO strings).
 */

interface PersonalSummaryProps {
  from: string | undefined;
  to: string | undefined;
  /** Human-readable label for the active range (e.g. 本周), shown as a caption. */
  rangeLabel: string;
  /** The current user's 1-based rank within the leaderboard, if known. */
  rank?: number;
}

export function PersonalSummary({
  from,
  to,
  rangeLabel,
  rank,
}: PersonalSummaryProps): JSX.Element | null {
  const { user } = useAuth();
  const { data, isLoading } = useMyStats({ from, to });

  if (!user) return null;

  return (
    <section
      className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5"
      aria-label="我的贡献"
    >
      <div className="flex items-center gap-3">
        <Avatar
          name={user.displayName}
          color={user.avatarColor}
          imageUrl={user.hasAvatar ? avatarUrl(user.id) : undefined}
          size="md"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {user.displayName}
          </p>
          <p className="text-xs text-muted-foreground">我的贡献 · {rangeLabel}</p>
        </div>
        {rank !== undefined && (
          <div className="ml-auto flex flex-col items-end">
            <span className="text-2xl font-bold tabular-nums text-primary">#{rank}</span>
            <span className="text-[11px] text-muted-foreground">当前排名</span>
          </div>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <SummaryStat
          icon={CheckCircle2}
          label="完成任务"
          value={data?.completedCount}
          loading={isLoading}
          accent="text-success"
        />
        <SummaryStat
          icon={Hash}
          label="累计点数"
          value={data?.pointsSum}
          loading={isLoading}
          accent="text-primary"
        />
      </div>
    </section>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
  loading,
  accent,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: number | undefined;
  loading: boolean;
  accent: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-card/80 px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5', accent)} aria-hidden />
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-foreground">
        {loading && value === undefined ? (
          <Spinner className="h-5 w-5" label={`加载${label}`} />
        ) : (
          (value ?? 0)
        )}
      </div>
    </div>
  );
}
