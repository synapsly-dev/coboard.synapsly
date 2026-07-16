import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Picker, Text, View } from '@tarojs/components';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { StatsSort } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { useCurrentUser, useSessionToken } from '../../lib/auth';
import { Avatar, Badge, Card, Empty, PageHeader, Segmented, Stat } from '../../components/ui';
import { StateView } from '../../components/StateView';
import { queryClient } from '../../lib/query';
import './index.scss';

type Range = 'week' | 'month' | 'all' | 'custom';
function dateOnly(date: Date): string { return date.toISOString().slice(0, 10); }
function dates(range: Range, customFrom: string, customTo: string): { from?: string; to?: string } {
  if (range === 'all') return {};
  if (range === 'custom') return { from: customFrom ? new Date(`${customFrom}T00:00:00`).toISOString() : undefined, to: customTo ? new Date(`${customTo}T23:59:59`).toISOString() : undefined };
  const to = new Date(); const from = new Date(to); from.setDate(from.getDate() - (range === 'week' ? 7 : 30));
  return { from: from.toISOString(), to: to.toISOString() };
}

function StatsPage(): JSX.Element {
  const token = useSessionToken(); const user = useCurrentUser();
  const [range, setRange] = useState<Range>('week');
  const [sort, setSort] = useState<StatsSort>('count');
  const [projectId, setProjectId] = useState('all');
  const today = dateOnly(new Date()); const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
  const [customFrom, setCustomFrom] = useState(dateOnly(monthAgo)); const [customTo, setCustomTo] = useState(today);
  const params = dates(range, customFrom, customTo);
  const projects = useQuery({ queryKey: ['projects', 'directory', token], enabled: Boolean(token), queryFn: async () => (await coboardClient.projects.directory()).projects.filter((item) => item.isMember) });
  const me = useQuery({ queryKey: ['stats', 'me', range, customFrom, customTo, token], enabled: Boolean(token), queryFn: () => coboardClient.stats.me(params) });
  const leaderboard = useQuery({ queryKey: ['stats', 'leaderboard', projectId, range, customFrom, customTo, sort, token], enabled: Boolean(token), queryFn: async () => (await coboardClient.stats.leaderboard({ ...params, projectId: projectId === 'all' ? undefined : projectId, sort })).entries });
  const trend = useQuery({ queryKey: ['stats', 'trend', range, customFrom, customTo, token], enabled: Boolean(token), queryFn: async () => (await coboardClient.stats.trend({ ...params, bucket: range === 'all' ? 'week' : 'day' })).points });
  const tracks = useQuery({ queryKey: ['stats', 'tracks', range, customFrom, customTo, token], enabled: Boolean(token), queryFn: async () => (await coboardClient.stats.tracks(params)).entries });
  usePullDownRefresh(async () => { await Promise.all([me.refetch(), leaderboard.refetch(), trend.refetch(), tracks.refetch()]); Taro.stopPullDownRefresh(); });
  const projectOptions = [{ id: 'all', name: '全部项目' }, ...(projects.data ?? [])];
  const projectIndex = Math.max(0, projectOptions.findIndex((item) => item.id === projectId));
  const myRank = useMemo(() => { const index = leaderboard.data?.findIndex((entry) => entry.user.id === user.data?.id) ?? -1; return index < 0 ? undefined : index + 1; }, [leaderboard.data, user.data?.id]);
  const maxTrend = Math.max(1, ...(trend.data ?? []).map((point) => sort === 'points' ? point.pointsSum : point.completedCount));
  const maxMember = Math.max(1, ...(leaderboard.data ?? []).map((entry) => sort === 'points' ? entry.pointsSum : entry.completedCount));

  return <View className="page stats-page">
    <PageHeader title="贡献统计" description="按完成任务数与点数衡量团队贡献，支持按项目与时间范围筛选。" />
    <Card className="stats-personal">
      <View className="row"><Avatar name={user.data?.displayName ?? '我'} color={user.data?.avatarColor} /><View className="account-copy"><Text className="title">{user.data?.displayName ?? '我的贡献'}</Text><Text className="caption">我的贡献 · {range === 'week' ? '本周' : range === 'month' ? '本月' : range === 'all' ? '全部' : '自定义'}</Text></View>{myRank && <View className="stats-rank"><Text>#{myRank}</Text><Text>当前排名</Text></View>}</View>
      <View className="row stats-summary"><Stat label="完成任务" value={me.data?.completedCount ?? 0} /><Stat label="累计点数" value={me.data?.pointsSum ?? 0} /><Stat label="灵感奖励" value={me.data?.rewardPoints ?? 0} /></View>
    </Card>
    <Card className="stack stats-filters">
      <Picker mode="selector" range={projectOptions.map((item) => item.name)} value={projectIndex} onChange={(event) => setProjectId(projectOptions[Number(event.detail.value)]?.id ?? 'all')}><View className="stats-picker"><Text className="caption">项目</Text><Text>{projectOptions[projectIndex]?.name ?? '全部项目'}⌄</Text></View></Picker>
      <Segmented value={range} onChange={setRange} items={[{ value: 'week', label: '本周' }, { value: 'month', label: '本月' }, { value: 'all', label: '全部' }, { value: 'custom', label: '自定义' }]} />
      {range === 'custom' && <View className="row"><Picker mode="date" value={customFrom} end={customTo} onChange={(event) => setCustomFrom(event.detail.value)}><View className="stats-date"><Text className="caption">起</Text><Text>{customFrom}</Text></View></Picker><Text>—</Text><Picker mode="date" value={customTo} start={customFrom} end={today} onChange={(event) => setCustomTo(event.detail.value)}><View className="stats-date"><Text className="caption">止</Text><Text>{customTo}</Text></View></Picker></View>}
      <Segmented value={sort} onChange={setSort} items={[{ value: 'count', label: '完成数' }, { value: 'points', label: '点数' }]} />
    </Card>
    <StateView loading={leaderboard.isLoading} error={leaderboard.isError} empty={false} onRetry={() => void leaderboard.refetch()}>
      <Text className="section-title">排行榜</Text>
      {(leaderboard.data?.length ?? 0) === 0 ? <Empty title="暂无贡献数据" /> : <View className="stack">{leaderboard.data?.map((entry, index) => <Card key={entry.user.id} className="row"><Text className="title">{index + 1}</Text><Avatar name={entry.user.displayName} color={entry.user.avatarColor} /><View className="account-copy"><Text className="title">{entry.user.displayName}</Text><Text className="caption">完成 {entry.completedCount} 个任务</Text><View className="stats-bar"><View style={{ width: `${Math.max(4, ((sort === 'points' ? entry.pointsSum : entry.completedCount) / maxMember) * 100)}%` }} /></View></View><Badge tone="primary">{sort === 'points' ? `${entry.pointsSum} 点` : `${entry.completedCount} 个`}</Badge></Card>)}</View>}
    </StateView>
    <Text className="section-title">我的完成趋势</Text>
    <Card className="stats-trend">{(trend.data ?? []).length === 0 ? <Empty title="暂无趋势数据" /> : trend.data?.map((point) => { const value = sort === 'points' ? point.pointsSum : point.completedCount; return <View className="stats-trend__column" key={point.date}><Text>{value}</Text><View className="stats-trend__track"><View style={{ height: `${Math.max(4, value / maxTrend * 100)}%` }} /></View><Text>{point.date.slice(5)}</Text></View>; })}</Card>
    <Text className="section-title">成员对比</Text>
    <Card className="stack">{leaderboard.data?.slice(0, 8).map((entry) => { const value = sort === 'points' ? entry.pointsSum : entry.completedCount; return <View className="stats-compare" key={entry.user.id}><Text>{entry.user.displayName}</Text><View className="stats-compare__track"><View style={{ width: `${Math.max(3, value / maxMember * 100)}%` }} /></View><Text>{value}</Text></View>; })}</Card>
    <Text className="section-title">按赛道</Text>
    <View className="stack">{tracks.data?.map((entry) => <Card key={entry.trackId ?? 'pool'}><View className="row-between"><Text className="title">{entry.trackName ?? '未归类'}</Text><Text className="title">{entry.pointsSum} 点</Text></View><Text className="caption">完成 {entry.completedCount} 个任务</Text></Card>)}</View>
  </View>;
}
export default function StatsPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><StatsPage /></QueryClientProvider>; }
