import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Switch, Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { NotificationDelivery } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { useSessionToken } from '../../lib/auth';
import { AuthGate } from '../../components/AuthGate';
import { ActionButton, Badge, Card, Empty, PageHeader, Segmented } from '../../components/ui';
import { queryClient } from '../../lib/query';

type Filter = 'all' | 'unread' | 'action';
function NotificationsPage(): JSX.Element {
  const token = useSessionToken(); const client = useQueryClient(); const [filter, setFilter] = useState<Filter>('all'); const [settings, setSettings] = useState(false);
  const query = useQuery({ queryKey: ['notifications', filter, token], enabled: Boolean(token), queryFn: () => coboardClient.notifications.list(filter, 50) });
  const counts = useQuery({ queryKey: ['notifications', 'counts', token], enabled: Boolean(token), queryFn: () => coboardClient.notifications.counts() });
  const prefs = useQuery({ queryKey: ['notifications', 'preferences', token], enabled: Boolean(token && settings), queryFn: async () => (await coboardClient.notifications.preferences()).preferences });
  const read = useMutation({ mutationFn: (id: string) => coboardClient.notifications.read(id), onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }) });
  const readAll = useMutation({ mutationFn: () => coboardClient.notifications.readAll(), onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }) });
  const setPref = useMutation({ mutationFn: ({ topic, channel, delivery }: { topic: Awaited<ReturnType<typeof coboardClient.notifications.preferences>>['preferences'][number]['topic']; channel: Awaited<ReturnType<typeof coboardClient.notifications.preferences>>['preferences'][number]['channel']; delivery: NotificationDelivery }) => coboardClient.notifications.setPreference({ topic, channel, delivery }), onSuccess: () => void prefs.refetch() });
  useDidShow(() => { void query.refetch(); void counts.refetch(); });
  usePullDownRefresh(async () => { await Promise.all([query.refetch(), counts.refetch()]); Taro.stopPullDownRefresh(); });
  return <View className="page"><PageHeader title="通知" description="集中查看任务变化、审核、申请和团队动态。" action={<ActionButton tone="ghost" size="small" onClick={() => setSettings(!settings)}>{settings ? '返回' : '设置'}</ActionButton>} /><AuthGate>{settings ? <View className="stack">{prefs.data?.filter((item) => item.channel === 'in_app').map((item) => <Card key={`${item.topic}:${item.channel}`} className="row-between"><View><Text className="title">{topicLabel(item.topic)}</Text><Text className="caption">应用内通知</Text></View><Switch checked={item.delivery !== 'off'} onChange={(event) => setPref.mutate({ topic: item.topic, channel: item.channel, delivery: event.detail.value ? 'immediate' : 'off' })} /></Card>)}</View> : <><View className="row-between"><Segmented value={filter} onChange={setFilter} items={[{ value: 'all', label: '全部' }, { value: 'unread', label: '未读', count: counts.data?.counts.unread }, { value: 'action', label: '待处理', count: counts.data?.counts.unresolvedActions }]} />{(counts.data?.counts.unread ?? 0) > 0 && <ActionButton tone="ghost" size="small" loading={readAll.isPending} onClick={() => readAll.mutate()}>全部已读</ActionButton>}</View>{query.isLoading ? <Empty title="加载通知…" /> : (query.data?.notifications.length ?? 0) === 0 ? <Empty title="暂无通知" /> : <View className="stack">{query.data?.notifications.map((item) => <Card key={item.id} onClick={() => { if (!item.readAt) read.mutate(item.id); }}><View className="stack"><View className="row-between"><Text className="title">{item.title}</Text><View className="row">{item.actionRequired && <Badge tone="warning">需处理</Badge>}{!item.readAt && <Badge tone="primary">未读</Badge>}</View></View>{item.body && <Text className="body muted">{item.body}</Text>}<Text className="caption">{new Date(item.createdAt).toLocaleString('zh-CN')}</Text></View></Card>)}</View>}</>}</AuthGate></View>;
}
export default function NotificationsPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><NotificationsPage /></QueryClientProvider>; }
function topicLabel(value: string): string { const labels: Record<string, string> = { assignments: '任务分配', mentions: '提及与回复', reviews: '审核进度', deadlines: '截止提醒', applications: '岗位申请', membership: '成员与权限', announcements: '团队公告', watched_updates: '关注更新', points: '贡献点数', security: '账号安全' }; return labels[value] ?? value; }
