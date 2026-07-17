import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { MoveOrgNodeInput, OrgNode } from 'shared';
import { ActionButton, AppIcon, Empty } from '../../components/ui';
import { StateView } from '../../components/StateView';
import { useCurrentUser } from '../../lib/auth';
import { queryClient } from '../../lib/query';
import { coboardClient } from '../../platform/coboard-client';
import { MembersDialog } from '../../features/org/OrgMembership';
import { OrgNodeEditor, type NodeEditorState } from '../../features/org/OrgNodeEditor';
import { OrgRecruit } from '../../features/org/OrgRecruit';
import { GalaxyView, ListView, OutlineView, type OrgViewProps } from '../../features/org/OrgViews';
import {
  buildTree,
  descendantCount,
  indentInput,
  moveDownInput,
  moveUpInput,
  outdentInput,
  type OrgTreeNode,
} from '../../features/org/model';
import './index.scss';

type ViewMode = 'chart' | 'list' | 'recruit';
type ChartMode = 'galaxy' | 'tree';
type MemberDialogState = { node: OrgNode; mode: 'manage' | 'add' } | null;

function OrgPage(): JSX.Element {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const [view, setView] = useState<ViewMode>('chart');
  const [chartMode, setChartMode] = useState<ChartMode>(() => Taro.getStorageSync('coboard-org-chart-mode') === 'tree' ? 'tree' : 'galaxy');
  const [editor, setEditor] = useState<NodeEditorState | null>(null);
  const [memberDialog, setMemberDialog] = useState<MemberDialogState>(null);
  const [actionNode, setActionNode] = useState<OrgNode | null>(null);
  const editable = user.data?.role === 'admin' || user.data?.role === 'super_admin';

  const tree = useQuery({
    queryKey: ['org', 'tree', 'all', user.data?.id],
    enabled: Boolean(user.data),
    queryFn: async () => (await coboardClient.org.tree('all')).nodes,
  });
  const applications = useQuery({
    queryKey: ['org', 'applications', 'all', user.data?.id],
    enabled: Boolean(user.data),
    queryFn: () => coboardClient.org.applications('all'),
  });

  useEffect(() => {
    console.info('[org/page] state', {
      user: { status: user.status, id: user.data?.id, role: user.data?.role },
      tree: { status: tree.status, count: tree.data?.length, error: tree.error instanceof Error ? tree.error.message : tree.error },
      applications: { status: applications.status, count: applications.data?.applications.length, error: applications.error instanceof Error ? applications.error.message : applications.error },
      view,
      chartMode,
    });
  }, [applications.data, applications.error, applications.status, chartMode, tree.data, tree.error, tree.status, user.data, user.status, view]);

  usePullDownRefresh(async () => {
    await Promise.all([tree.refetch(), applications.refetch()]);
    Taro.stopPullDownRefresh();
  });

  const nodes = tree.data ?? [];
  const roots = useMemo(() => buildTree(nodes), [nodes]);
  const applicationList = applications.data?.applications ?? [];
  const canDecideNodeIds = applications.data?.canDecideNodeIds ?? [];
  const canManageMembers = (node: OrgNode): boolean =>
    editable || Boolean(node.trackId && user.data && node.leads.some((person) => person.userId === user.data?.id));
  const pendingCount = useMemo(() => {
    const decidable = new Set(canDecideNodeIds);
    return applicationList.filter((application) =>
      application.status === 'pending' &&
      decidable.has(application.nodeId) &&
      application.applicant.id !== user.data?.id,
    ).length;
  }, [applicationList, canDecideNodeIds, user.data?.id]);

  const move = useMutation({
    mutationFn: ({ id, input }: { id: string; input: MoveOrgNodeInput }) => coboardClient.org.move(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org'] });
      setActionNode(null);
    },
    onError: (cause) => void Taro.showToast({ title: cause instanceof Error ? cause.message : '移动失败', icon: 'none' }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => coboardClient.org.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['org'] });
      setActionNode(null);
    },
    onError: (cause) => void Taro.showToast({ title: cause instanceof Error ? cause.message : '删除失败', icon: 'none' }),
  });

  const openCreate = (parentId: string | null): void => {
    setActionNode(null);
    setEditor({ mode: 'create', parentId, defaultKind: parentId ? 'group' : 'department' });
  };
  const openEdit = (node: OrgNode): void => {
    setActionNode(null);
    setEditor({ mode: 'edit', node });
  };
  const openMembers = (node: OrgNode, mode: 'manage' | 'add'): void => {
    setActionNode(null);
    setMemberDialog({ node, mode });
  };

  const toggleChartMode = (): void => {
    setChartMode((current) => {
      const next = current === 'galaxy' ? 'tree' : 'galaxy';
      Taro.setStorageSync('coboard-org-chart-mode', next);
      return next;
    });
  };

  const viewProps: OrgViewProps = {
    roots,
    nodes,
    applications: applicationList,
    userId: user.data?.id,
    editable,
    canManageMembers,
    onEdit: openEdit,
    onAddChild: (node) => openCreate(node.id),
    onManageMembers: (node) => openMembers(node, 'manage'),
    onAddMembers: (node) => openMembers(node, 'add'),
    onOpenActions: setActionNode,
  };

  const confirmDelete = async (node: OrgNode): Promise<void> => {
    const treeNode = findTreeNode(roots, node.id);
    const descendants = treeNode ? descendantCount(treeNode) : 0;
    const result = await Taro.showModal({
      title: `删除“${node.title}”？`,
      content: descendants > 0 ? `将一并删除其下 ${descendants} 个子节点，此操作不可撤销。` : '此操作不可撤销。',
      confirmText: '删除',
      confirmColor: '#dc2626',
    });
    if (result.confirm) remove.mutate(node.id);
  };

  return (
    <View className="page org-page">
      <View className="org-header">
        <View className="org-header__icon"><AppIcon name="org" size={20} /></View>
        <View className="org-header__main">
          <Text className="org-header__title">团队架构</Text>
          <Text className="org-header__description">团队分工与职位的可视化组织树</Text>
          <View className="org-header__tools">
            <View className="org-view-toggle">
              <View className={`org-view-toggle__item ${view === 'chart' ? 'is-active' : ''}`} onClick={() => setView('chart')}>
                <View className="org-tab-icon org-tab-icon--chart"><View /><View /><View /><View /></View>
                <Text className="org-visually-hidden">图谱</Text>
              </View>
              <View className={`org-view-toggle__item ${view === 'list' ? 'is-active' : ''}`} onClick={() => setView('list')}>
                <View className="org-tab-icon org-tab-icon--list"><View /><View /><View /></View>
                <Text className="org-visually-hidden">列表</Text>
              </View>
              <View className={`org-view-toggle__item ${view === 'recruit' ? 'is-active' : ''}`} onClick={() => setView('recruit')}>
                <View className="org-tab-icon org-tab-icon--recruit"><View /></View>
                <Text className="org-visually-hidden">招募</Text>
                {pendingCount > 0 && <Text className="org-view-toggle__count">{pendingCount > 9 ? '9+' : pendingCount}</Text>}
              </View>
            </View>
            {editable && <ActionButton size="small" onClick={() => openCreate(null)}>＋ 新建</ActionButton>}
          </View>
        </View>
      </View>

      <StateView loading={user.isLoading || tree.isLoading} error={user.isError || tree.isError} empty={false} onRetry={() => { void user.refetch(); void tree.refetch(); }}>
        {view === 'recruit' ? (
          <OrgRecruit nodes={nodes} applications={applicationList} canDecideNodeIds={canDecideNodeIds} userId={user.data?.id} />
        ) : roots.length === 0 ? (
          <Empty title="还没有架构" description={editable ? '开始搭建团队分工与职位。' : '管理员尚未搭建团队架构。'} />
        ) : view === 'list' ? (
          <ListView {...viewProps} />
        ) : chartMode === 'galaxy' ? (
          <GalaxyView {...viewProps} onModeToggle={toggleChartMode} />
        ) : (
          <OutlineView {...viewProps} onModeToggle={toggleChartMode} />
        )}
      </StateView>

      {editor && <OrgNodeEditor state={editor} onClose={() => setEditor(null)} />}
      {memberDialog && <MembersDialog node={memberDialog.node} mode={memberDialog.mode} onClose={() => setMemberDialog(null)} />}
      {actionNode && (
        <NodeActionSheet
          node={actionNode}
          nodes={nodes}
          view={view}
          editable={editable}
          canManageMembers={canManageMembers(actionNode)}
          busy={move.isPending || remove.isPending}
          onClose={() => setActionNode(null)}
          onEdit={() => openEdit(actionNode)}
          onAddChild={() => openCreate(actionNode.id)}
          onAddMembers={() => openMembers(actionNode, 'add')}
          onManageMembers={() => openMembers(actionNode, 'manage')}
          onMove={(input) => move.mutate({ id: actionNode.id, input })}
          onDelete={() => void confirmDelete(actionNode)}
        />
      )}
    </View>
  );
}

