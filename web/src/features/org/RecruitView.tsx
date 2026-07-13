import { useMemo, useState } from 'react';
import { BriefcaseBusiness, Crown, Send } from 'lucide-react';
import type { OrgApplication, OrgNode, OrgNodeMember, OrgScope } from 'shared';
import {
  Avatar,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Label,
  Spinner,
  Textarea,
} from '../../components/ui';
import { avatarUrl, cn } from '../../lib/utils';
import { isApiClientError } from '../../api/client';
import { useAuth } from '../../lib/auth-context';
import {
  useApplyToPosition,
  useDecideApplication,
  useOrgApplications,
  useWithdrawApplication,
} from '../../api/org';
import { relativeTime } from '../board/format';
import { ancestorPath, buildTree, flattenTree } from './tree';
import {
  APPLICATION_STATUS_CHIP,
  APPLICATION_STATUS_LABELS,
  isPositionFull,
  occupancyShort,
} from './labels';

/**
 * 招募 view (P1 岗位申报) — a BOSS直聘-style recruiting board over the org tree's
 * `position` (岗位) nodes. Positions are grouped under their ancestor breadcrumb
 * (e.g. 「运营部 / 内容组」). Each card shows title, description, occupancy, and the
 * current holders; the action area adapts to the viewer (申报 / 已申报·撤回 / 已在岗 /
 * 已满). Approvers (nodes in `canDecideNodeIds`) additionally see the pending
 * applications on their positions with 录用 / 婉拒 controls. A 「我的申报」 section at
 * the bottom lists the caller's own applications with status chips. SSE `org` events
 * keep both the tree and the applications fresh.
 */

interface RecruitViewProps {
  scope: OrgScope;
  /** Flat node list from the page's tree query (shared cache). */
  nodes: OrgNode[];
}

type DecideTarget = { application: OrgApplication; decision: 'approve' | 'reject' };

