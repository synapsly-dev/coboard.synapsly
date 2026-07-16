import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { taskClaimants, tasks } from '../db/schema.js';
import type { MailerLogger } from '../email/mailer.js';
import type { RealtimeBus } from '../realtime/bus.js';
import { createNotifications } from './notificationService.js';
import { getEmailNotificationSettings } from './settingsService.js';

/**
 * Due-date scan (任务临期). The only producer of `deadline_due_soon`: every
 * claimant of an unfinished task whose dueDate falls within the configured
 * lead window (overdue included — a never-notified overdue task still gets its
 * single nag) receives one in-app notification, mirrored to email when the
 * admin 邮件提醒 settings allow. Exactly once per (task, user, dueDate): the
 * notification table's per-recipient dedupe key is the durable guard, so
 * restarts and hourly re-scans never double-notify.
 */

/** ISO date (YYYY-MM-DD) `days` days from now, in server-local time. */
function isoDateInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** One scan pass; returns how many fresh notifications were created. */
export async function runDueSoonScan(db: Database, bus: RealtimeBus): Promise<number> {
  // The lead window lives in the 邮件提醒 settings (提前天数); the in-app
  // notification itself is NOT gated by the email switches — email gating
  // happens in the email channel, per-user in-app gating in createNotifications.
  const { dueSoonDays } = await getEmailNotificationSettings(db);
  const cutoff = isoDateInDays(dueSoonDays);
  const today = isoDateInDays(0);

  const dueTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        isNotNull(tasks.dueDate),
        lte(tasks.dueDate, cutoff),
        inArray(tasks.status, ['open', 'in_progress']),
      ),
    );

  let created = 0;
  for (const task of dueTasks) {
    const claimantRows = await db
      .select({ userId: taskClaimants.userId })
      .from(taskClaimants)
      .where(eq(taskClaimants.taskId, task.id));
    if (claimantRows.length === 0) continue;

    const overdue = task.dueDate !== null && task.dueDate < today;
    const rows = await createNotifications(db, bus, {
      recipientUserIds: claimantRows.map((r) => r.userId),
      actorUserId: null,
      type: 'deadline_due_soon',
      entityType: 'task',
      entityId: task.id,
      title: overdue ? '任务已逾期' : '任务即将到期',
      body: `${task.title} · 截止 ${task.dueDate}`,
      priority: 'high',
      dedupeKey: `task:${task.id}:due_soon:${task.dueDate}`,
      groupKey: `task:${task.id}`,
      payload: { projectId: task.projectId },
      emailEvent: 'taskDueSoon',
    });
    created += rows.length;
  }
  return created;
}

const DUE_SOON_INTERVAL_MS = 60 * 60_000;
const DUE_SOON_INITIAL_DELAY_MS = 60_000;

/** Start the hourly due-soon scheduler; returns a stop function. */
export function startDueSoonScheduler(ctx: {
  db: Database;
  bus: RealtimeBus;
  log: MailerLogger;
}): () => void {
  const tick = (): void => {
    void runDueSoonScan(ctx.db, ctx.bus).catch((err: unknown) => {
      ctx.log.error({ err }, '[notify] 临期扫描失败');
    });
  };
  const initial = setTimeout(tick, DUE_SOON_INITIAL_DELAY_MS);
  const interval = setInterval(tick, DUE_SOON_INTERVAL_MS);
  // Never keep the process alive just for the scan.
  initial.unref();
  interval.unref();
  return () => {
    clearTimeout(initial);
    clearInterval(interval);
  };
}
