import { useEffect, useState } from 'react';
import { Check, Clock, Crown, LogOut, Send } from 'lucide-react';
import type { OrgNode, OrgScope } from 'shared';
import { Button, Tooltip } from '../../components/ui';
import { isApiClientError } from '../../api/client';
import {
  useApplyToPosition,
  useLeaveOrgNode,
  useOrgApplications,
  useWithdrawApplication,
} from '../../api/org';
import { useAuth } from '../../lib/auth-context';
import { cn } from '../../lib/utils';
import { isPositionFull } from './labels';
import { TrackMembershipAction } from './TrackMembershipAction';

/**
 * The single membership affordance shown on every org unit, in every view (list /
 * 星图 / 大纲树 / 岗位图). It adapts to the unit and the caller:
 *
 * - 赛道 (track) → delegates to {@link TrackMembershipAction}: direct 加入 / 退出,
 *   manager badge (unchanged — tracks self-join instantly).
 * - 部门 / 小组 / 岗位 → the approval flow (2026-07-13): a non-member 申请加入
 *   (申报 for a 岗位), sees 申请中 while pending (click to withdraw), 已加入 once a
 *   member (click to 退出, guarded by a two-step confirm), a crown badge as 负责人,
 *   or a disabled 名额已满 for a full 岗位.
 *
 * The caller's pending application is read from the shared {@link useOrgApplications}
 * cache (deduped across every node that renders this).
 */
interface NodeMembershipActionProps {
  node: OrgNode;
  scope?: OrgScope;
  /** Compact copy (shorter labels) for dense rows. */
  compact?: boolean;
  /** Icon-only circular button for the 星图 planets. */
  iconOnly?: boolean;
  /**
   * The caller manages this node (admin / 负责人). When true, a non-member is NOT
   * shown 申请加入 — they add people (themselves included) via the ＋加人 control —
   * but their own 负责人/已加入/申请中 status still shows.
   */
  canManage?: boolean;
  className?: string;
}

export function NodeMembershipAction({
  node,
  scope = 'all',
  compact = false,
  iconOnly = false,
  canManage = false,
  className,
}: NodeMembershipActionProps): JSX.Element | null {
  const { user } = useAuth();

  // 赛道 keeps its instant self-join affordance (unchanged; even admins may join).
  if (node.kind === 'track') {
    return (
      <TrackMembershipAction
        node={node}
        compact={compact}
        iconOnly={iconOnly}
        className={className}
      />
    );
  }

  if (!user) return null;
  return (
    <ApplyMembershipAction
      node={node}
      scope={scope}
      iconOnly={iconOnly}
      canManage={canManage}
      className={className}
    />
  );
}

