import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { Canvas, Picker, Text, View } from '@tarojs/components';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { LeaderboardEntry, StatsSort, TrackStatsEntry, TrendPoint } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { absoluteApiUrl } from '../../platform/http';
import { sessionStore } from '../../platform/session';
import { useCurrentUser, useSessionToken } from '../../lib/auth';
import { ActionButton, Avatar, Badge, Card, Empty, InlineError, PageHeader, Segmented, Stat } from '../../components/ui';
import { StateView } from '../../components/StateView';
import { queryClient } from '../../lib/query';
import './index.scss';

type Range = 'week' | 'month' | 'all' | 'custom';
interface DateParams { from?: string; to?: string }

function dateOnly(date: Date): string {
  const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDate(value: string, end = false): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
}

function dates(range: Range, customFrom: string, customTo: string): DateParams {
  if (range === 'all') return {};
  if (range === 'custom') return { from: parseDate(customFrom)?.toISOString(), to: parseDate(customTo, true)?.toISOString() };
  const now = new Date(); let from: Date; let to: Date;
  if (range === 'week') {
    const mondayOffset = (now.getDay() + 6) % 7;
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset, 0, 0, 0, 0);
    to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6, 23, 59, 59, 999);
  } else {
    from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

function StatsPage(): JSX.Element {
  const token = useSessionToken(); const user = useCurrentUser();
  const [range, setRange] = useState<Range>('week'); const [sort, setSort] = useState<StatsSort>('count'); const [projectId, setProjectId] = useState('all');
  const today = dateOnly(new Date()); const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
  const [customFrom, setCustomFrom] = useState(dateOnly(monthAgo)); const [customTo, setCustomTo] = useState(today);
  const [exportError, setExportError] = useState('');
  const params = dates(range, customFrom, customTo);
  const projects = useQuery({ queryKey: ['projects', 'directory', token], enabled: Boolean(token), queryFn: async () => (await coboardClient.projects.directory()).projects.filter((item) => item.isMember) });
  const tracksList = useQuery({ queryKey: ['tracks', token], enabled: Boolean(token), queryFn: async () => (await coboardClient.tracks.list()).tracks });
  const me = useQuery({ queryKey: ['stats', 'me', params.from, params.to, token], enabled: Boolean(token), queryFn: () => coboardClient.stats.me(params) });
  const leaderboard = useQuery({ queryKey: ['stats', 'leaderboard', projectId, params.from, params.to, sort, token], enabled: Boolean(token), queryFn: async () => (await coboardClient.stats.leaderboard({ ...params, projectId: projectId === 'all' ? undefined : projectId, sort })).entries });
  const trend = useQuery({ queryKey: ['stats', 'trend', params.from, params.to, range, token], enabled: Boolean(token), queryFn: async () => (await coboardClient.stats.trend({ ...params, bucket: range === 'week' ? 'day' : 'week' })).points });
  const tracks = useQuery({ queryKey: ['stats', 'tracks', params.from, params.to, token], enabled: Boolean(token), queryFn: async () => (await coboardClient.stats.tracks(params)).entries });
  usePullDownRefresh(async () => { await Promise.all([me.refetch(), leaderboard.refetch(), trend.refetch(), tracks.refetch()]); Taro.stopPullDownRefresh(); });
  const projectOptions = [{ id: 'all', name: '全部项目' }, ...(projects.data ?? [])]; const projectIndex = Math.max(0, projectOptions.findIndex((item) => item.id === projectId));
  const myRank = useMemo(() => { const index = leaderboard.data?.findIndex((entry) => entry.user.id === user.data?.id) ?? -1; return index < 0 ? undefined : index + 1; }, [leaderboard.data, user.data?.id]);
  const isAdmin = user.data?.role === 'admin' || user.data?.role === 'super_admin';
  const isManager = (tracksList.data ?? []).some((track) => track.managers.some((member) => member.userId === user.data?.id));
  async function exportCsv(): Promise<void> {
    const result = await Taro.showActionSheet({ itemList: ['成员分数表（CSV）', '任务明细（CSV）'] });
    const file = result.tapIndex === 0 ? 'scores' : 'tasks';
    const query = new URLSearchParams(); if (params.from) query.set('from', params.from); if (params.to) query.set('to', params.to);
    try {
      Taro.showLoading({ title: '正在导出…' });
      const auth = sessionStore.token(); const downloaded = await Taro.downloadFile({ url: `${absoluteApiUrl(`/export/${file}.csv`)}${query.size ? `?${query}` : ''}`, header: auth ? { Authorization: `Bearer ${auth}` } : {} });
      if (downloaded.statusCode < 200 || downloaded.statusCode >= 300) throw new Error('导出失败');
      const content = await new Promise<string>((resolve, reject) => Taro.getFileSystemManager().readFile({ filePath: downloaded.tempFilePath, encoding: 'utf8', success: (response) => resolve(String(response.data)), fail: reject }));
      await Taro.setClipboardData({ data: content });
      await Taro.showModal({ title: 'CSV 已复制', content: '导出内容已复制到剪贴板，可粘贴到文本文件或表格应用。', showCancel: false });
      setExportError('');
    } catch (error) { setExportError(error instanceof Error ? error.message : '导出失败'); } finally { Taro.hideLoading(); }
  }

  return <View className="page stats-page">
    <PageHeader title="贡献统计" description="按完成任务数与点数衡量团队贡献，支持按项目与时间范围筛选。" action={(isAdmin || isManager) ? <ActionButton tone="secondary" size="small" onClick={() => void exportCsv()}>导出</ActionButton> : undefined} />
    <Card className="stats-personal"><View className="row"><Avatar name={user.data?.displayName ?? '我'} color={user.data?.avatarColor} userId={user.data?.id} hasAvatar={user.data?.hasAvatar} size="large" /><View className="account-copy"><Text className="title">{user.data?.displayName ?? '我的贡献'}</Text><Text className="caption">我的贡献 · {rangeLabel(range)}</Text></View>{myRank && <View className="stats-rank"><Text>#{myRank}</Text><Text>当前排名</Text></View>}</View><View className="stats-summary"><Stat label="完成任务" value={me.data?.completedCount ?? 0} /><Stat label="任务点数" value={me.data?.taskPoints ?? 0} /><Stat label="灵感奖励" value={me.data?.rewardPoints ?? 0} /></View></Card>
    <Card className="stack stats-filters"><Picker mode="selector" range={projectOptions.map((item) => item.name)} value={projectIndex} onChange={(event) => setProjectId(projectOptions[Number(event.detail.value)]?.id ?? 'all')}><View className="stats-picker"><Text className="caption">项目</Text><Text>{projectOptions[projectIndex]?.name ?? '全部项目'} ⌄</Text></View></Picker><Segmented value={range} onChange={setRange} items={[{ value: 'week', label: '本周' }, { value: 'month', label: '本月' }, { value: 'all', label: '全部' }, { value: 'custom', label: '自定义' }]} />{range === 'custom' && <View className="stats-date-row"><Picker mode="date" value={customFrom} end={customTo} onChange={(event) => setCustomFrom(event.detail.value)}><View className="stats-date"><Text className="caption">起</Text><Text>{customFrom}</Text></View></Picker><Text>—</Text><Picker mode="date" value={customTo} start={customFrom} end={today} onChange={(event) => setCustomTo(event.detail.value)}><View className="stats-date"><Text className="caption">止</Text><Text>{customTo}</Text></View></Picker></View>}<Segmented value={sort} onChange={setSort} items={[{ value: 'count', label: '完成数' }, { value: 'points', label: '点数' }]} /></Card>
    <InlineError message={exportError || null} />
    <StateView loading={leaderboard.isLoading} error={leaderboard.isError} empty={false} onRetry={() => void leaderboard.refetch()}><Text className="section-title">排行榜</Text>{(leaderboard.data?.length ?? 0) === 0 ? <Empty title="暂无贡献数据" /> : <Leaderboard entries={leaderboard.data ?? []} metric={sort} currentUserId={user.data?.id} />}</StateView>
    <Text className="section-title">我的完成趋势</Text><Card className="stats-chart-card"><View className="row-between"><Text className="title">{sort === 'points' ? '点数趋势' : '完成任务趋势'}</Text><Text className="caption">{range === 'week' ? '按天统计' : '按周统计'}</Text></View><LineChart id="trend-chart" points={trend.data ?? []} metric={sort} /></Card>
    <Text className="section-title">成员对比</Text><Card className="stats-chart-card"><BarChart id="member-chart" entries={(leaderboard.data ?? []).slice(0, 8)} metric={sort} /></Card>
    <Text className="section-title">按赛道</Text><TrackStats entries={tracks.data ?? []} />
  </View>;
}

function Leaderboard({ entries, metric, currentUserId }: { entries: LeaderboardEntry[]; metric: StatsSort; currentUserId?: string }): JSX.Element {
  const max = Math.max(1, ...entries.map((entry) => metric === 'points' ? entry.pointsSum : entry.completedCount));
  return <View className="stats-leaderboard">{entries.map((entry, index) => <Card key={entry.user.id} className={`stats-member ${entry.user.id === currentUserId ? 'stats-member--me' : ''}`}><View className={`stats-place stats-place--${index + 1}`}>{index < 3 ? <Text>◆</Text> : <Text>{index + 1}</Text>}</View><Avatar name={entry.user.displayName} color={entry.user.avatarColor} userId={entry.user.id} hasAvatar={entry.user.hasAvatar} /><View className="account-copy"><View className="row"><Text className="title truncate">{entry.user.displayName}</Text>{entry.user.id === currentUserId && <Badge tone="primary">我</Badge>}</View><Text className="caption">完成 {entry.completedCount} 个 · {entry.pointsSum} 点</Text>{entry.pointsSum > 0 && <Text className="stats-breakdown">任务 {entry.taskPoints} + 灵感 {entry.rewardPoints}</Text>}<View className="stats-progress"><View style={{ width: `${Math.max(3, ((metric === 'points' ? entry.pointsSum : entry.completedCount) / max) * 100)}%` }} /></View></View><Text className="stats-member__value">{metric === 'points' ? entry.pointsSum : entry.completedCount}</Text></Card>)}</View>;
}

function LineChart({ id, points, metric }: { id: string; points: TrendPoint[]; metric: StatsSort }): JSX.Element {
  useEffect(() => { drawLineChart(id, points.map((point) => metric === 'points' ? point.pointsSum : point.completedCount), points.map((point) => point.date.slice(5))); }, [id, metric, points]);
  if (points.length === 0) return <Empty title="暂无趋势数据" />;
  return <Canvas canvasId={id} id={id} className="stats-canvas" />;
}

function BarChart({ id, entries, metric }: { id: string; entries: LeaderboardEntry[]; metric: StatsSort }): JSX.Element {
  useEffect(() => { drawBarChart(id, entries.map((entry) => metric === 'points' ? entry.pointsSum : entry.completedCount), entries.map((entry) => entry.user.displayName)); }, [entries, id, metric]);
  if (entries.length === 0) return <Empty title="暂无成员数据" />;
  return <Canvas canvasId={id} id={id} className="stats-canvas stats-canvas--bars" />;
}

function chartWidth(): number { return Math.max(280, Math.min(640, Taro.getSystemInfoSync().windowWidth - 64)); }
function drawLineChart(id: string, values: number[], labels: string[]): void {
  if (values.length === 0) return; const width = chartWidth(); const height = 190; const left = 34; const right = 10; const top = 18; const bottom = 34; const max = Math.max(1, ...values);
  const ctx = Taro.createCanvasContext(id); ctx.setLineWidth(1); ctx.setStrokeStyle('#e5e5e3'); ctx.setFillStyle('#71717a'); ctx.setFontSize(10);
  for (let row = 0; row <= 4; row += 1) { const y = top + (height - top - bottom) * row / 4; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke(); ctx.fillText(String(Math.round(max * (4 - row) / 4)), 2, y + 3); }
  ctx.setStrokeStyle('#18181b'); ctx.setLineWidth(2); ctx.beginPath(); values.forEach((value, index) => { const x = left + (width - left - right) * (values.length === 1 ? .5 : index / (values.length - 1)); const y = top + (height - top - bottom) * (1 - value / max); if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
  values.forEach((value, index) => { const x = left + (width - left - right) * (values.length === 1 ? .5 : index / (values.length - 1)); const y = top + (height - top - bottom) * (1 - value / max); ctx.beginPath(); ctx.setFillStyle('#18181b'); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); if (index % Math.max(1, Math.ceil(values.length / 5)) === 0 || index === values.length - 1) { ctx.setFillStyle('#71717a'); ctx.fillText(labels[index] ?? '', Math.max(left - 6, x - 15), height - 12); } }); ctx.draw();
}
function drawBarChart(id: string, values: number[], labels: string[]): void {
  if (values.length === 0) return; const width = chartWidth(); const height = 220; const left = 58; const right = 22; const top = 10; const max = Math.max(1, ...values); const row = (height - top - 6) / values.length;
  const ctx = Taro.createCanvasContext(id); ctx.setFontSize(10); values.forEach((value, index) => { const y = top + index * row; ctx.setFillStyle('#71717a'); ctx.fillText((labels[index] ?? '').slice(0, 6), 2, y + row * .62); ctx.setFillStyle('#efefed'); ctx.fillRect(left, y + row * .22, width - left - right, Math.max(8, row * .48)); ctx.setFillStyle('#18181b'); ctx.fillRect(left, y + row * .22, (width - left - right) * value / max, Math.max(8, row * .48)); ctx.setFillStyle('#18181b'); ctx.fillText(String(value), width - right + 4, y + row * .62); }); ctx.draw();
}

function TrackStats({ entries }: { entries: TrackStatsEntry[] }): JSX.Element {
  if (entries.length === 0) return <Empty title="暂无赛道数据" />; const sorted = [...entries].sort((a, b) => b.pointsSum - a.pointsSum); const max = Math.max(1, ...sorted.map((entry) => entry.pointsSum));
  return <View className="stats-tracks">{sorted.map((entry, index) => <Card key={entry.trackId ?? 'pool'} className="stats-track"><Text className="stats-track__rank">{index + 1}</Text><View className="account-copy"><View className="row-between"><Text className="title">{entry.trackName ?? '未归类'}</Text><Text className="title">{entry.pointsSum} 点</Text></View><Text className="caption">完成 {entry.completedCount} 个任务</Text><View className="stats-progress"><View style={{ width: `${Math.max(3, entry.pointsSum / max * 100)}%` }} /></View></View></Card>)}</View>;
}
function rangeLabel(range: Range): string { return { week: '本周', month: '本月', all: '全部', custom: '自定义' }[range]; }
export default function StatsPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><StatsPage /></QueryClientProvider>; }
