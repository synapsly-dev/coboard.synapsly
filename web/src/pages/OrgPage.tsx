import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BriefcaseBusiness, GitBranch, List, Network } from 'lucide-react';
import type { MoveOrgNodeInput, OrgNode, OrgNodeKind, OrgScope } from 'shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Spinner,
} from '../components/ui';
import { cn } from '../lib/utils';
import { queryKeys } from '../lib/query';
import { useAuth } from '../lib/auth-context';
import { usersApi } from '../api/users';
import { useDeleteOrgNode, useMoveOrgNode, useOrgApplications, useOrgTree } from '../api/org';
import { useTrackMemberCandidates } from '../api/tracks';
import { buildTree, descendantCount, type OrgTreeNode } from '../features/org/tree';
import { canEditOrgScope } from '../features/org/permissions';
import { OrgChartView } from '../features/org/chart/OrgChartView';
import { OrgAddNodeButton } from '../features/org/OrgAddNodeButton';
import { OrgNodeRow } from '../features/org/OrgNodeRow';
import { OrgNodeDialog } from '../features/org/OrgNodeDialog';
import { OrgMembersDialog, type OrgCandidate } from '../features/org/OrgMembersDialog';
import { OrgAddPeopleDialog } from '../features/org/OrgAddPeopleDialog';
import { RecruitView } from '../features/org/RecruitView';

/**
 * 团队架构 (/org) — a flexible, editable org tree showing division of labor and
 * positions. Any member may view; global admins may edit directly. Per-node controls
 * expose add / edit / members from the chart and add / edit / reorder / delete from
 * the list. Structure changes go through button-based move primitives; SSE keeps
 * everyone's view fresh. The 招募 view (P1 岗位申报) turns `position` nodes into a
 * recruiting board where members 申报 and approvers 录用/婉拒.
 */

const WHOLE_TEAM: OrgScope = 'all';

type NodeDialogState =
  | { mode: 'create'; parentId: string | null; defaultKind?: OrgNodeKind }
  | { mode: 'edit'; node: OrgNode }
  | null;

