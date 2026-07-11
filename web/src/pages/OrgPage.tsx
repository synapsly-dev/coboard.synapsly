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
import { useDeleteOrgNode, useMoveOrgNode, useOrgTree } from '../api/org';
import { buildTree, descendantCount, type OrgTreeNode } from '../features/org/tree';
import { canEditOrgScope } from '../features/org/permissions';
import { OrgChartView } from '../features/org/chart/OrgChartView';
import { OrgAddNodeButton } from '../features/org/OrgAddNodeButton';
import { OrgNodeRow } from '../features/org/OrgNodeRow';
import { OrgNodeDialog } from '../features/org/OrgNodeDialog';
import { OrgMembersDialog, type OrgCandidate } from '../features/org/OrgMembersDialog';
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
  const [deleteTarget, setDeleteTarget] = useState<OrgTreeNode | null>(null);

  const { data: nodes, isLoading, isError, refetch } = useOrgTree(WHOLE_TEAM);

  const editable = canEditOrgScope(user, WHOLE_TEAM, undefined);

  // Candidate people for the members dialog: all active users in the workspace.
  const allUsersQuery = useQuery({
    queryKey: queryKeys.users(),
    queryFn: async ({ signal }) => (await usersApi.list(signal)).users,
    enabled: editable,
  });
  const candidates: OrgCandidate[] = useMemo(() => {
    return (allUsersQuery.data ?? [])
      .filter((u) => u.isActive)
      .map((u) => ({
        id: u.id,
        displayName: u.displayName,
        avatarColor: u.avatarColor,
        hasAvatar: u.hasAvatar,
      }));
  }, [allUsersQuery.data]);
  const candidatesLoading = allUsersQuery.isLoading;

  const moveMut = useMoveOrgNode(WHOLE_TEAM);
  const deleteMut = useDeleteOrgNode(WHOLE_TEAM);

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
                      'inline-flex items-center justify-center rounded p-1.5 transition-[background-color,color,transform] duration-base ease-standard active:scale-[0.94]',
                      view === key
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:-translate-y-0.5 hover:text-foreground',
                    )}
                    aria-pressed={view === key}
                    aria-label={label}
                    title={label}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
              </div>

              {editable && (
                <OrgAddNodeButton
                  label="新建根部门"
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
                    label="新建根部门"
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
            onMembers={(node) => setMembersNode(node)}
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
                onMembers={(n) => setMembersNode(n)}
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

      {/* Members dialog */}
      {membersNode && (
        <OrgMembersDialog
          scope={WHOLE_TEAM}
          node={membersNode}
          candidates={candidates}
          candidatesLoading={candidatesLoading}
          open
          onOpenChange={(o) => !o && setMembersNode(null)}
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