function NodeActionSheet({
  node,
  nodes,
  view,
  editable,
  canManageMembers,
  busy,
  onClose,
  onEdit,
  onAddChild,
  onAddMembers,
  onManageMembers,
  onMove,
  onDelete,
}: {
  node: OrgNode;
  nodes: OrgNode[];
  view: ViewMode;
  editable: boolean;
  canManageMembers: boolean;
  busy: boolean;
  onClose: () => void;
  onEdit: () => void;
  onAddChild: () => void;
  onAddMembers: () => void;
  onManageMembers: () => void;
  onMove: (input: MoveOrgNodeInput) => void;
  onDelete: () => void;
}): JSX.Element {
  const up = moveUpInput(nodes, node);
  const down = moveDownInput(nodes, node);
  const indent = indentInput(nodes, node);
  const outdent = outdentInput(nodes, node);
  const moveItem = (label: string, input: MoveOrgNodeInput | null): JSX.Element => (
    <Text className={`org-action-sheet__item ${input ? '' : 'is-disabled'}`} onClick={() => input && !busy && onMove(input)}>{label}</Text>
  );
  return (
    <View className="org-action-sheet-backdrop" onClick={onClose}>
      <View className="org-action-sheet" onClick={(event) => event.stopPropagation()}>
        <View className="org-action-sheet__handle" />
        <View className="org-action-sheet__header"><Text>{node.title}</Text><Text onClick={onClose}>×</Text></View>
        <View className="org-action-sheet__items">
          {canManageMembers && <Text className="org-action-sheet__item" onClick={onAddMembers}>＋ 加入成员</Text>}
          {canManageMembers && <Text className="org-action-sheet__item" onClick={onManageMembers}>负责人 / 成员</Text>}
          {editable && !node.trackId && <Text className="org-action-sheet__item" onClick={onEdit}>编辑节点</Text>}
          {editable && <Text className="org-action-sheet__item" onClick={onAddChild}>＋ 新增子级</Text>}
          {editable && view === 'list' && !node.trackId && (
            <View className="org-action-sheet__group">
              {moveItem('↑ 上移', up)}
              {moveItem('↓ 下移', down)}
              {moveItem('→ 缩进（成为上一项的子级）', indent)}
              {moveItem('← 取消缩进', outdent)}
            </View>
          )}
          {editable && !node.trackId && <Text className="org-action-sheet__item is-danger" onClick={() => !busy && onDelete()}>删除节点</Text>}
        </View>
      </View>
    </View>
  );
}

function findTreeNode(roots: OrgTreeNode[], id: string): OrgTreeNode | undefined {
  for (const node of roots) {
    if (node.id === id) return node;
    const nested = findTreeNode(node.children, id);
    if (nested) return nested;
  }
  return undefined;
}

export default function OrgPageRoot(): JSX.Element {
  return <QueryClientProvider client={queryClient}><OrgPage /></QueryClientProvider>;
}
