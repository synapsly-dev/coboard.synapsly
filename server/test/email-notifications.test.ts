import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { EmailNotificationSettings } from 'shared';
import type { Database } from '../src/db/index.js';
import {
  projectMembers,
  projects,
  settings,
  taskClaimants,
  tasks,
  users,
  type NewTaskRow,
} from '../src/db/schema.js';
import { createSession } from '../src/auth/session.js';
import { runDueSoonScan } from '../src/services/deadlineService.js';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';

/**
 * 邮件提醒 tests: the admin settings endpoints and the email channel that
 * mirrors tagged notification-center events (task assigned / due soon /
 * submitted / rejected / admin review needed) to mail. The test context's
 * mailer is a recorder — every send lands in `ctx.outbox`.
 */

const CSRF = { 'x-requested-with': 'XMLHttpRequest' };

let ctx: TestContext;
let db: Database;
let seq = 0;

interface SeededUser {
  id: string;
  email: string;
  cookie: string;
}

async function seedUser(role: 'admin' | 'member' = 'member'): Promise<SeededUser> {
  seq += 1;
  const email = `mail-u${seq}@coboard.test`;
  const [row] = await db
    .insert(users)
    .values({
      email,
      passwordHash: 'x',
      displayName: `Mail User ${seq}`,
      avatarColor: '#3b82f6',
      role,
    })
    .returning();
  if (!row) throw new Error('seedUser: no row');
  const { token } = await createSession(db, row.id);
  const cookie = `coboard_session=${ctx.app.signCookie(token)}`;
  return { id: row.id, email, cookie };
}

async function seedProject(creatorId: string): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(projects)
    .values({ name: `Mail Project ${seq}`, key: `MP${seq}`, createdBy: creatorId })
    .returning();
  if (!row) throw new Error('seedProject: no row');
  return row.id;
}

async function addMember(
  projectId: string,
  userId: string,
  role: 'lead' | 'member' = 'member',
): Promise<void> {
  await db.insert(projectMembers).values({ projectId, userId, role });
}

async function seedTask(values: Partial<NewTaskRow> & { createdBy: string }): Promise<string> {
  const [row] = await db
    .insert(tasks)
    .values({ title: `Mail Task ${(seq += 1)}`, rank: 'n', status: 'open', ...values })
    .returning();
  if (!row) throw new Error('seedTask: no row');
  return row.id;
}

async function seedClaimant(taskId: string, userId: string): Promise<void> {
  await db.insert(taskClaimants).values({ taskId, userId });
}

/** Enable email notifications directly in the settings KV (bypassing the API). */
async function enableEmail(overrides?: Partial<EmailNotificationSettings>): Promise<void> {
  const value: EmailNotificationSettings = {
    enabled: true,
    events: {
      taskAssigned: true,
      taskDueSoon: true,
      taskSubmitted: true,
      taskRejected: true,
      adminReviewNeeded: true,
    },
    dueSoonDays: 1,
    adminRecipientIds: [],
    ...overrides,
  };
  await db
    .insert(settings)
    .values({ key: 'email_notifications', value: JSON.stringify(value) })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value) } });
}

beforeEach(async () => {
  ctx = await createTestContext();
  db = ctx.db;
});

afterAll(async () => {
  await ctx.cleanup();
});

