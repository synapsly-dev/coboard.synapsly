import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Mail } from 'lucide-react';
import {
  isAdminRole,
  type EmailNotificationEventKey,
  type EmailNotificationSettings,
} from 'shared';
import { Button, Input, Label, Spinner, Switch } from '../../components/ui';
import { isApiClientError } from '../../api/client';
import {
  useEmailNotificationSettings,
  useUpdateEmailNotificationSettings,
} from '../../api/settings';
import { useUsers } from '../../api/users';

/**
 * 邮件提醒 settings card (admin). Master switch, per-event toggles, due-soon
 * lead days, and the roster of admins who receive the admin-facing mails.
 * Mails are delivered through core's send API; this card only edits policy.
 */

const EVENT_ROWS: { key: EmailNotificationEventKey; title: string; hint: string }[] = [
  { key: 'taskAssigned', title: '任务派发', hint: '任务被派发/转让给成员时,通知该成员' },
  { key: 'taskDueSoon', title: '任务临期', hint: '截止日期临近时,提醒所有认领人' },
  { key: 'taskSubmitted', title: '任务提交', hint: '交付提交后,通知任务创建者与项目负责人审阅' },
  { key: 'taskRejected', title: '任务驳回', hint: '交付被驳回时,通知所有认领人' },
  {
    key: 'adminReviewNeeded',
    title: '需管理员审阅',
    hint: '任务进入需管理员复核/审阅的状态时,通知下方选定的管理员',
  },
];

export function EmailNotificationsSection(): JSX.Element {
  const { data, isLoading, isError, refetch } = useEmailNotificationSettings();
  const { data: allUsers } = useUsers();
  const updateSettings = useUpdateEmailNotificationSettings();

  const [draft, setDraft] = useState<EmailNotificationSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const adminOptions = useMemo(
    () => (allUsers ?? []).filter((u) => u.isActive && isAdminRole(u.role)),
    [allUsers],
  );

  if (isLoading || !draft) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-border bg-card py-10">
        {isError ? (
          <Button variant="outline" onClick={() => void refetch()}>
            加载邮件提醒设置失败,点击重试
          </Button>
        ) : (
          <Spinner />
        )}
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(data);

  function patchDraft(patch: Partial<EmailNotificationSettings>): void {
    setSaved(false);
    setActionError(null);
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function toggleEvent(key: EmailNotificationEventKey, next: boolean): void {
    if (!draft) return;
    patchDraft({ events: { ...draft.events, [key]: next } });
  }

  function toggleAdmin(id: string, next: boolean): void {
    if (!draft) return;
    patchDraft({
      adminRecipientIds: next
        ? [...draft.adminRecipientIds, id]
        : draft.adminRecipientIds.filter((x) => x !== id),
    });
  }

  async function onSave(): Promise<void> {
    if (!draft) return;
    setActionError(null);
    setSaved(false);
    try {
      await updateSettings.mutateAsync({
        enabled: draft.enabled,
        events: draft.events,
        dueSoonDays: draft.dueSoonDays,
        adminRecipientIds: draft.adminRecipientIds,
      });
      setSaved(true);
    } catch (err) {
      setActionError(isApiClientError(err) ? err.message : '保存失败,请稍后重试');
    }
  }

  return (
    <div className="space-y-6 rounded-xl border border-border bg-card p-5 sm:p-6">
      <section className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Mail className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <Label htmlFor="email-notify-enabled" className="text-sm font-medium">
              邮件提醒
            </Label>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {draft.enabled
                ? '已开启:在关键任务节点向相关成员/管理员发送邮件。'
                : '已关闭:不发送任何邮件提醒。'}
            </p>
          </div>
        </div>
        <Switch
          id="email-notify-enabled"
          checked={draft.enabled}
          onCheckedChange={(next) => patchDraft({ enabled: next })}
          disabled={updateSettings.isPending}
          aria-label="开启或关闭邮件提醒"
        />
      </section>

      <div className="space-y-3">
        {EVENT_ROWS.map((row) => (
          <section key={row.key} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor={`email-event-${row.key}`} className="text-sm font-medium">
                {row.title}
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">{row.hint}</p>
              {row.key === 'taskDueSoon' && draft.events.taskDueSoon && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">提前</span>
                  <Input
                    type="number"
                    min={0}
                    max={30}
                    value={draft.dueSoonDays}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10);
                      patchDraft({
                        dueSoonDays: Number.isNaN(n) ? 0 : Math.min(30, Math.max(0, n)),
                      });
                    }}
                    className="h-8 w-20"
                    disabled={updateSettings.isPending || !draft.enabled}
                  />
                  <span className="text-xs text-muted-foreground">天提醒(0 = 仅当天)</span>
                </div>
              )}
            </div>
            <Switch
              id={`email-event-${row.key}`}
              checked={draft.events[row.key]}
              onCheckedChange={(next) => toggleEvent(row.key, next)}
              disabled={updateSettings.isPending || !draft.enabled}
              aria-label={`开启或关闭「${row.title}」邮件`}
            />
          </section>
        ))}
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">接收管理员邮件的人员</Label>
        <p className="text-xs text-muted-foreground">
          「需管理员审阅」的邮件只发给勾选的管理员;不勾选则不发送该类邮件。
        </p>
        {adminOptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无可选的管理员。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {adminOptions.map((admin) => {
              const checked = draft.adminRecipientIds.includes(admin.id);
              return (
                <label
                  key={admin.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    checked
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  } ${updateSettings.isPending || !draft.enabled ? 'pointer-events-none opacity-60' : ''}`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={(e) => toggleAdmin(admin.id, e.target.checked)}
                    disabled={updateSettings.isPending || !draft.enabled}
                  />
                  <span className="font-medium">{admin.displayName}</span>
                  <span className="text-xs opacity-70">{admin.email}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      {actionError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => void onSave()} loading={updateSettings.isPending} disabled={!dirty}>
          {updateSettings.isPending ? '正在保存…' : '保存邮件设置'}
        </Button>
        {saved && !dirty && (
          <span className="inline-flex items-center gap-1.5 text-sm text-success motion-safe:animate-fade-in">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            已保存
          </span>
        )}
      </div>
    </div>
  );
}
