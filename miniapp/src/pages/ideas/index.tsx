import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { IdeaStatus } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { useSessionToken } from '../../lib/auth';
import { ActionButton, Badge, Card, Empty, Field, PageHeader, Segmented } from '../../components/ui';
import { StateView } from '../../components/StateView';
import { queryClient } from '../../lib/query';

type Filter = 'all' | IdeaStatus;
const statusLabel: Record<IdeaStatus, string> = { pending: '待评审', adopted: '已采纳', rejected: '未采纳' };
function IdeasPage(): JSX.Element {
  const token = useSessionToken(); const client = useQueryClient(); const [filter, setFilter] = useState<Filter>('all'); const [creating, setCreating] = useState(false); const [body, setBody] = useState('');
  const query = useQuery({ queryKey: ['ideas', filter, token], enabled: Boolean(token), queryFn: async () => (await coboardClient.ideas.all(filter === 'all' ? {} : { status: filter })).ideas });
  const create = useMutation({ mutationFn: () => coboardClient.ideas.createStandalone({ body: body.trim() }), onSuccess: () => { setBody(''); setCreating(false); void client.invalidateQueries({ queryKey: ['ideas'] }); void Taro.showToast({ title: '已发布', icon: 'success' }); } });
  usePullDownRefresh(async () => { await query.refetch(); Taro.stopPullDownRefresh(); });
  return <View className="page"><PageHeader title="灵感区" description="汇集任务想法与独立灵感，被采纳后计入奖励点数。" action={<ActionButton size="small" onClick={() => setCreating(!creating)}>{creating ? '取消' : '发布'}</ActionButton>} />{creating && <Card className="stack"><Field label="灵感内容" value={body} multiline placeholder="记录一个值得尝试的想法…" onChange={setBody} /><ActionButton loading={create.isPending} disabled={!body.trim()} onClick={() => create.mutate()}>发布灵感</ActionButton></Card>}<Segmented value={filter} onChange={setFilter} items={[{ value: 'all', label: '全部' }, { value: 'pending', label: '待评审' }, { value: 'adopted', label: '已采纳' }, { value: 'rejected', label: '未采纳' }]} /><StateView loading={query.isLoading} error={query.isError} empty={false} onRetry={() => void query.refetch()}>{(query.data?.length ?? 0) === 0 ? <Empty title="还没有想法" description="发布第一条灵感，或在任务详情中记录想法。" /> : <View className="stack">{query.data?.map((idea) => <Card key={idea.id} onClick={() => idea.taskId ? void Taro.navigateTo({ url: `/pages/task/index?id=${idea.taskId}` }) : undefined}><View className="stack"><View className="row-between"><Badge tone={idea.status === 'adopted' ? 'success' : idea.status === 'rejected' ? 'danger' : 'warning'}>{statusLabel[idea.status]}</Badge>{idea.rewardPoints != null && <Badge tone="primary">+{idea.rewardPoints} 点</Badge>}</View><Text className="body">{idea.body}</Text><View className="row-between"><Text className="caption">{idea.author.displayName}</Text><Text className="caption">{idea.taskTitle || '独立想法'}</Text></View></View></Card>)}</View>}</StateView></View>;
}
export default function IdeasPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><IdeasPage /></QueryClientProvider>; }