function ApplyMembershipAction({
  node,
  scope,
  iconOnly,
  canManage,
  className,
}: Required<Pick<NodeMembershipActionProps, 'node' | 'scope' | 'iconOnly' | 'canManage'>> & {
  className?: string;
}): JSX.Element | null {
  const { user } = useAuth();
  const applyMut = useApplyToPosition(scope);
  const withdrawMut = useWithdrawApplication(scope);
  const leaveMut = useLeaveOrgNode(scope);
  const { data: applicationsData } = useOrgApplications(scope);
  const [error, setError] = useState<string | null>(null);
  // Two-step guard so a stray click never drops a hard-won membership.
  const [confirmLeave, setConfirmLeave] = useState(false);
  useEffect(() => {
    if (!confirmLeave) return;
    const t = window.setTimeout(() => setConfirmLeave(false), 2600);
    return () => window.clearTimeout(t);
  }, [confirmLeave]);

  if (!user) return null;

  const isLead = node.leads.some((p) => p.userId === user.id);
  const isMember = node.members.some((p) => p.userId === user.id);
  const pending = (applicationsData?.applications ?? []).find(
    (a) => a.nodeId === node.id && a.applicant.id === user.id && a.status === 'pending',
  );
  // A manager with no personal relationship to the node adds people via ＋加人, so
  // suppress the self-apply button (their own membership status still shows below).
  if (canManage && !isLead && !isMember && !pending) return null;
  const busy = applyMut.isPending || withdrawMut.isPending || leaveMut.isPending;
  const isPosition = node.kind === 'position';

  // 负责人: a crown badge, no self-service action (an admin reassigns).
  if (isLead) {
    const badge = (
      <span
        className={cn(
          'inline-flex h-6 shrink-0 items-center justify-center gap-1 bg-amber-500/10 text-[11px] font-medium text-amber-700 dark:text-amber-400',
          iconOnly ? 'w-6 rounded-full border border-amber-500/20' : 'rounded-md px-1.5',
          className,
        )}
        title="负责人"
      >
        <Crown className="h-3 w-3" />
        {!iconOnly && '负责人'}
      </span>
    );
    return iconOnly ? <Tooltip content="负责人">{badge}</Tooltip> : badge;
  }

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
    } catch (cause) {
      setError(isApiClientError(cause) ? cause.message : '操作失败，请重试');
    }
  };

  // Resolve the current state into { icon, label, tone, onClick, tip }.
  type Tone = 'apply' | 'pending' | 'member' | 'confirm' | 'full' | 'error';
  let tone: Tone;
  let label: string;
  let tip: string;
  let icon: JSX.Element | null;
  let onClick: (() => void) | undefined;

  if (error) {
    tone = 'error';
    label = '重试';
    tip = error;
    icon = <Send className="h-3 w-3" />;
    onClick = () => void run(() => applyMut.mutateAsync({ nodeId: node.id, input: {} }));
  } else if (isMember) {
    if (confirmLeave) {
      tone = 'confirm';
      label = '确认退出';
      tip = `退出${node.title}`;
      icon = <LogOut className="h-3 w-3" />;
      onClick = () =>
        void run(() => leaveMut.mutateAsync(node.id)).then(() => setConfirmLeave(false));
    } else {
      tone = 'member';
      label = '已加入';
      tip = `已加入 · 点击退出${node.title}`;
      icon = <Check className="h-3 w-3" />;
      onClick = () => setConfirmLeave(true);
    }
  } else if (pending) {
    tone = 'pending';
    label = '申请中';
    tip = `已申请加入${node.title} · 点击撤回`;
    icon = <Clock className="h-3 w-3" />;
    onClick = () => void run(() => withdrawMut.mutateAsync(pending.id));
  } else if (isPosition && isPositionFull(node)) {
    tone = 'full';
    label = '名额已满';
    tip = `${node.title}名额已满`;
    icon = null;
    onClick = undefined;
  } else {
    tone = 'apply';
    // 部门/小组/岗位 all require approval — never show the bare "加入" reserved for a
    // 赛道's instant self-join, so the distinction stays honest.
    label = isPosition ? '申报' : '申请加入';
    tip = `申请加入${node.title}`;
    icon = <Send className="h-3 w-3" />;
    onClick = () => void run(() => applyMut.mutateAsync({ nodeId: node.id, input: {} }));
  }

  // A full 岗位 has no actionable affordance; on the compact 星图 planet just omit it
  // (the occupancy chip already says 名额已满).
  if (tone === 'full' && iconOnly) return null;

  const toneClass: Record<Tone, string> = {
    apply: 'text-foreground',
    pending: 'text-amber-700 dark:text-amber-400',
    member: 'text-muted-foreground',
    confirm: 'text-destructive',
    full: 'text-muted-foreground/70',
    error: 'text-destructive',
  };

  const button = (
    <Button
      type="button"
      variant={tone === 'apply' || tone === 'confirm' ? 'outline' : 'ghost'}
      size={iconOnly ? 'icon' : 'sm'}
      className={cn(
        'h-6 shrink-0 gap-1 text-[11px]',
        iconOnly ? 'w-6 rounded-full bg-card p-0 shadow-sm' : 'px-1.5',
        toneClass[tone],
        className,
      )}
      loading={busy}
      disabled={onClick === undefined}
      title={tip}
      aria-label={tip}
      onClick={
        onClick === undefined
          ? undefined
          : (event) => {
              event.stopPropagation();
              event.currentTarget.blur();
              onClick?.();
            }
      }
    >
      {!busy && icon}
      {!iconOnly && label}
    </Button>
  );

  return iconOnly ? <Tooltip content={tip}>{button}</Tooltip> : button;
}
