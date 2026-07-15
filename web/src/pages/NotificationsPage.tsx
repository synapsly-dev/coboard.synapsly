import { useMemo, useState } from 'react';
import { Bell, CheckCheck, Inbox, Settings2 } from 'lucide-react';
import type { Notification, NotificationTopic } from 'shared';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, EmptyState, Spinner, Switch } from '../components/ui';
import {
  type NotificationFilter,
  useInfiniteNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationCounts,
  useNotificationPreferences,
  useSetNotificationPreference,
} from '../api/notifications';
import { NotificationRows, notificationHref } from '../features/notifications/NotificationCenter';
import { cn } from '../lib/utils';

const FILTERS: { value: NotificationFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'unread', label: '未读' },
  { value: 'action', label: '待处理' },
];

const OPTIONAL_TOPICS: {
  topic: NotificationTopic;
  label: string;
  description: string;
}[] = [
  { topic: 'deadlines', label: '截止提醒', description: '临近截止与逾期提醒' },
  { topic: 'announcements', label: '公告', description: '团队新公告发布提醒' },
  { topic: 'points', label: '点数与灵感', description: '点数到账和灵感采纳提醒' },
  { topic: 'watched_updates', label: '关注对象更新', description: '主动关注的任务和项目动态' },
];

/** Full notification history; actionable truth still lives in the workbench. */
export default function NotificationsPage(): JSX.Element {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const query = useInfiniteNotifications(filter, 30);
  const counts = useNotificationCounts();
  const preferences = useNotificationPreferences();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const setPreference = useSetNotificationPreference();
  const notifications = useMemo(
    () => query.data?.pages.flatMap((page) => page.notifications) ?? [],
    [query.data],
  );
  const unread = counts.data?.unread ?? query.data?.pages[0]?.counts.unread ?? 0;
  const actions =
    counts.data?.unresolvedActions ?? query.data?.pages[0]?.counts.unresolvedActions ?? 0;

  function openNotification(notification: Notification): void {
    if (notification.readAt === null) markRead.mutate(notification.id);
    navigate(notificationHref(notification));
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-muted-foreground" aria-hidden />
              <h1 className="text-xl font-semibold tracking-tight">通知</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              查看与你相关的协作变化；需要实际处理的事项以工作台为准。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="gap-1.5"
              >
                <CheckCheck className="h-4 w-4" aria-hidden />
                全部已读
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-expanded={settingsOpen}
              className="gap-1.5"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
              设置
            </Button>
          </div>
        </header>

        {settingsOpen && (
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground">应用内通知</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              指派、提及、审核、申请和权限变化属于直接工作事项，始终保留。
            </p>
            <div className="mt-4 divide-y divide-border">
              {OPTIONAL_TOPICS.map((item) => {
                const preference = preferences.data?.preferences.find(
                  (row) => row.topic === item.topic && row.channel === 'in_app',
                );
                const checked = preference?.delivery !== 'off';
                return (
                  <div
                    key={item.topic}
                    className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <Switch
                      checked={checked}
                      disabled={preferences.isLoading || setPreference.isPending}
                      onCheckedChange={(next) =>
                        setPreference.mutate({
                          topic: item.topic,
                          channel: 'in_app',
                          delivery: next ? 'immediate' : 'off',
                        })
                      }
                      aria-label={`${item.label}${checked ? '已开启' : '已关闭'}`}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
          {FILTERS.map((item) => {
            const count =
              item.value === 'unread' ? unread : item.value === 'action' ? actions : null;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={cn(
                  'inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
                  filter === item.value
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {item.label}
                {count !== null && count > 0 && (
                  <Badge variant={item.value === 'action' ? 'warning' : 'neutral'}>{count}</Badge>
                )}
              </button>
            );
          })}
        </div>

        {query.isLoading ? (
          <div className="rounded-xl border border-border bg-card py-16 text-center shadow-sm">
            <Spinner label="加载通知" />
          </div>
        ) : query.isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-10 text-center">
            <p className="text-sm font-medium text-destructive">通知加载失败</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
              重试
            </Button>
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={filter === 'action' ? Inbox : Bell}
            title={
              filter === 'all'
                ? '暂时没有通知'
                : filter === 'unread'
                  ? '没有未读通知'
                  : '没有待处理通知'
            }
            description={
              filter === 'action'
                ? '审核和申请等需要你处理的协作事项会出现在这里。'
                : '任务、评论和团队变化会及时同步到这里。'
            }
            className="rounded-xl border border-border bg-card py-16 shadow-sm"
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <NotificationRows notifications={notifications} onOpen={openNotification} />
          </div>
        )}

        {query.hasNextPage && (
          <Button
            variant="outline"
            className="self-center"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? '加载中…' : '加载更多'}
          </Button>
        )}
      </div>
    </div>
  );
}
