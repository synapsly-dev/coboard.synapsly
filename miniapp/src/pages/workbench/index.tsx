import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from 'client-core';
import { isClaimFull, TASK_STATUS_META, TASK_TYPE_META, type Notification, type Task } from 'shared';
import { useMemo } from 'react';
import { coboardClient } from '../../platform/coboard-client';
import { AuthGate } from '../../components/AuthGate';
import { AppIcon, Badge, Empty, PageHeader, type AppIconName } from '../../components/ui';
import { useCurrentUser, useSessionToken } from '../../lib/auth';
import { queryClient } from '../../lib/query';
import './index.scss';

function dueUrgency(task: Task): 'overdue' | 'soon' | null {
  if (!task.dueDate) return null;
  const due = new Date(`${task.dueDate}T23:59:59`).getTime();
  if (Number.isNaN(due)) return null;
  const days = Math.ceil((due - Date.now()) / 86400000);
  return days < 0 ? 'overdue' : days <= 2 ? 'soon' : null;
}

function relativeTime(value: string): string {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}

function TaskRow({ task, meta, destructive, showDue }: { task: Task; meta?: string; destructive?: boolean; showDue?: boolean }): JSX.Element {
  const due = showDue ? dueUrgency(task) : null;
  return <View className="work-task" onClick={() => Taro.navigateTo({ url: `/pages/task/index?id=${task.id}` })}>
    <Text className={`work-task__type work-task__type--${task.taskType ?? 'none'}`}>{task.taskType ? TASK_TYPE_META[task.taskType].code : '—'}</Text>
    <View className="work-task__main"><Text className="work-task__title">{task.title}</Text>{meta && <Text className={`work-task__meta ${destructive ? 'work-task__meta--danger' : ''}`}>{meta}</Text>}</View>
    {due && <Badge tone={due === 'overdue' ? 'danger' : 'warning'}>{due === 'overdue' ? '已逾期' : '即将到期'}</Badge>}
    {task.points != null && <Badge tone="primary">{task.points} 点</Badge>}
    <Badge><Text className="work-task__project">▣ {task.projectName ?? '任务池'}</Text></Badge>
  </View>;
}

function TaskGroup({ label, tone = 'neutral', children, count }: { label: string; tone?: 'neutral' | 'warning' | 'danger' | 'final'; children: React.ReactNode; count: number }): JSX.Element {
  return <View className="work-group"><View className={`work-group__label work-group__label--${tone}`}><Text>{label}</Text><Text>{count}</Text></View><View className="work-list">{children}</View></View>;
}

function WorkSection({ icon, title, count, children }: { icon: AppIconName; title: string; count?: number; children: React.ReactNode }): JSX.Element {
  return <View className="work-section"><View className="work-section__head"><View className="work-section__icon"><AppIcon name={icon} size={17} /></View><Text className="work-section__title">{title}</Text>{count != null && count > 0 && <Badge>{count}</Badge>}</View>{children}</View>;
}