describe('设置 API /settings/email-notifications', () => {
  it('默认关闭、事件全开、名单为空;仅管理员可读', async () => {
    const admin = await seedUser('admin');
    const member = await seedUser('member');

    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings/email-notifications',
      headers: { cookie: member.cookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings/email-notifications',
      headers: { cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as EmailNotificationSettings;
    expect(body.enabled).toBe(false);
    expect(body.events.taskAssigned).toBe(true);
    expect(body.dueSoonDays).toBe(1);
    expect(body.adminRecipientIds).toEqual([]);
  });

  it('PATCH 深合并 events 并持久化;名单校验拒绝非管理员', async () => {
    const admin = await seedUser('admin');
    const member = await seedUser('member');

    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/settings/email-notifications',
      headers: { cookie: admin.cookie, ...CSRF },
      payload: {
        enabled: true,
        events: { taskDueSoon: false },
        adminRecipientIds: [admin.id],
      },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json() as EmailNotificationSettings;
    expect(body.enabled).toBe(true);
    expect(body.events.taskDueSoon).toBe(false);
    expect(body.events.taskAssigned).toBe(true); // untouched keys survive the merge
    expect(body.adminRecipientIds).toEqual([admin.id]);

    const bad = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/settings/email-notifications',
      headers: { cookie: admin.cookie, ...CSRF },
      payload: { adminRecipientIds: [member.id] },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('任务派发邮件', () => {
  it('派发后被派发人收到邮件;总开关关闭则只发站内不发邮件', async () => {
    const lead = await seedUser('member');
    const worker = await seedUser('member');
    const projectId = await seedProject(lead.id);
    await addMember(projectId, lead.id, 'lead');
    await addMember(projectId, worker.id, 'member');
    const taskId = await seedTask({ projectId, createdBy: lead.id });

    // Master switch OFF (default) → no mail.
    const off = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/assign`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { assigneeId: worker.id },
    });
    expect(off.statusCode).toBe(200);
    expect(ctx.outbox).toHaveLength(0);

    // ON → the new assignee is mailed.
    await enableEmail();
    const worker2 = await seedUser('member');
    await addMember(projectId, worker2.id, 'member');
    const on = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/assign`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { assigneeId: worker2.id },
    });
    expect(on.statusCode).toBe(200);
    expect(ctx.outbox).toHaveLength(1);
    expect(ctx.outbox[0]?.to).toBe(worker2.email);
    expect(ctx.outbox[0]?.subject).toContain('新任务派发');
    expect(ctx.outbox[0]?.idempotencyKey).toMatch(/^notif:/);
  });

  it('事件开关关闭时不发;自派不发', async () => {
    const lead = await seedUser('member');
    const projectId = await seedProject(lead.id);
    await addMember(projectId, lead.id, 'lead');
    const taskId = await seedTask({ projectId, createdBy: lead.id });

    await enableEmail({
      events: {
        taskAssigned: false,
        taskDueSoon: true,
        taskSubmitted: true,
        taskRejected: true,
        adminReviewNeeded: true,
      },
    });
    const worker = await seedUser('member');
    await addMember(projectId, worker.id, 'member');
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/assign`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { assigneeId: worker.id },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.outbox).toHaveLength(0);

    // Self-assign never mails (the actor is excluded), even with the event on.
    await enableEmail();
    const taskId2 = await seedTask({ projectId, createdBy: lead.id });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId2}/assign`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { assigneeId: lead.id },
    });
    expect(ctx.outbox).toHaveLength(0);
  });
});

describe('任务提交/驳回/待复核邮件', () => {
  it('交付后审阅人(项目负责人)收邮件;驳回后认领人收邮件', async () => {
    const creator = await seedUser('member');
    const lead = await seedUser('member');
    const worker = await seedUser('member');
    const projectId = await seedProject(creator.id);
    await addMember(projectId, creator.id, 'member');
    await addMember(projectId, lead.id, 'lead');
    await addMember(projectId, worker.id, 'member');
    const taskId = await seedTask({
      projectId,
      createdBy: creator.id,
      status: 'in_progress',
      points: 3,
    });
    await seedClaimant(taskId, worker.id);
    await enableEmail();

    const deliver = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/deliver`,
      headers: { cookie: worker.cookie, ...CSRF },
      payload: { allocations: [{ userId: worker.id, points: 3 }] },
    });
    expect(deliver.statusCode).toBe(200);
    expect(ctx.outbox.map((m) => m.to)).toEqual([lead.email]);
    expect(ctx.outbox[0]?.subject).toContain('待审阅');
    ctx.outbox.length = 0;

    const reject = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/review`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { decision: 'reject', comment: '细节不到位' },
    });
    expect(reject.statusCode).toBe(200);
    expect(ctx.outbox).toHaveLength(1);
    expect(ctx.outbox[0]?.to).toBe(worker.email);
    expect(ctx.outbox[0]?.subject).toContain('被驳回');
    expect(ctx.outbox[0]?.text).toContain('细节不到位');
  });

  it('初审通过 → 名单中的管理员收复核邮件;不在名单的管理员不收', async () => {
    const admin = await seedUser('admin');
    const admin2 = await seedUser('admin');
    const lead = await seedUser('member');
    const worker = await seedUser('member');
    const projectId = await seedProject(lead.id);
    await addMember(projectId, lead.id, 'lead');
    await addMember(projectId, worker.id, 'member');
    // 10 points ≥ threshold → needsFinalReview after deliver.
    const taskId = await seedTask({
      projectId,
      createdBy: lead.id,
      status: 'in_progress',
      points: 10,
    });
    await seedClaimant(taskId, worker.id);
    await enableEmail({ adminRecipientIds: [admin.id] });

    await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/deliver`,
      headers: { cookie: worker.cookie, ...CSRF },
      payload: { allocations: [{ userId: worker.id, points: 10 }] },
    });
    ctx.outbox.length = 0; // drop the submitted mails; focus on 复核

    const firstApprove = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/review`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { decision: 'approve' },
    });
    expect(firstApprove.statusCode).toBe(200);
    // In-app goes to every admin; email only to the configured roster (admin,
    // not admin2).
    expect(ctx.outbox).toHaveLength(1);
    expect(ctx.outbox[0]?.to).toBe(admin.email);
    expect(ctx.outbox[0]?.subject).toContain('待管理员复核');
    expect(ctx.outbox.some((m) => m.to === admin2.email)).toBe(false);
  });

  it('无项目(任务池)任务交付 → 直接提醒名单中的管理员', async () => {
    const admin = await seedUser('admin');
    const worker = await seedUser('member');
    const poolTaskId = await seedTask({
      projectId: null,
      createdBy: worker.id,
      status: 'in_progress',
      points: 2,
    });
    await seedClaimant(poolTaskId, worker.id);
    await enableEmail({ adminRecipientIds: [admin.id] });

    await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${poolTaskId}/deliver`,
      headers: { cookie: worker.cookie, ...CSRF },
      payload: { allocations: [{ userId: worker.id, points: 2 }] },
    });
    const adminMails = ctx.outbox.filter((m) => m.subject.includes('待管理员复核'));
    expect(adminMails).toHaveLength(1);
    expect(adminMails[0]?.to).toBe(admin.email);
  });
});

describe('临期扫描', () => {
  it('窗口内任务给认领人各发一封,通知表去重,重复扫描不重发', async () => {
    const creator = await seedUser('member');
    const worker = await seedUser('member');
    const projectId = await seedProject(creator.id);
    const today = new Date().toISOString().slice(0, 10);
    const taskId = await seedTask({
      projectId,
      createdBy: creator.id,
      status: 'in_progress',
      dueDate: today,
    });
    await seedClaimant(taskId, worker.id);
    // Far-future task must NOT match.
    const farTaskId = await seedTask({
      projectId,
      createdBy: creator.id,
      status: 'in_progress',
      dueDate: '2099-01-01',
    });
    await seedClaimant(farTaskId, worker.id);
    await enableEmail();

    const first = await runDueSoonScan(db, ctx.bus);
    expect(first).toBe(1);
    expect(ctx.outbox).toHaveLength(1);
    expect(ctx.outbox[0]?.to).toBe(worker.email);
    expect(ctx.outbox[0]?.subject).toContain('即将到期');
    expect(ctx.outbox[0]?.idempotencyKey).toMatch(/^notif:/);

    // The notifications table's per-recipient dedupe key blocks the re-send.
    const second = await runDueSoonScan(db, ctx.bus);
    expect(second).toBe(0);
    expect(ctx.outbox).toHaveLength(1);
  });

  it('邮件事件关闭时扫描仍建站内通知但不发邮件', async () => {
    const creator = await seedUser('member');
    const worker = await seedUser('member');
    const projectId = await seedProject(creator.id);
    const today = new Date().toISOString().slice(0, 10);
    const taskId = await seedTask({
      projectId,
      createdBy: creator.id,
      status: 'in_progress',
      dueDate: today,
    });
    await seedClaimant(taskId, worker.id);
    await enableEmail({
      events: {
        taskAssigned: true,
        taskDueSoon: false,
        taskSubmitted: true,
        taskRejected: true,
        adminReviewNeeded: true,
      },
    });

    const created = await runDueSoonScan(db, ctx.bus);
    expect(created).toBe(1); // in-app notification still created
    expect(ctx.outbox).toHaveLength(0); // but no email
  });
});
