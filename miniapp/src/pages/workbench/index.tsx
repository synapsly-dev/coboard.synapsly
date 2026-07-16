import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { queryKeys } from 'client-core';
import { useMemo } from 'react';
import { coboardClient } from '../../platform/coboard-client';
import { AuthGate } from '../../components/AuthGate';
import { Badge, Card, Empty, PageHeader, Section, Stat } from '../../components/ui';
import { TaskCard } from '../../components/TaskCard';
import { useCurrentUser, useSessionToken } from '../../lib/auth';
import { queryClient } from '../../lib/query';

function WorkbenchPage(): JSX.Element {
  const token = useSessionToken(); const user = useCurrentUser();
  const review = useQuery({ queryKey: [...queryKeys.reviewQueue(), token], enabled: Boolean(token), queryFn: async () => (await coboardClient.workbench.reviewQueue()).tasks });
  const rejected = useQuery({ queryKey: [...queryKeys.rejectedTasks(), token], enabled: Boolean(token), queryFn: async () => (await coboardClient.workbench.rejectedTasks()).tasks });
  const all = useQuery({ queryKey: [...queryKeys.allTasks(), token], enabled: Boolean(token), queryFn: async () => (await coboardClient.tasks.all()).tasks });
  const stats = useQuery({ queryKey: ['stats', 'me', 'week', token], enabled: Boolean(token), queryFn: () => { const to = new Date(); const from = new Date(to); from.setDate(from.getDate() - 7); return coboardClient.stats.me({ from: from.toISOString(), to: to.toISOString() }); } });
  const notifications = useQuery({ queryKey: ['notifications', 'preview', token], enabled: Boolean(token), queryFn: async () => (await coboardClient.notifications.list('unread', 5)).notifications });
  useDidShow(() => { if (token) void Promise.all([review.refetch(), rejected.refetch(), all.refetch(), stats.refetch(), notifications.refetch()]); });
  usePullDownRefresh(async () => { if (token) await Promise.all([review.refetch(), rejected.refetch(), all.refetch(), stats.refetch(), notifications.refetch()]); Taro.stopPullDownRefresh(); });
  const myId = user.data?.id; const mine = useMemo(() => (all.data ?? []).filter((task) => task.claimants.some((claimant) => claimant.userId === myId) && task.status !== 'done'), [all.data, myId]); const urgent = mine.filter((task) => task.dueDate && new Date(task.dueDate).getTime() - Date.now() < 3 * 86400000); const progressing = mine.filter((task) => !urgent.includes(task)); const claimable = (all.data ?? []).filter((task) => task.status === 'open' && !task.claimants.some((claimant) => claimant.userId === myId)); const immediate = [...(review.data ?? []), ...(rejected.data ?? []), ...urgent];
  return <View className="page"><PageHeader title="工作台" description="先处理紧急事项，再持续推进任务，并掌握与你相关的变化。" /><AuthGate><Card className="row"><Stat label="本周点数" value={stats.data?.pointsSum ?? 0} /><Stat label="完成任务" value={stats.data?.completedCount ?? 0} /><Stat label="未读通知" value={notifications.data?.length ?? 0} /></Card><View style={{ height: '20px' }} /><Section title="立即处理" count={immediate.length}>{immediate.length === 0 ? <Card><Empty title="当前没有紧急事项" description="新的审核、退回或截止提醒会集中在这里。" /></Card> : <View className="stack">{immediate.map((task) => <TaskCard key={task.id} task={task} />)}</View>}</Section><Section title="正在推进" count={progressing.length}>{progressing.length === 0 ? <Empty title="暂无进行中的任务" /> : <View className="stack">{progressing.map((task) => <TaskCard key={task.id} task={task} />)}</View>}</Section><Section title="可认领" count={claimable.length}>{claimable.length === 0 ? <Empty title="暂无可认领任务" /> : <View className="stack">{claimable.slice(0, 8).map((task) => <TaskCard key={task.id} task={task} />)}</View>}</Section><Section title="近期通知" count={notifications.data?.length ?? 0}>{notifications.data?.map((item) => <Card key={item.id}><View className="row-between"><View><Text className="title">{item.title}</Text><Text className="caption">{item.body}</Text></View>{item.actionRequired && <Badge tone="warning">需处理</Badge>}</View></Card>)}</Section></AuthGate></View>;
}

export default function WorkbenchPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><WorkbenchPage /></QueryClientProvider>; }