function WorkbenchPage(): JSX.Element {
  const token = useSessionToken(); const user = useCurrentUser(); const qc = useQueryClient();
  const review = useQuery({ queryKey: [...queryKeys.reviewQueue(), token], enabled: Boolean(token), queryFn: async () => (await coboardClient.workbench.reviewQueue()).tasks });
  const rejected = useQuery({ queryKey: [...queryKeys.rejectedTasks(), token], enabled: Boolean(token), queryFn: async () => (await coboardClient.workbench.rejectedTasks()).tasks });
  const all = useQuery({ queryKey: [...queryKeys.allTasks(), token], enabled: Boolean(token), queryFn: async () => (await coboardClient.tasks.all()).tasks });
  const stats = useQuery({ queryKey: ['stats', 'me', 'week', token], enabled: Boolean(token), queryFn: () => { const to = new Date(); const from = new Date(to); const day = (from.getDay() + 6) % 7; from.setDate(from.getDate() - day); from.setHours(0, 0, 0, 0); return coboardClient.stats.me({ from: from.toISOString(), to: to.toISOString() }); } });
  const notifications = useQuery({ queryKey: ['notifications', 'preview', token], enabled: Boolean(token), queryFn: () => coboardClient.notifications.list('unread', 6) });
  const read = useMutation({ mutationFn: (id: string) => coboardClient.notifications.read(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }) });
  const refresh = async (): Promise<void> => { if (token) await Promise.all([review.refetch(), rejected.refetch(), all.refetch(), stats.refetch(), notifications.refetch()]); };
  useDidShow(() => { void refresh(); });
  usePullDownRefresh(async () => { await refresh(); Taro.stopPullDownRefresh(); });

  const myId = user.data?.id;
  const mine = useMemo(() => (all.data ?? []).filter((task) => (task.status === 'open' || task.status === 'in_progress') && task.claimants.some((claimant) => claimant.userId === myId)).sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')), [all.data, myId]);
  const rejectedTasks = rejected.data ?? [];
  const rejectedIds = new Set(rejectedTasks.map((task) => task.id));
  const urgentMine = mine.filter((task) => dueUrgency(task) && !rejectedIds.has(task.id));
  const progressing = mine.filter((task) => !dueUrgency(task) && !rejectedIds.has(task.id));
  const awaitingFirst = (review.data ?? []).filter((task) => !task.firstApprovedAt);
  const awaitingFinal = (review.data ?? []).filter((task) => task.firstApprovedAt);
  const claimable = (all.data ?? []).filter((task) => task.status === 'open' && !task.claimants.some((claimant) => claimant.userId === myId) && !isClaimFull(task) && (task.projectId === null || task.taskType === 'claimable' || task.taskType === 'collab'));
  const immediateCount = (review.data?.length ?? 0) + rejectedTasks.length + urgentMine.length;

  function openNotification(item: Notification): void {
    if (!item.readAt) read.mutate(item.id);
    if (item.entityType === 'task' && item.entityId) Taro.navigateTo({ url: `/pages/task/index?id=${item.entityId}` });
    else Taro.switchTab({ url: '/pages/notifications/index' });
  }

  return <View className="page workbench-page"><PageHeader title="工作台" description="先处理紧急事项，再持续推进任务，并掌握与你相关的变化。" action={<View className="week-strip"><Text className="week-strip__label">本周</Text><Text className="week-strip__points">{stats.data?.pointsSum ?? 0}<Text> 点</Text></Text><Text className="week-strip__done">完成 {stats.data?.completedCount ?? 0} 个任务</Text></View>} /><AuthGate>
    <WorkSection icon="workbench" title="立即处理" count={immediateCount}>{immediateCount === 0 ? <View className="work-ok"><Text className="work-ok__icon">✓</Text><View><Text className="work-ok__title">当前没有紧急事项</Text><Text className="work-ok__copy">新的审核、退回或截止提醒会集中在这里。</Text></View></View> : <View className="work-groups">{awaitingFirst.length > 0 && <TaskGroup label="待初审" count={awaitingFirst.length}>{awaitingFirst.map((task) => <TaskRow key={task.id} task={task} meta={task.deliverer ? `提交人 ${task.deliverer.displayName}${task.deliveredAt ? ` · ${relativeTime(task.deliveredAt)}` : ''}` : undefined} />)}</TaskGroup>}{awaitingFinal.length > 0 && <TaskGroup label="待复核" tone="final" count={awaitingFinal.length}>{awaitingFinal.map((task) => <TaskRow key={task.id} task={task} meta={task.firstApprover ? `初审人 ${task.firstApprover.displayName}` : undefined} />)}</TaskGroup>}{rejectedTasks.length > 0 && <TaskGroup label="被退回" tone="danger" count={rejectedTasks.length}>{rejectedTasks.map((task) => <TaskRow key={task.id} task={task} showDue destructive meta={`已退回 · 当前「${TASK_STATUS_META[task.status].label}」`} />)}</TaskGroup>}{urgentMine.length > 0 && <TaskGroup label="临近截止" tone="warning" count={urgentMine.length}>{urgentMine.map((task) => <TaskRow key={task.id} task={task} showDue />)}</TaskGroup>}</View>}</WorkSection>
    <WorkSection icon="board" title="正在推进" count={progressing.length}>{progressing.length === 0 ? <Empty title={mine.length ? '进行中的任务都需要优先处理' : '暂无进行中的任务'} description={mine.length ? '这些任务已集中到上方「立即处理」。' : '去看板认领一个任务。'} /> : <View className="work-list">{progressing.map((task) => <TaskRow key={task.id} task={task} showDue />)}</View>}</WorkSection>
    <WorkSection icon="notifications" title="与你相关" count={notifications.data?.counts.unread ?? 0}>{(notifications.data?.notifications.length ?? 0) === 0 ? <Empty title="暂无未读通知" /> : <View className="notification-list">{notifications.data?.notifications.map((item) => <View key={item.id} className="notification-row" onClick={() => openNotification(item)}><View className="notification-row__dot" /><View className="notification-row__main"><Text className="notification-row__title">{item.title}</Text><Text className="notification-row__body">{item.body}</Text></View><Text className="notification-row__time">{relativeTime(item.createdAt)}</Text></View>)}</View>}</WorkSection>
    {claimable.length > 0 && <WorkSection icon="projects" title="可认领" count={claimable.length}><View className="work-list">{claimable.map((task) => <TaskRow key={task.id} task={task} showDue meta={`已认领 ${task.claimants.length}/${task.maxClaimants ?? '不限'}`} />)}</View></WorkSection>}
  </AuthGate></View>;
}

export default function WorkbenchPageRoot(): JSX.Element { return <QueryClientProvider client={queryClient}><WorkbenchPage /></QueryClientProvider>; }