export function RecruitView({ scope, nodes }: RecruitViewProps): JSX.Element {
  const { user } = useAuth();
  const appsQuery = useOrgApplications(scope);

  const [applyTo, setApplyTo] = useState<OrgNode | null>(null);
  const [withdrawTarget, setWithdrawTarget] = useState<OrgApplication | null>(null);
  const [decideTarget, setDecideTarget] = useState<DecideTarget | null>(null);

  // Positions in stable pre-order, grouped by their ancestor breadcrumb.
  const groups = useMemo(() => {
    const positions = flattenTree(buildTree(nodes)).filter((n) => n.kind === 'position');
    const map = new Map<string, OrgNode[]>();
    for (const p of positions) {
      const path = ancestorPath(nodes, p).join(' / ') || '未分组';
      const bucket = map.get(path);
      if (bucket) bucket.push(p);
      else map.set(path, [p]);
    }
    return [...map.entries()];
  }, [nodes]);
  const positionCount = groups.reduce((sum, [, list]) => sum + list.length, 0);

  const applications = useMemo(() => appsQuery.data?.applications ?? [], [appsQuery.data]);
  const canDecide = useMemo(
    () => new Set(appsQuery.data?.canDecideNodeIds ?? []),
    [appsQuery.data],
  );

  /** The caller's own applications, newest first (any status). */
  const myApplications = useMemo(() => {
    if (!user) return [];
    return applications
      .filter((a) => a.applicant.id === user.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [applications, user]);

  /** nodeId → the caller's own pending application there. */
  const myPendingByNode = useMemo(() => {
    const map = new Map<string, OrgApplication>();
    for (const a of myApplications) {
      if (a.status === 'pending') map.set(a.nodeId, a);
    }
    return map;
  }, [myApplications]);

  /** nodeId → pending applications the caller may decide (oldest first). */
  const decidableByNode = useMemo(() => {
    const map = new Map<string, OrgApplication[]>();
    for (const a of applications) {
      if (a.status !== 'pending' || !canDecide.has(a.nodeId)) continue;
      if (user && a.applicant.id === user.id) continue; // one's own 申报 stays in the card action area
      const bucket = map.get(a.nodeId);
      if (bucket) bucket.push(a);
      else map.set(a.nodeId, [a]);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    }
    return map;
  }, [applications, canDecide, user]);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  /**
   * 部门/小组 加入申请 the caller may decide (2026-07-13). Positions keep their own
   * per-card approver panel; department/group requests have no card, so surface them
   * in a dedicated top section. Oldest first.
   */
  const pendingJoinRequests = useMemo(() => {
    return applications
      .filter(
        (a) =>
          a.status === 'pending' &&
          canDecide.has(a.nodeId) &&
          (!user || a.applicant.id !== user.id) &&
          (nodeById.get(a.nodeId)?.kind ?? 'position') !== 'position',
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  }, [applications, canDecide, user, nodeById]);

  if (appsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 pb-6 sm:px-6">
      {appsQuery.isError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-sm text-muted-foreground">申报数据加载失败。</p>
          <Button variant="outline" size="sm" onClick={() => void appsQuery.refetch()}>
            重试
          </Button>
        </div>
      )}

      {pendingJoinRequests.length > 0 && (
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            待处理的加入申请 · {pendingJoinRequests.length}
          </h2>
          <div className="mt-2 space-y-2">
            {pendingJoinRequests.map((app) => (
              <div
                key={app.id}
                className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm"
              >
                <Avatar
                  name={app.applicant.displayName}
                  color={app.applicant.avatarColor}
                  imageUrl={app.applicant.hasAvatar ? avatarUrl(app.applicant.id) : undefined}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium text-foreground">{app.applicant.displayName}</span>{' '}
                    申请加入 <span className="font-medium text-foreground">{app.nodeTitle}</span>{' '}
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(app.createdAt)}
                    </span>
                  </p>
                  {app.note && (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                      {app.note}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="sm"
                    onClick={() => setDecideTarget({ application: app, decision: 'approve' })}
                  >
                    通过
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDecideTarget({ application: app, decision: 'reject' })}
                  >
                    驳回
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {positionCount === 0 && pendingJoinRequests.length === 0 ? (
        <EmptyState
          icon={BriefcaseBusiness}
          title="暂无招募岗位"
          description="管理员可在列表视图创建「岗位」节点并设置名额，即可在此开放申报。"
        />
      ) : positionCount === 0 ? null : (
        groups.map(([path, positions]) => (
          <section key={path}>
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {path}
            </h2>
            <div className="mt-2 space-y-2">
              {positions.map((node) => (
                <PositionCard
                  key={node.id}
                  node={node}
                  currentUserId={user?.id ?? null}
                  myPending={myPendingByNode.get(node.id)}
                  decidable={decidableByNode.get(node.id) ?? []}
                  onApply={() => setApplyTo(node)}
                  onWithdraw={(app) => setWithdrawTarget(app)}
                  onDecide={(application, decision) => setDecideTarget({ application, decision })}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {myApplications.length > 0 && (
        <section>
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            我的申报
          </h2>
          <div className="mt-2 space-y-1.5">
            {myApplications.map((app) => (
              <MyApplicationRow
                key={app.id}
                application={app}
                onWithdraw={() => setWithdrawTarget(app)}
              />
            ))}
          </div>
        </section>
      )}

      {applyTo && (
        <ApplyDialog
          scope={scope}
          node={applyTo}
          open
          onOpenChange={(o) => !o && setApplyTo(null)}
        />
      )}
      {withdrawTarget && (
        <WithdrawDialog
          scope={scope}
          application={withdrawTarget}
          open
          onOpenChange={(o) => !o && setWithdrawTarget(null)}
        />
      )}
      {decideTarget && (
        <DecideDialog
          scope={scope}
          application={decideTarget.application}
          decision={decideTarget.decision}
          isPosition={nodeById.get(decideTarget.application.nodeId)?.kind === 'position'}
          open
          onOpenChange={(o) => !o && setDecideTarget(null)}
        />
      )}
    </div>
  );
}

/** One recruitable 岗位 card: overview + viewer-specific action + approver panel. */
function PositionCard({
  node,
  currentUserId,
  myPending,
  decidable,
  onApply,
  onWithdraw,
  onDecide,
}: {
  node: OrgNode;
  currentUserId: string | null;
  myPending: OrgApplication | undefined;
  decidable: OrgApplication[];
  onApply: () => void;
  onWithdraw: (app: OrgApplication) => void;
  onDecide: (app: OrgApplication, decision: 'approve' | 'reject') => void;
}): JSX.Element {
  const holders: OrgNodeMember[] = [...node.leads, ...node.members];
  const onNode = currentUserId !== null && holders.some((m) => m.userId === currentUserId);
  const full = isPositionFull(node);

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-base ease-standard hover:-translate-y-0.5 hover:border-border/80 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-foreground">{node.title}</span>
            <span
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none',
                full
                  ? 'bg-slate-500/10 text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:text-slate-300'
                  : 'bg-secondary text-muted-foreground',
              )}
              title={node.headcount != null ? `名额 ${node.headcount}` : '不限名额'}
            >
              {occupancyShort(node)}
            </span>
          </div>

          {node.description && (
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
              {node.description}
            </p>
          )}

          {holders.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {node.leads.map((p) => (
                <span key={p.userId} className="inline-flex items-center gap-1.5">
                  <span className="relative">
                    <Avatar
                      name={p.displayName}
                      color={p.avatarColor}
                      imageUrl={p.hasAvatar ? avatarUrl(p.userId) : undefined}
                      size="xs"
                    />
                    <Crown className="absolute -right-1 -top-1.5 h-3 w-3 rotate-12 fill-amber-400 text-amber-500" />
                  </span>
                  <span className="text-xs font-medium text-foreground">{p.displayName}</span>
                </span>
              ))}
              {node.members.length > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="flex -space-x-2">
                    {node.members.slice(0, 6).map((p) => (
                      <Avatar
                        key={p.userId}
                        name={p.displayName}
                        color={p.avatarColor}
                        imageUrl={p.hasAvatar ? avatarUrl(p.userId) : undefined}
                        size="xs"
                        className="ring-2 ring-card"
                      />
                    ))}
                  </span>
                  {node.members.length > 6 && (
                    <span className="text-xs text-muted-foreground">
                      +{node.members.length - 6}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 pt-0.5">
          {onNode ? (
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400">
              已在岗
            </span>
          ) : myPending ? (
            <Button variant="outline" size="sm" onClick={() => onWithdraw(myPending)}>
              已申报 · 撤回
            </Button>
          ) : full ? (
            <span className="inline-flex items-center rounded-full bg-slate-500/10 px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:text-slate-300">
              已满
            </span>
          ) : (
            <Button size="sm" onClick={onApply}>
              <Send className="h-3.5 w-3.5" />
              申报
            </Button>
          )}
        </div>
      </div>

      {/* Approver panel — pending 申报 on positions the viewer may decide. */}
      {decidable.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted-foreground">
            待处理申报 · {decidable.length}
          </p>
          <div className="mt-2 space-y-2">
            {decidable.map((app) => (
              <div
                key={app.id}
                className="flex items-start gap-2.5 rounded-lg bg-secondary/40 px-3 py-2"
              >
                <Avatar
                  name={app.applicant.displayName}
                  color={app.applicant.avatarColor}
                  imageUrl={app.applicant.hasAvatar ? avatarUrl(app.applicant.id) : undefined}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium text-foreground">{app.applicant.displayName}</span>{' '}
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(app.createdAt)}
                    </span>
                  </p>
                  {app.note && (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                      {app.note}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button size="sm" onClick={() => onDecide(app, 'approve')}>
                    录用
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onDecide(app, 'reject')}>
                    婉拒
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** One row of 「我的申报」 — node title, status chip, timestamps, and notes. */
function MyApplicationRow({
  application,
  onWithdraw,
}: {
  application: OrgApplication;
  onWithdraw: () => void;
}): JSX.Element {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-foreground">
            {application.nodeTitle}
          </span>
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none',
              APPLICATION_STATUS_CHIP[application.status],
            )}
          >
            {APPLICATION_STATUS_LABELS[application.status]}
          </span>
          <span className="text-xs text-muted-foreground">
            {relativeTime(application.decidedAt ?? application.createdAt)}
          </span>
        </div>
        {application.note && (
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            申报理由：{application.note}
          </p>
        )}
        {application.decisionNote && (
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            处理备注：{application.decisionNote}
          </p>
        )}
      </div>
      {application.status === 'pending' && (
        <Button variant="ghost" size="sm" className="shrink-0" onClick={onWithdraw}>
          撤回
        </Button>
      )}
    </div>
  );
}

/** 申报 dialog — optional 申报理由, then POST /org/nodes/:id/applications. */
function ApplyDialog({
  scope,
  node,
  open,
  onOpenChange,
}: {
  scope: OrgScope;
  node: OrgNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const applyMut = useApplyToPosition(scope);

  const submit = async (): Promise<void> => {
    setError(null);
    const trimmed = note.trim();
    try {
      await applyMut.mutateAsync({
        nodeId: node.id,
        input: trimmed ? { note: trimmed } : {},
      });
      onOpenChange(false);
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '申报失败，请重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>申报「{node.title}」</DialogTitle>
          <DialogDescription>提交后由该岗位的负责人或管理员处理。</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="org-apply-note">申报理由（可选）</Label>
          <Textarea
            id="org-apply-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="说说你为什么适合这个岗位…"
            rows={4}
            maxLength={2000}
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={applyMut.isPending}>
            取消
          </Button>
          <Button onClick={() => void submit()} loading={applyMut.isPending}>
            提交申报
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Confirm withdrawing one's own pending 申报 (DELETE /org/applications/:id). */
function WithdrawDialog({
  scope,
  application,
  open,
  onOpenChange,
}: {
  scope: OrgScope;
  application: OrgApplication;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const withdrawMut = useWithdrawApplication(scope);

  const submit = async (): Promise<void> => {
    setError(null);
    try {
      await withdrawMut.mutateAsync(application.id);
      onOpenChange(false);
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '撤回失败，请重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>撤回申报？</DialogTitle>
          <DialogDescription>
            将撤回对「{application.nodeTitle}」的申报，之后仍可重新申报。
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={withdrawMut.isPending}
          >
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={() => void submit()}
            loading={withdrawMut.isPending}
          >
            撤回
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 录用 / 婉拒 confirm with an optional 备注 (visible to the applicant). Surfaces the
 * server's 409s (岗位已满 / 已处理) through the ApiClientError message, like other
 * forms.
 */
function DecideDialog({
  scope,
  application,
  decision,
  isPosition = true,
  open,
  onOpenChange,
}: {
  scope: OrgScope;
  application: OrgApplication;
  decision: 'approve' | 'reject';
  /** Positions read 录用/婉拒 (recruiting); 部门/小组 read 通过/驳回. */
  isPosition?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decideMut = useDecideApplication(scope);
  const approve = decision === 'approve';
  const approveVerb = isPosition ? '录用' : '通过';
  const rejectVerb = isPosition ? '婉拒' : '驳回';
  const verb = approve ? approveVerb : rejectVerb;

  const submit = async (): Promise<void> => {
    setError(null);
    const trimmed = note.trim();
    try {
      await decideMut.mutateAsync({
        id: application.id,
        decision,
        input: trimmed ? { note: trimmed } : {},
      });
      onOpenChange(false);
    } catch (err) {
      setError(isApiClientError(err) ? err.message : '操作失败，请重试');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {verb} {application.applicant.displayName}？
          </DialogTitle>
          <DialogDescription>
            {approve
              ? `将把 ${application.applicant.displayName} 加入「${application.nodeTitle}」。`
              : isPosition
                ? '婉拒后对方可再次申报该岗位。'
                : '驳回后对方可再次申请加入。'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="org-decide-note">备注（可选，对方可见）</Label>
          <Textarea
            id="org-decide-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={approve ? '欢迎加入…' : '说明婉拒原因…'}
            rows={3}
            maxLength={2000}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={decideMut.isPending}
          >
            取消
          </Button>
          <Button
            variant={approve ? 'primary' : 'destructive'}
            onClick={() => void submit()}
            loading={decideMut.isPending}
          >
            {verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
