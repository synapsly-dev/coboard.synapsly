import { inArray } from 'drizzle-orm';
import type { EmailNotificationEventKey } from 'shared';
import type { Database } from '../db/index.js';
import { users, type NotificationRow } from '../db/schema.js';
import type { Mailer, MailerLogger } from './mailer.js';
import { getEmailNotificationSettings } from '../services/settingsService.js';

/**
 * Email delivery channel for the notification center (邮件提醒). In-app
 * notifications are the source of truth; when a producer tags its
 * `createNotifications` call with an `emailEvent`, every FRESHLY INSERTED
 * notification row is mirrored to email here — so the notification table's
 * per-recipient dedupe key also dedupes the mails (durable across restarts).
 *
 * Policy lives in the admin settings (settings KV `email_notifications`):
 * master switch, per-event toggles, and — for `adminReviewNeeded` — the roster
 * of admins who receive the admin-facing mails.
 *
 * Configured once at app build via {@link configureEmailChannel}; when never
 * configured (unit contexts that bypass buildApp) the channel is silently off.
 */

export interface EmailChannel {
  mailer: Mailer;
  log: MailerLogger;
  /** App base URL for the 前往查看 link. */
  publicUrl: string;
}

let channel: EmailChannel | null = null;

export function configureEmailChannel(next: EmailChannel | null): void {
  channel = next;
}

/** Subject + call-to-action line per event; the task context comes from the row. */
const EVENT_COPY: Record<EmailNotificationEventKey, { subject: string; hint: string }> = {
  taskAssigned: { subject: '新任务派发', hint: '请及时开始处理。' },
  taskDueSoon: { subject: '任务即将到期', hint: '请抓紧推进,按时交付。' },
  taskSubmitted: { subject: '任务待审阅', hint: '请尽快审阅。' },
  taskRejected: { subject: '任务被驳回', hint: '请根据意见修改后重新交付。' },
  adminReviewNeeded: { subject: '任务待管理员复核', hint: '请尽快处理。' },
};

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function linkFor(publicUrl: string, row: NotificationRow): string {
  const projectId = (row.payload as { projectId?: unknown } | null)?.projectId;
  return typeof projectId === 'string' && projectId
    ? `${publicUrl}/board/${projectId}`
    : `${publicUrl}/workbench`;
}

function renderHtml(row: NotificationRow, hint: string, url: string): string {
  const body = row.body ? `<p style="margin:4px 0;color:#444;">${escapeHtml(row.body)}</p>` : '';
  return (
    `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:16px;">` +
    `<h2 style="color:#111;">${escapeHtml(row.title)}</h2>` +
    body +
    `<p style="margin:4px 0;color:#444;">${escapeHtml(hint)}</p>` +
    `<p style="margin-top:16px;"><a href="${url}" ` +
    `style="background:#2563eb;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;">` +
    `前往 Coboard 查看</a></p>` +
    `<p style="margin-top:24px;color:#999;font-size:12px;">此邮件由 Coboard 自动发送，请勿回复。` +
    `管理员可在「管理 → 设置」中调整邮件提醒。</p></div>`
  );
}

/**
 * Mirror freshly inserted notification rows to email. Never throws: policy is
 * read per call, recipients resolve from the users table, and the actual sends
 * are dispatched WITHOUT being awaited so the triggering request never waits
 * on (or fails with) the mail round-trip.
 */
export async function sendNotificationEmails(
  db: Database,
  event: EmailNotificationEventKey,
  rows: NotificationRow[],
): Promise<void> {
  const active = channel;
  if (!active || rows.length === 0) return;
  try {
    const settings = await getEmailNotificationSettings(db);
    if (!settings.enabled || !settings.events[event]) return;

    // Admin-facing mails go only to the roster the admins picked.
    let targets = rows;
    if (event === 'adminReviewNeeded') {
      const roster = new Set(settings.adminRecipientIds);
      targets = rows.filter((row) => roster.has(row.recipientUserId));
    }
    if (targets.length === 0) return;

    const ids = [...new Set(targets.map((row) => row.recipientUserId))];
    const recipientRows = await db.select().from(users).where(inArray(users.id, ids));
    const byId = new Map(
      recipientRows
        .filter((u) => u.isActive && u.email.includes('@'))
        .map((u) => [u.id, u] as const),
    );

    const copy = EVENT_COPY[event];
    for (const row of targets) {
      const user = byId.get(row.recipientUserId);
      if (!user) continue;
      const url = linkFor(active.publicUrl, row);
      const textBody = [row.title, ...(row.body ? [row.body] : []), copy.hint, '', `查看:${url}`];
      void active.mailer
        .send({
          to: user.email,
          subject: `【Coboard】${copy.subject}:${row.body ?? row.title}`,
          html: renderHtml(row, copy.hint, url),
          text: textBody.join('\n'),
          // The notification row is already deduped per recipient; its id keys
          // core-side idempotency so producer retries can't double-send.
          idempotencyKey: `notif:${row.id}`,
        })
        .catch((err: unknown) => {
          active.log.error({ err, to: user.email, event }, '[mail] 发送失败');
        });
    }
  } catch (err) {
    active.log.error({ err, event }, '[mail] 邮件通道处理失败');
  }
}
