import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AtSign,
  Bell,
  CalendarClock,
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  Megaphone,
  Route,
  Sparkles,
  UserRoundPlus,
  Users,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { Notification, NotificationType } from 'shared';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Spinner,
} from '../../components/ui';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationCounts,
  useNotifications,
} from '../../api/notifications';
import { relativeTime } from '../board/format';
import { cn } from '../../lib/utils';

const TYPE_ICONS: Partial<Record<NotificationType, LucideIcon>> = {
  task_assigned: UserRoundPlus,
  task_unassigned: Users,
  task_transferred: Route,
  user_mentioned: AtSign,
  comment_replied: AtSign,
  task_delivered: ClipboardCheck,
  review_requested: ClipboardCheck,
  review_approved: CheckCircle2,
  review_rejected: XCircle,
  task_reopened: Route,
  deadline_changed: CalendarClock,
  deadline_due_soon: CalendarClock,
  deadline_overdue: CalendarClock,
  application_submitted: Users,
  application_approved: CheckCircle2,
  application_rejected: XCircle,
  membership_changed: Users,
  role_changed: Users,
  points_awarded: Sparkles,
  idea_adopted: Sparkles,
  idea_rejected: XCircle,
  announcement_published: Megaphone,
};

export function notificationHref(notification: Notification): string {
  const projectId =
    typeof notification.payload['projectId'] === 'string'
      ? notification.payload['projectId']
      : 'all';
  const taskId =
    notification.entityType === 'task'
      ? notification.entityId
      : typeof notification.payload['taskId'] === 'string'
        ? notification.payload['taskId']
        : null;
  if (taskId) return `/board/${projectId ?? 'all'}?task=${taskId}`;
  switch (notification.entityType) {
    case 'comment':
      return `/board/${projectId ?? 'all'}`;
    case 'org_application':
    case 'org_node':
    case 'track':
      return '/org';
    case 'announcement':
      return '/info';
    case 'project':
      return '/projects';
    case 'idea':
      return '/ideas';
    case 'asset':
      return '/assets';
    case 'user':
      return '/account/profile';
    default:
      return '/workbench';
  }
}

export function NotificationRows({
  notifications,
  onOpen,
  compact = false,
}: {
  notifications: readonly Notification[];
  onOpen: (notification: Notification) => void;
  compact?: boolean;
}): JSX.Element {
  return (
    <div className={cn('flex flex-col', compact ? 'gap-1.5' : 'divide-y divide-border')}>
      {notifications.map((notification) => {
        const Icon = TYPE_ICONS[notification.type] ?? Bell;
        const unread = notification.readAt === null;
        return (
          <button
            key={notification.id}
            type="button"
            onClick={() => onOpen(notification)}
            className={cn(
              'group flex w-full items-start gap-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              compact
                ? 'rounded-lg border border-border bg-card px-3 py-2.5 hover:border-primary/35 hover:bg-accent/40'
                : 'px-3 py-3 hover:bg-accent/60',
              unread && !compact && 'bg-accent/30',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground',
                notification.priority === 'urgent' && 'bg-destructive/10 text-destructive',
                notification.priority === 'high' && 'bg-warning/15 text-warning-foreground',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-start gap-2">
                <span
                  className={cn(
                    'min-w-0 flex-1 text-sm text-foreground',
                    unread ? 'font-semibold' : 'font-medium',
                  )}
                >
                  {notification.title}
                </span>
                {unread && (
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary"
                    aria-label="未读"
                  />
                )}
              </span>
              {notification.body && (
                <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                  {notification.body}
                </span>
              )}
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {relativeTime(notification.createdAt)}
                {notification.actionRequired && notification.resolvedAt === null ? ' · 待处理' : ''}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Persistent top-nav bell: unread badge + recent notification centre. */
export function NotificationBell(): JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const counts = useNotificationCounts();
  const list = useNotifications('all', 15);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unread = counts.data?.unread ?? list.data?.counts.unread ?? 0;

  function openNotification(notification: Notification): void {
    if (notification.readAt === null) markRead.mutate(notification.id);
    setOpen(false);
    navigate(notificationHref(notification));
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void list.refetch();
      }}
      modal={false}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={unread > 0 ? `通知，${unread} 条未读` : '通知'}
        >
          <Bell className="h-[18px] w-[18px]" aria-hidden />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground ring-2 ring-card">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[min(24rem,calc(100vw-2rem))] p-0" align="end">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold text-foreground">通知</p>
            <p className="text-[11px] text-muted-foreground">
              {unread > 0 ? `${unread} 条未读` : '没有未读消息'}
            </p>
          </div>
          {unread > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                markAll.mutate();
              }}
              disabled={markAll.isPending}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden />
              全部已读
            </button>
          )}
        </div>
        <div className="max-h-[min(32rem,70vh)] overflow-y-auto">
          {list.isLoading ? (
            <div className="flex justify-center py-10">
              <Spinner label="加载通知" />
            </div>
          ) : (list.data?.notifications.length ?? 0) === 0 ? (
            <div className="px-4 py-10 text-center">
              <Bell className="mx-auto h-7 w-7 text-muted-foreground/60" aria-hidden />
              <p className="mt-2 text-sm font-medium text-foreground">暂时没有通知</p>
              <p className="mt-1 text-xs text-muted-foreground">与你相关的工作变化会出现在这里。</p>
            </div>
          ) : (
            <NotificationRows
              notifications={list.data?.notifications ?? []}
              onOpen={openNotification}
            />
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate('/notifications');
          }}
          className="w-full border-t border-border px-3 py-2 text-center text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          查看全部通知
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
