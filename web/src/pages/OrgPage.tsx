import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronsUpDown,
  FolderKanban,
  Network,
  Plus,
  Users2,
} from 'lucide-react';
import type { MoveOrgNodeInput, OrgNode, OrgScope } from 'shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Spinner,
  Switch,
} from '../components/ui';
import { cn } from '../lib/utils';
import { queryKeys } from '../lib/query';
import { useAuth } from '../lib/auth-context';
import { useProjects, useProjectMembers } from '../api/projects';
import { usersApi } from '../api/users';
import {
  useDeleteOrgNode,
  useMoveOrgNode,
  useOrgTree,
} from '../api/org';
import { buildTree, descendantCount, type OrgTreeNode } from '../features/org/tree';
import { canEditOrgScope } from '../features/org/permissions';
import { OrgNodeRow } from '../features/org/OrgNodeRow';
import { OrgNodeDialog } from '../features/org/OrgNodeDialog';
import {
  OrgMembersDialog,
  type OrgCandidate,
} from '../features/org/OrgMembersDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui';

/**
 * 团队架构 (/org) — a flexible, editable org tree showing division of labor and
 * positions. A scope switcher toggles between the whole-team tree and each project's
 * tree. Any member may view; a global admin (whole-team) or a project lead (project
 * tree) may edit — an 「编辑」 toggle then reveals per-node controls (add / edit /
 * reorder / members / delete). Structure changes go through the button-based move
 * primitives; SSE keeps everyone's view fresh.
 */

const WHOLE_TEAM: OrgScope = 'all';

type NodeDialogState =
  | { mode: 'create'; parentId: string | null }
  | { mode: 'edit'; node: OrgNode }
  | null;

export default function OrgPage(): JSX.Element {
  const { user } = useAuth();
  const [scope, setScope] = useState<OrgScope>(WHOLE_TEAM);
  const [editMode, setEditMode] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [nodeDialog, setNodeDialog] = useState<NodeDialogState>(null);
  const [membersNode, setMembersNode] = useState<OrgNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrgTreeNode | null>(null);

  const { data: projects } = useProjects();
  const { data: nodes, isLoading, isError, refetch } = useOrgTree(scope);

  // The current user's role in the scoped project (drives edit permission + is the
  // candidate source for a project tree). Disabled for the whole-team scope.
  const projectId = scope === WHOLE_TEAM ? undefined : scope;
  const { data: projectMembers, isLoading: membersLoading } = useProjectMembers(projectId);
  const myProjectRole = useMemo(
    () => projectMembers?.find((m) => m.userId === user?.id)?.role,
    [projectMembers, user?.id],
  );

  const editable = canEditOrgScope(user, scope, myProjectRole);
  const isEditing = editable && editMode;

  // Candidate people for the members dialog: all users (whole-team, admin-only) or
  // the project's members (project tree). Only fetched when it can actually be used.
  const allUsersQuery = useQuery({
    queryKey: queryKeys.users(),
    queryFn: async ({ signal }) => (await usersApi.list(signal)).users,
    enabled: isEditing && scope === WHOLE_TEAM,
  });
  const candidates: OrgCandidate[] = useMemo(() => {
    if (scope === WHOLE_TEAM) {
      return (allUsersQuery.data ?? [])
        .filter((u) => u.isActive)
        .map((u) => ({
          id: u.id,
          displayName: u.displayName,
          avatarColor: u.avatarColor,
          hasAvatar: u.hasAvatar,
        }));
    }
    return (projectMembers ?? []).map((m) => ({
      id: m.user.id,
      displayName: m.user.displayName,
      avatarColor: m.user.avatarColor,
      hasAvatar: m.user.hasAvatar,
    }));
  }, [scope, allUsersQuery.data, projectMembers]);
  const candidatesLoading = scope === WHOLE_TEAM ? allUsersQuery.isLoading : membersLoading;

  const moveMut = useMoveOrgNode(scope);
  const deleteMut = useDeleteOrgNode(scope);

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

  const activeProject = projects?.find((p) => p.id === scope);
  const scopeLabel = scope === WHOLE_TEAM ? '全团队' : (activeProject?.name ?? '项目架构');

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Network className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">团队架构</h1>
            <p className="text-xs text-muted-foreground">团队分工与职位的可视化组织树</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Scope switcher */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex h-9 min-w-0 max-w-[16rem] items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors',
                  'hover:bg-accent hover:text-accent-foreground focus:outline-none',
                  'data-[state=open]:bg-accent',
                )}
              >
                {scope === WHOLE_TEAM ? (
                  <Users2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{scopeLabel}</span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[14rem]">
              <DropdownMenuLabel>架构范围</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setScope(WHOLE_TEAM);
                  setEditMode(false);
                }}
                className={cn(scope === WHOLE_TEAM && 'bg-accent text-accent-foreground')}
              >
                <Users2 className="h-4 w-4 text-muted-foreground" /> 全团队
              </DropdownMenuItem>
              {(projects ?? []).filter((p) => !p.archived).length > 0 && <DropdownMenuSeparator />}
              {(projects ?? [])
                .filter((p) => !p.archived)
                .map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    onSelect={() => {
                      setScope(p.id);
                      setEditMode(false);
                    }}
                    className={cn(scope === p.id && 'bg-accent text-accent-foreground')}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{p.key}</span>
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-auto flex items-center gap-2">
            {editable && (
              <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
                编辑
                <Switch checked={editMode} onCheckedChange={setEditMode} />
              </label>
            )}
            {isEditing && (
              <Button size="sm" onClick={() => setNodeDialog({ mode: 'create', parentId: null })}>
                <Plus className="h-4 w-4" /> 新建根节点
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : isError ? (
        <EmptyState
          title="加载失败"
          description="无法加载团队架构，请重试。"
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              重试
            </Button>
          }
        />
      ) : visibleRows.length === 0 && roots.length === 0 ? (
        <EmptyState
          icon={Network}
          title="还没有架构"
          description={
            editable
              ? '点击「新建根节点」，开始搭建团队分工与职位。'
              : '管理员或负责人尚未搭建该范围的团队架构。'
          }
          action={
            isEditing ? (
              <Button onClick={() => setNodeDialog({ mode: 'create', parentId: null })}>
                <Plus className="h-4 w-4" /> 新建根节点
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-1.5">
          {visibleRows.map((node) => (
            <OrgNodeRow
              key={node.id}
              node={node}
              nodes={nodes ?? []}
              editable={isEditing}
              collapsed={collapsed.has(node.id)}
              onToggleCollapse={toggleCollapse}
              onAddChild={(n) => setNodeDialog({ mode: 'create', parentId: n.id })}
              onEdit={(n) => setNodeDialog({ mode: 'edit', node: n })}
              onMembers={(n) => setMembersNode(n)}
              onDelete={(n) => setDeleteTarget(n)}
              onMove={handleMove}
            />
          ))}
        </div>
      )}

      {/* Create / edit node dialog */}
      {nodeDialog?.mode === 'create' && (
        <OrgNodeDialog
          mode="create"
          scope={scope}
          parentId={nodeDialog.parentId}
          open
          onOpenChange={(o) => !o && setNodeDialog(null)}
        />
      )}
      {nodeDialog?.mode === 'edit' && (
        <OrgNodeDialog
          mode="edit"
          scope={scope}
          node={nodeDialog.node}
          open
          onOpenChange={(o) => !o && setNodeDialog(null)}
        />
      )}

      {/* Members dialog */}
      {membersNode && (
        <OrgMembersDialog
          scope={scope}
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
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteMut.isPending}>
              取消
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} loading={deleteMut.isPending}>
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
