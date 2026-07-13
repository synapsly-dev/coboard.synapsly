import { useState } from 'react';
import { Crown, LogIn, LogOut } from 'lucide-react';
import type { OrgNode } from 'shared';
import { Button, Tooltip } from '../../components/ui';
import { isApiClientError } from '../../api/client';
import { useJoinTrack, useLeaveTrack } from '../../api/tracks';
import { useAuth } from '../../lib/auth-context';
import { cn } from '../../lib/utils';

interface TrackMembershipActionProps {
  node: OrgNode;
  compact?: boolean;
  iconOnly?: boolean;
  className?: string;
}

/** Join/leave affordance rendered directly on a real Track organization card. */
export function TrackMembershipAction({
  node,
  compact = false,
  iconOnly = false,
  className,
}: TrackMembershipActionProps): JSX.Element | null {
  const { user } = useAuth();
  const joinMut = useJoinTrack();
  const leaveMut = useLeaveTrack();
  const [error, setError] = useState<string | null>(null);

  if (!user || node.kind !== 'track' || node.trackId === null) return null;
  const trackId = node.trackId;

  const isManager = node.leads.some((person) => person.userId === user.id);
  const isMember = node.members.some((person) => person.userId === user.id);
  const pending = joinMut.isPending || leaveMut.isPending;

  if (isManager) {
    const managerBadge = (
      <span
        className={cn(
          'inline-flex h-6 shrink-0 items-center justify-center gap-1 bg-amber-500/10 text-[11px] font-medium text-amber-700 dark:text-amber-400',
          iconOnly ? 'w-6 rounded-full border border-amber-500/20' : 'rounded-md px-1.5',
          className,
        )}
        title="赛道经理不能直接退出，请先移交角色"
      >
        <Crown className="h-3 w-3" />
        {!iconOnly && (compact ? '经理' : '赛道经理')}
      </span>
    );
    return iconOnly ? <Tooltip content="赛道经理">{managerBadge}</Tooltip> : managerBadge;
  }

  const act = async (): Promise<void> => {
    setError(null);
    try {
      if (isMember) await leaveMut.mutateAsync(trackId);
      else await joinMut.mutateAsync(trackId);
    } catch (cause) {
      setError(isApiClientError(cause) ? cause.message : '操作失败，请重试');
    }
  };

  const label = error ? '重试' : isMember ? '退出' : '加入';
  const actionButton = (
    <Button
      type="button"
      variant={isMember ? 'ghost' : 'outline'}
      size={iconOnly ? 'icon' : 'sm'}
      className={cn(
        'h-6 shrink-0 gap-1 text-[11px]',
        iconOnly ? 'w-6 rounded-full bg-card p-0 shadow-sm' : 'px-1.5',
        isMember && 'text-muted-foreground',
        error && 'text-destructive',
        className,
      )}
      loading={pending}
      title={error ?? (isMember ? `退出${node.title}` : `加入${node.title}`)}
      aria-label={error ?? (isMember ? `退出${node.title}` : `加入${node.title}`)}
      onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.blur();
        void act();
      }}
    >
      {!pending && (isMember ? <LogOut className="h-3 w-3" /> : <LogIn className="h-3 w-3" />)}
      {!iconOnly && label}
    </Button>
  );
  return iconOnly ? (
    <Tooltip content={error ?? (isMember ? '退出赛道' : '加入赛道')}>{actionButton}</Tooltip>
  ) : (
    actionButton
  );
}
