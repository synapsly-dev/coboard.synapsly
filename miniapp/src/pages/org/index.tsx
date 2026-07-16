import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { OrgApplication, OrgNode, OrgNodeKind } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { useCurrentUser } from '../../lib/auth';
import { ActionButton, Avatar, Badge, Card, Empty, Field, PageHeader, Segmented, SelectField } from '../../components/ui';
import { StateView } from '../../components/StateView';
import { queryClient } from '../../lib/query';
import './index.scss';

type ViewMode = 'chart' | 'list' | 'recruit';
type ChartMode = 'galaxy' | 'tree';
const kindLabels: Record<OrgNodeKind, string> = { department: '部门', group: '小组', position: '岗位', track: '赛道' };

function OrgPage(): JSX.Element {
  const user = useCurrentUser();
  const client = useQueryClient();
  const [view, setView] = useState<ViewMode>('chart');
  const [chartMode, setChartMode] = useState<ChartMode>('galaxy');
  const [creating, setCreating] = useState(false);
  const [parentId, setParentId] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrgNode | null>(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<OrgNodeKind>('department');
  const [description, setDescription] = useState('');
  const isAdmin = user.data?.role === 'admin' || user.data?.role === 'super_admin';

  // Include the identity in the key and wait for it before requesting. This avoids
  // reusing a pre-login/expired-session result after development login.
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
  const create = useMutation({
    mutationFn: () => coboardClient.org.create({ scope: 'all', parentId, kind, title: title.trim(), description: description.trim() || null }),
    onSuccess: () => {
      setCreating(false);
      setTitle('');
      setDescription('');
      setParentId(null);
      void client.invalidateQueries({ queryKey: ['org'] });
    },
  });
  const update = useMutation({
    mutationFn: () => coboardClient.org.update(editing!.id, { title: title.trim(), kind, description: description.trim() || null }),
    onSuccess: () => {
      setEditing(null); setTitle(''); setDescription('');
      void client.invalidateQueries({ queryKey: ['org'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => coboardClient.org.remove(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['org'] }),
  });
  const openCreate = (nextParentId: string | null = null): void => {
    setEditing(null); setParentId(nextParentId); setKind(nextParentId ? 'group' : 'department');
    setTitle(''); setDescription(''); setCreating(true);
  };
  const openEdit = (node: OrgNode): void => {
    setCreating(false); setEditing(node); setKind(node.kind); setTitle(node.title); setDescription(node.description ?? '');
  };
  const confirmRemove = async (node: OrgNode): Promise<void> => {
    const result = await Taro.showModal({ title: `删除“${node.title}”？`, content: '子节点也会一并删除，此操作不可撤销。', confirmColor: '#dc2626' });
    if (result.confirm) remove.mutate(node.id);
  };
  usePullDownRefresh(async () => {
    await Promise.all([tree.refetch(), applications.refetch()]);
    Taro.stopPullDownRefresh();
  });

  const nodes = tree.data ?? [];
  const children = useMemo(() => {
    const map = new Map<string | null, OrgNode[]>();
    nodes.forEach((node) => map.set(node.parentId, [...(map.get(node.parentId) ?? []), node]));
    return map;
  }, [nodes]);
  const roots = children.get(null) ?? [];
  const flattened = useMemo(() => flattenNodes(roots, children), [roots, children]);
  const positions = nodes.filter((node) => node.kind === 'position');
  const pendingCount = applications.data?.applications.filter((item) => item.status === 'pending').length;
  const kinds: OrgNodeKind[] = ['department', 'group', 'position', 'track'];

  return <View className="page org-page">
    <PageHeader
      title="团队架构"
      description="团队分工与职位的可视化组织树"
      action={isAdmin && view !== 'recruit' ? <ActionButton size="small" onClick={() => creating || editing ? (setCreating(false), setEditing(null)) : openCreate()}>{creating || editing ? '取消' : '新建'}</ActionButton> : undefined}
    />
    <Segmented value={view} onChange={setView} items={[
      { value: 'chart', label: '图谱' },
      { value: 'list', label: '列表' },
      { value: 'recruit', label: '招募', count: pendingCount },
    ]} />

    {view === 'chart' && <View className="org-chart-switch">
      <Text className="caption">图谱显示</Text>
      <View className="org-chart-switch__control">
        <View className={chartMode === 'galaxy' ? 'is-active' : ''} onClick={() => setChartMode('galaxy')}><Text>星系</Text></View>
        <View className={chartMode === 'tree' ? 'is-active' : ''} onClick={() => setChartMode('tree')}><Text>树形</Text></View>
      </View>
    </View>}

    {(creating || editing) && <Card className="stack org-create">
      <Text className="title">{editing ? `编辑 ${editing.title}` : parentId ? '新建子节点' : '新建根节点'}</Text>
      <SelectField label="节点类型" range={kinds.map((item) => kindLabels[item])} value={kinds.indexOf(kind)} valueLabel={kindLabels[kind]} onChange={(index) => setKind(kinds[index] ?? 'department')} />
      <Field label="名称" value={title} onChange={setTitle} />
      <Field label="说明" value={description} multiline onChange={setDescription} />
      <ActionButton loading={create.isPending || update.isPending} disabled={!title.trim()} onClick={() => editing ? update.mutate() : create.mutate()}>{editing ? '保存修改' : '创建节点'}</ActionButton>
    </Card>}

    <StateView loading={user.isLoading || tree.isLoading} error={user.isError || tree.isError} empty={false} onRetry={() => { void user.refetch(); void tree.refetch(); }}>
      {nodes.length === 0 ? <Empty title="还没有架构" description={isAdmin ? '开始搭建团队分工与职位。' : '管理员尚未搭建团队架构。'} /> : view === 'chart' ? (
        chartMode === 'galaxy' ? <GalaxyView roots={roots} childrenMap={children} /> : <TreeView roots={roots} childrenMap={children} />
      ) : view === 'list' ? (
        <View className="org-list">{flattened.map(({ node, depth }) => <CompactNodeRow key={node.id} node={node} depth={depth} editable={isAdmin} onEdit={openEdit} onAdd={() => openCreate(node.id)} onRemove={() => void confirmRemove(node)} />)}</View>
      ) : (
        <RecruitView positions={positions} applications={applications.data?.applications ?? []} canDecideNodeIds={applications.data?.canDecideNodeIds ?? []} userId={user.data?.id} />
      )}
    </StateView>
  </View>;
}

function flattenNodes(roots: OrgNode[], children: Map<string | null, OrgNode[]>): Array<{ node: OrgNode; depth: number }> {
  const output: Array<{ node: OrgNode; depth: number }> = [];
  const walk = (node: OrgNode, depth: number): void => {
    output.push({ node, depth });
    (children.get(node.id) ?? []).forEach((child) => walk(child, depth + 1));
  };
  roots.forEach((root) => walk(root, 0));
  return output;
}

function GalaxyView({ roots, childrenMap }: { roots: OrgNode[]; childrenMap: Map<string | null, OrgNode[]> }): JSX.Element {
  return <View className="org-galaxy">{roots.map((root) => {
    const descendants = flattenNodes([root], childrenMap).slice(1);
    return <View className="org-system" key={root.id}>
      <View className="org-system__core"><Badge>{kindLabels[root.kind]}</Badge><Text className="title">{root.title}</Text><Text className="caption">{root.leads.length + root.members.length} 人</Text></View>
      {descendants.length > 0 && <View className="org-system__orbit">{descendants.map(({ node, depth }) => <View className="org-planet" key={node.id} style={{ marginLeft: `${Math.min(depth - 1, 2) * 14}px` }}><View className="org-planet__dot" /><View className="account-copy"><Text className="body">{node.title}</Text><Text className="caption">{kindLabels[node.kind]} · {node.leads.length + node.members.length} 人</Text></View></View>)}</View>}
    </View>;
  })}</View>;
}

function TreeView({ roots, childrenMap }: { roots: OrgNode[]; childrenMap: Map<string | null, OrgNode[]> }): JSX.Element {
  return <View className="stack org-tree">{roots.map((node) => <OrgNodeCard key={node.id} node={node} childrenMap={childrenMap} depth={0} />)}</View>;
}

function CompactNodeRow({ node, depth, editable, onEdit, onAdd, onRemove }: { node: OrgNode; depth: number; editable: boolean; onEdit: (node: OrgNode) => void; onAdd: () => void; onRemove: () => void }): JSX.Element {
  return <View className="org-list__row" style={{ paddingLeft: `${12 + Math.min(depth, 4) * 18}px` }}>
    <View className="org-list__line" /><Badge>{kindLabels[node.kind]}</Badge>
    <View className="account-copy"><Text className="body">{node.title}</Text><Text className="caption">{node.leads.length + node.members.length} 人{node.description ? ` · ${node.description}` : ''}</Text></View>
    <View className="org-list__avatars">{[...node.leads, ...node.members].slice(0, 3).map((person) => <Avatar key={person.userId} name={person.displayName} color={person.avatarColor} />)}</View>
    {editable && <View className="org-list__actions"><Text onClick={onAdd}>＋</Text><Text onClick={() => onEdit(node)}>编辑</Text><Text className="danger" onClick={onRemove}>删除</Text></View>}
  </View>;
}

function RecruitView({ positions, applications, canDecideNodeIds, userId }: { positions: OrgNode[]; applications: OrgApplication[]; canDecideNodeIds: string[]; userId?: string }): JSX.Element {
  const client = useQueryClient();
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const refresh = (): void => { setApplyingId(null); setNote(''); void client.invalidateQueries({ queryKey: ['org'] }); };
  const apply = useMutation({ mutationFn: (nodeId: string) => coboardClient.org.apply(nodeId, { note: note.trim() || undefined }), onSuccess: refresh });
  const withdraw = useMutation({ mutationFn: (id: string) => coboardClient.org.withdraw(id), onSuccess: refresh });
  const decide = useMutation({ mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => coboardClient.org.decide(id, decision, {}), onSuccess: refresh });
  if (positions.length === 0) return <Empty title="暂无招募岗位" description="创建“岗位”节点并设置名额后，可在这里开放申报。" />;
  return <View className="stack org-recruit">
    {positions.map((position) => {
      const used = position.leads.length + position.members.length;
      const pending = applications.filter((item) => item.nodeId === position.id && item.status === 'pending').length;
      const mine = applications.find((item) => item.nodeId === position.id && item.applicant.id === userId && item.status === 'pending');
      const canDecide = canDecideNodeIds.includes(position.id);
      const requests = applications.filter((item) => item.nodeId === position.id && item.status === 'pending' && item.applicant.id !== userId);
      return <Card key={position.id} className="stack">
        <View className="row-between"><View className="account-copy"><Text className="title">{position.title}</Text><Text className="caption">{position.description || '团队岗位'}</Text></View><Badge tone="primary">{position.headcount == null ? `${used} 人` : `${used}/${position.headcount}`}</Badge></View>
        {pending > 0 && <Text className="caption">{pending} 个待处理申请</Text>}
        <View className="row">{[...position.leads, ...position.members].slice(0, 5).map((person) => <Avatar key={person.userId} name={person.displayName} color={person.avatarColor} />)}</View>
        {mine ? <ActionButton tone="ghost" size="small" loading={withdraw.isPending} onClick={() => withdraw.mutate(mine.id)}>撤回申请</ActionButton> : applyingId === position.id ? <View className="stack"><Field label="申报理由（可选）" value={note} multiline onChange={setNote} /><View className="row"><ActionButton size="small" loading={apply.isPending} onClick={() => apply.mutate(position.id)}>提交申报</ActionButton><ActionButton tone="ghost" size="small" onClick={() => setApplyingId(null)}>取消</ActionButton></View></View> : <ActionButton tone="secondary" size="small" onClick={() => setApplyingId(position.id)}>申报岗位</ActionButton>}
        {canDecide && requests.map((request) => <View className="org-application" key={request.id}><View className="row"><Avatar name={request.applicant.displayName} color={request.applicant.avatarColor} /><View className="account-copy"><Text className="body">{request.applicant.displayName}</Text><Text className="caption">{request.note || '未填写申报理由'}</Text></View></View><View className="row"><ActionButton size="small" loading={decide.isPending} onClick={() => decide.mutate({ id: request.id, decision: 'approve' })}>录用</ActionButton><ActionButton tone="danger" size="small" loading={decide.isPending} onClick={() => decide.mutate({ id: request.id, decision: 'reject' })}>婉拒</ActionButton></View></View>)}
      </Card>;
    })}
  </View>;
}

function OrgNodeCard({ node, childrenMap, depth }: { node: OrgNode; childrenMap: Map<string | null, OrgNode[]>; depth: number }): JSX.Element {
  return <View className="org-tree__branch" style={{ marginLeft: `${Math.min(depth, 3) * 14}px` }}>
    <Card><View className="stack"><View className="row-between"><View className="row"><Badge>{kindLabels[node.kind]}</Badge><Text className="title">{node.title}</Text></View><Text className="caption">{node.leads.length + node.members.length} 人</Text></View>{node.description && <Text className="caption">{node.description}</Text>}<View className="row">{[...node.leads, ...node.members].slice(0, 5).map((person) => <Avatar key={person.userId} name={person.displayName} color={person.avatarColor} />)}</View></View></Card>
    <View className="stack org-tree__children">{(childrenMap.get(node.id) ?? []).map((child) => <OrgNodeCard key={child.id} node={child} childrenMap={childrenMap} depth={depth + 1} />)}</View>
  </View>;
}

export default function OrgPageRoot(): JSX.Element {
  return <QueryClientProvider client={queryClient}><OrgPage /></QueryClientProvider>;
}
