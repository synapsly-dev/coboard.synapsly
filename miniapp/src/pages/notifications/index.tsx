import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro';
import { Switch, Text, View } from '@tarojs/components';
import { QueryClientProvider, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Notification, NotificationDelivery, NotificationTopic } from 'shared';
import { coboardClient } from '../../platform/coboard-client';
import { useSessionToken } from '../../lib/auth';
import { AuthGate } from '../../components/AuthGate';
import { ActionButton, AppIcon, Badge, Card, Empty, InlineError, PageHeader, Segmented, type AppIconName } from '../../components/ui';
import { queryClient } from '../../lib/query';
import './index.scss';

type Filter = 'all' | 'unread' | 'action';
const optionalTopics: Array<{ topic: NotificationTopic; label: string; description: string }> = [
  { topic: 'deadlines', label: '截止提醒', description: '临近截止与逾期提醒' },
  { topic: 'announcements', label: '公告', description: '团队新公告发布提醒' },
  { topic: 'points', label: '点数与灵感', description: '点数到账和灵感采纳提醒' },
  { topic: 'watched_updates', label: '关注对象更新', description: '主动关注的任务和项目动态' },
];
function NotificationsPage(): JSX.Element {
  const token = useSessionToken();
  const client = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [settings, setSettings] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ['notifications', filter, token],
    enabled: Boolean(token),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => coboardClient.notifications.list(filter, 30, pageParam),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const notifications = useMemo(() => query.data?.pages.flatMap((page) => page.notifications) ?? [], [query.data]);
  const counts = useQuery({
    queryKey: ['notifications', 'counts', token],
    enabled: Boolean(token),
    queryFn: () => coboardClient.notifications.counts(),
  });
  const prefs = useQuery({
    queryKey: ['notifications', 'preferences', token],
    enabled: Boolean(token && settings),
    queryFn: async () => (await coboardClient.notifications.preferences()).preferences,
  });
  const read = useMutation({
    mutationFn: (id: string) => coboardClient.notifications.read(id),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const readAll = useMutation({
    mutationFn: () => coboardClient.notifications.readAll(),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const setPref = useMutation({
    mutationFn: ({
      topic,
      channel,
      delivery,
    }: {
      topic: Awaited<
        ReturnType<typeof coboardClient.notifications.preferences>
      >['preferences'][number]['topic'];
      channel: Awaited<
        ReturnType<typeof coboardClient.notifications.preferences>
      >['preferences'][number]['channel'];
      delivery: NotificationDelivery;
    }) => coboardClient.notifications.setPreference({ topic, channel, delivery }),
    onSuccess: () => void prefs.refetch(),
  });
  const archive = useMutation({ mutationFn: (id: string) => coboardClient.notifications.archive(id), onSuccess: () => void client.invalidateQueries({ queryKey: ['notifications'] }) });
  function openNotification(item: Notification): void {
    if (!item.readAt) read.mutate(item.id);
    if (item.entityType === 'task' && item.entityId) { void Taro.navigateTo({ url: `/pages/task/index?id=${item.entityId}` }); return; }
    if (item.entityType === 'project' && item.entityId) { Taro.setStorageSync('coboard-board-project', item.entityId); void Taro.switchTab({ url: '/pages/board/index' }); return; }
    if (item.entityType === 'announcement') { void Taro.navigateTo({ url: '/pages/info/index' }); return; }
    if (item.entityType === 'idea') { void Taro.navigateTo({ url: '/pages/ideas/index' }); return; }
    if (item.entityType === 'asset') { void Taro.navigateTo({ url: '/pages/assets/index' }); return; }
    if (item.entityType === 'org_node' || item.entityType === 'org_application') void Taro.navigateTo({ url: '/pages/org/index' });
  }
  useDidShow(() => {
    void query.refetch();
    void counts.refetch();
  });
  usePullDownRefresh(async () => {
    await Promise.all([query.refetch(), counts.refetch()]);
    Taro.stopPullDownRefresh();
  });
  return (
    <View className="page notifications-page">
      <PageHeader
        title="通知"
        description="集中查看任务变化、审核、申请和团队动态。"
        action={
          <ActionButton tone="ghost" size="small" onClick={() => setSettings(!settings)}>
            {settings ? '返回' : '设置'}
          </ActionButton>
        }
      />
      <AuthGate>
        {settings ? (
          <View className="stack">
            <Card className="notification-settings-intro"><Text className="title">应用内通知</Text><Text className="caption">指派、提及、审核、申请和权限变化属于直接工作事项，始终保留。</Text></Card>
            {optionalTopics.map((item) => {
              const preference = prefs.data?.find((row) => row.topic === item.topic && row.channel === 'in_app');
              return (
                <Card key={item.topic} className="row-between">
                  <View className="account-copy">
                    <Text className="title">{item.label}</Text>
                    <Text className="caption">{item.description}</Text>
                  </View>
                  <Switch
                    checked={preference?.delivery !== 'off'}
                    disabled={prefs.isLoading || setPref.isPending}
                    onChange={(event) =>
                      setPref.mutate({
                        topic: item.topic,
                        channel: 'in_app',
                        delivery: event.detail.value ? 'immediate' : 'off',
                      })
                    }
                  />
                </Card>
              );
            })}
            <InlineError message={setPref.error instanceof Error ? setPref.error.message : null} />
          </View>
        ) : (
          <>
            <View className="row-between">
              <Segmented
                value={filter}
                onChange={setFilter}
                items={[
                  { value: 'all', label: '全部' },
                  { value: 'unread', label: '未读', count: counts.data?.counts.unread },
                  {
                    value: 'action',
                    label: '待处理',
                    count: counts.data?.counts.unresolvedActions,
                  },
                ]}
              />
              {(counts.data?.counts.unread ?? 0) > 0 && (
                <ActionButton
                  tone="ghost"
                  size="small"
                  loading={readAll.isPending}
                  onClick={() => readAll.mutate()}
                >
                  全部已读
                </ActionButton>
              )}
            </View>
            {query.isLoading ? (
              <Empty title="加载通知…" />
            ) : notifications.length === 0 ? (
              <Empty title="暂无通知" />
            ) : (
              <View className="notification-list">
                {notifications.map((item) => (
                  <View
                    key={item.id}
                    className={`notification-item ${item.readAt ? '' : 'notification-item--unread'}`}
                    onClick={() => openNotification(item)}
                  >
                    <View className={`notification-item__icon notification-item__icon--${notificationTone(item)}`}><AppIcon name={notificationIcon(item)} size={17} /></View><View className="notification-item__content">
                      <View className="row-between">
                        <Text className="notification-item__title">{item.title}</Text>
                        <View className="row">
                          {item.actionRequired && <Badge tone="warning">需处理</Badge>}
                          {!item.readAt && <Badge tone="primary">未读</Badge>}
                        </View>
                      </View>
                      {item.body && <Text className="notification-item__body">{item.body}</Text>}
                      <View className="row-between"><Text className="caption">
                        {new Date(item.createdAt).toLocaleString('zh-CN')}
                      </Text><Text className="notification-item__archive" onClick={(event) => { event.stopPropagation(); archive.mutate(item.id); }}>归档</Text></View>
                    </View>
                  </View>
                ))}
              </View>
            )}
            {query.hasNextPage && <View className="notification-load-more"><ActionButton tone="secondary" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? '加载中…' : '加载更多'}</ActionButton></View>}
            <InlineError message={query.error instanceof Error ? query.error.message : null} />
          </>
        )}
      </AuthGate>
    </View>
  );
}
export default function NotificationsPageRoot(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <NotificationsPage />
    </QueryClientProvider>
  );
}
function notificationIcon(item: Notification): AppIconName {
  if (item.entityType === 'task') return 'board';
  if (item.entityType === 'project') return 'projects';
  if (item.entityType === 'announcement') return 'info';
  if (item.entityType === 'idea') return 'ideas';
  if (item.entityType === 'asset') return 'assets';
  if (item.entityType === 'org_node' || item.entityType === 'org_application') return 'org';
  return 'notifications';
}

function notificationTone(item: Notification): string {
  if (item.priority === 'urgent') return 'danger';
  if (item.actionRequired) return 'warning';
  return item.readAt ? 'neutral' : 'primary';
}