export default function OrgPage(): JSX.Element {
  const { user } = useAuth();
  // Default to the org chart (图谱); admins can edit in place.
  const [view, setView] = useState<'list' | 'chart' | 'recruit'>('chart');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [nodeDialog, setNodeDialog] = useState<NodeDialogState>(null);
  const [membersNode, setMembersNode] = useState<OrgNode | null>(null);
  const [addPeopleNode, setAddPeopleNode] = useState<OrgNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrgTreeNode | null>(null);

  const { data: nodes, isLoading, isError, refetch } = useOrgTree(WHOLE_TEAM);

  const editable = canEditOrgScope(user, WHOLE_TEAM, undefined);

  const canManageNodeMembers = (node: OrgNode): boolean =>
    editable ||
    (node.trackId !== null &&
      user !== null &&
      node.leads.some((person) => person.userId === user.id));
  const canManageAnyNode = editable || (nodes ?? []).some(canManageNodeMembers);

  // Whichever roster dialog is open needs the same candidate directory.
  const rosterNode = membersNode ?? addPeopleNode;

  const trackCandidatesQuery = useTrackMemberCandidates(
    rosterNode?.trackId ?? null,
    rosterNode !== null && canManageNodeMembers(rosterNode),
  );

  // Admins use the full user-management list; track managers use the public-safe,
  // track-scoped candidate directory exposed specifically for roster editing.
  const allUsersQuery = useQuery({
    queryKey: queryKeys.users(),
    queryFn: async ({ signal }) => (await usersApi.list(signal)).users,
    enabled: editable,
  });
  const candidates: OrgCandidate[] = useMemo(() => {
    const source =
      rosterNode?.trackId != null
        ? (trackCandidatesQuery.data ?? [])
        : (allUsersQuery.data ?? []).filter((candidate) => candidate.isActive);
    const normalized: OrgCandidate[] = source.map((candidate) => ({
      id: candidate.id,
      displayName: candidate.displayName,
      avatarColor: candidate.avatarColor,
      hasAvatar: candidate.hasAvatar,
    }));

    // Keep already-assigned people visible even if their account was deactivated
    // after assignment, so opening and saving the dialog never drops them silently.
    const seen = new Set(normalized.map((candidate) => candidate.id));
    for (const person of [...(rosterNode?.leads ?? []), ...(rosterNode?.members ?? [])]) {
      if (seen.has(person.userId)) continue;
      normalized.push({
        id: person.userId,
        displayName: person.displayName,
        avatarColor: person.avatarColor,
        hasAvatar: person.hasAvatar,
      });
      seen.add(person.userId);
    }
    return normalized;
  }, [allUsersQuery.data, rosterNode, trackCandidatesQuery.data]);
  const candidatesLoading =
    rosterNode?.trackId != null ? trackCandidatesQuery.isLoading : allUsersQuery.isLoading;

  const moveMut = useMoveOrgNode(WHOLE_TEAM);
  const deleteMut = useDeleteOrgNode(WHOLE_TEAM);

  // Approver inbox size (pending 申请 the caller may decide) → 招募 tab badge.
  const { data: appsData } = useOrgApplications(WHOLE_TEAM);
  const pendingRequestCount = useMemo(() => {
    const canDecide = new Set(appsData?.canDecideNodeIds ?? []);
    return (appsData?.applications ?? []).filter(
      (a) =>
        a.status === 'pending' &&
        canDecide.has(a.nodeId) &&
        (user === null || a.applicant.id !== user.id),
    ).length;
  }, [appsData, user]);

  const roots = useMemo(() => buildTree(nodes ?? []), [nodes]);
  const visibleRows = useMemo(() => flattenVisible(roots, collapsed), [roots, collapsed]);

  const toggleCollapse = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleMove = (id: string, input: MoveOrgNodeInput): void => {
    moveMut.mutate({ id, input });
  };

  const handleOpenMembers = (node: OrgNode): void => {
    if (canManageNodeMembers(node)) setMembersNode(node);
  };

  const handleAddPeople = (node: OrgNode): void => {
    if (canManageNodeMembers(node)) setAddPeopleNode(node);
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      {/* Header */}
      <div className="mx-auto flex w-full max-w-4xl shrink-0 flex-col px-4 pb-4 pt-6 sm:px-6">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Network className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">团队架构</h1>
            <p className="text-xs text-muted-foreground">团队分工与职位的可视化组织树</p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/* View toggle (icon-only): 图谱 / 列表 / 招募. */}
              <div className="inline-flex items-center rounded-md border border-border bg-background p-0.5">
                {(
                  [
                    { key: 'chart', label: '图谱', icon: GitBranch },
                    { key: 'list', label: '列表', icon: List },
                    { key: 'recruit', label: '招募', icon: BriefcaseBusiness },
                  ] as const
                ).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setView(key)}
                    className={cn(
                      'relative inline-flex items-center justify-center rounded p-1.5 transition-[background-color,color,transform] duration-base ease-standard active:scale-[0.94]',
                      view === key
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:-translate-y-0.5 hover:text-foreground',
                    )}
                    aria-pressed={view === key}
                    aria-label={
                      key === 'recruit' && pendingRequestCount > 0
                        ? `${label}（${pendingRequestCount} 个待处理申请）`
                        : label
                    }
                    title={label}
                  >
                    <Icon className="h-4 w-4" />
                    {key === 'recruit' && pendingRequestCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground">
                        {pendingRequestCount > 9 ? '9+' : pendingRequestCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {editable && (
                <OrgAddNodeButton
                  label="新建"
                  kind="department"
                  onSelectKind={(kind) =>
                    setNodeDialog({ mode: 'create', parentId: null, defaultKind: kind })
                  }
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div
        className={cn(
          'min-h-0 flex-1',
          view === 'chart' ? 'overflow-hidden' : 'overflow-y-auto scrollbar-thin',
        )}
      >
        {isLoading ? (
          <div className="flex h-full items-center justify-center px-6">
            <Spinner />
          </div>
        ) : isError ? (
          <div className="flex h-full items-center justify-center px-6">
            <EmptyState
              title="加载失败"
              description="无法加载团队架构，请重试。"
              action={
                <Button variant="outline" onClick={() => void refetch()}>
                  重试
                </Button>
              }
            />
          </div>
        ) : view === 'recruit' ? (
          // 招募 has its own empty state (positions, not nodes, are its subject).
          <RecruitView scope={WHOLE_TEAM} nodes={nodes ?? []} />
        ) : visibleRows.length === 0 && roots.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6">
            <EmptyState
              icon={Network}
              title="还没有架构"
              description={editable ? '开始搭建团队分工与职位。' : '管理员尚未搭建团队架构。'}
              action={
                editable ? (
                  <OrgAddNodeButton
                    label="新建"
                    kind="department"
                    onSelectKind={(kind) =>
                      setNodeDialog({ mode: 'create', parentId: null, defaultKind: kind })
                    }
                  />
                ) : undefined
              }
            />
          </div>
        ) : view === 'chart' ? (
          <OrgChartView
            roots={roots}
            editable={editable}
            onAddChild={(node, kind) =>
              setNodeDialog({ mode: 'create', parentId: node.id, defaultKind: kind })
            }
            onEdit={(node) => setNodeDialog({ mode: 'edit', node })}
            onMembers={canManageAnyNode ? handleOpenMembers : undefined}
            onAddMembers={canManageAnyNode ? handleAddPeople : undefined}
            canManageMembers={canManageNodeMembers}
          />
        ) : (
          <div className="mx-auto w-full max-w-4xl space-y-1.5 px-4 pb-6 sm:px-6">
            {visibleRows.map((node) => (
              <OrgNodeRow
                key={node.id}
                node={node}
                nodes={nodes ?? []}
                editable={editable}
                collapsed={collapsed.has(node.id)}
                onToggleCollapse={toggleCollapse}
                onAddChild={(n, kind) =>
                  setNodeDialog({ mode: 'create', parentId: n.id, defaultKind: kind })
                }
                onEdit={(n) => setNodeDialog({ mode: 'edit', node: n })}
                canManageMembers={canManageNodeMembers(node)}
                onMembers={handleOpenMembers}
                onAddMembers={handleAddPeople}
                onDelete={(n) => setDeleteTarget(n)}
                onMove={handleMove}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create / edit node dialog */}
      {nodeDialog?.mode === 'create' && (
        <OrgNodeDialog
          mode="create"
          scope={WHOLE_TEAM}
          parentId={nodeDialog.parentId}
          defaultKind={nodeDialog.defaultKind}
          open
          onOpenChange={(o) => !o && setNodeDialog(null)}
        />
      )}
      {nodeDialog?.mode === 'edit' && (
        <OrgNodeDialog
          mode="edit"
          scope={WHOLE_TEAM}
          node={nodeDialog.node}
          open
          onOpenChange={(o) => !o && setNodeDialog(null)}
        />
      )}

      {/* Members dialog (full tri-state batch editor, via ⋯) */}
      {membersNode && canManageNodeMembers(membersNode) && (
        <OrgMembersDialog
          scope={WHOLE_TEAM}
          node={membersNode}
          candidates={candidates}
          candidatesLoading={candidatesLoading}
          open
          onOpenChange={(o) => !o && setMembersNode(null)}
        />
      )}

      {/* Quick add-people dialog (＋加人 — append only) */}
      {addPeopleNode && canManageNodeMembers(addPeopleNode) && (
        <OrgAddPeopleDialog
          scope={WHOLE_TEAM}
          node={addPeopleNode}
          candidates={candidates}
          candidatesLoading={candidatesLoading}
          open
          onOpenChange={(o) => !o && setAddPeopleNode(null)}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除「{deleteTarget?.title}」？</DialogTitle>
            <DialogDescription>
              {deleteTarget && descendantCount(roots, deleteTarget.id) > 0
                ? `将一并删除其下 ${descendantCount(roots, deleteTarget.id)} 个子节点，此操作不可撤销。`
                : '此操作不可撤销。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteMut.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              loading={deleteMut.isPending}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Pre-order flatten that hides the descendants of collapsed nodes. */
function flattenVisible(roots: OrgTreeNode[], collapsed: Set<string>): OrgTreeNode[] {
  const out: OrgTreeNode[] = [];
  const walk = (node: OrgTreeNode): void => {
    out.push(node);
    if (!collapsed.has(node.id)) {
      for (const child of node.children) walk(child);
    }
  };
  for (const root of roots) walk(root);
  return out;
}
