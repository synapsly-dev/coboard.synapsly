import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Task, TaskReviewsResponse } from 'shared';
import type { Database } from '../src/db/index.js';
import {
  activities,
  projectMembers,
  projects,
  taskClaimants,
  taskReviews,
  tasks,
  trackMembers,
  tracks,
  users,
  type NewTaskRow,
} from '../src/db/schema.js';
import { createSession } from '../src/auth/session.js';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';

/**
 * P2 feature tests: structured review (task_reviews + 交付质量), the 两级复核
 * state machine (needs_final_review × 初审/复核 × approve/reject/revoke), the
 * 异常流 (转让 / 改期原因), and the 工作台 read endpoints (待我审核 / 我被退回).
 * Mirrors the conventions of tasks.test.ts (session-cookie auth, direct seeding).
 */

const CSRF = { 'x-requested-with': 'XMLHttpRequest' };

let ctx: TestContext;
let db: Database;

/** Counter to keep seeded emails/keys unique across tests. */
let seq = 0;

interface SeededUser {
  id: string;
  cookie: string;
}

/** Insert a user and return its id plus a signed session cookie. */
async function seedUser(
  role: 'admin' | 'member' = 'member',
  opts: { isActive?: boolean } = {},
): Promise<SeededUser> {
  seq += 1;
  const [row] = await db
    .insert(users)
    .values({
      email: `p2-u${seq}@coboard.test`,
      passwordHash: 'x',
      displayName: `User ${seq}`,
      avatarColor: '#3b82f6',
      role,
      isActive: opts.isActive ?? true,
    })
    .returning();
  if (!row) throw new Error('seedUser: no row');
  const { token } = await createSession(db, row.id);
  const cookie = `coboard_session=${ctx.app.signCookie(token)}`;
  return { id: row.id, cookie };
}

/** Insert a project created by `creatorId`, optionally owned by a track. */
async function seedProject(
  creatorId: string,
  trackId: string | null = null,
): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(projects)
    .values({
      name: `Project ${seq}`,
      key: `P${seq}`,
      trackId,
      createdBy: creatorId,
    })
    .returning();
  if (!row) throw new Error('seedProject: no row');
  return row.id;
}

/** Insert a 赛道 and return its id. */
async function seedTrack(creatorId: string): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(tracks)
    .values({ name: `Track ${seq}`, key: `T${seq}`, rank: 'n', createdBy: creatorId })
    .returning();
  if (!row) throw new Error('seedTrack: no row');
  return row.id;
}

/** Add a project membership row. */
async function addMember(
  projectId: string,
  userId: string,
  role: 'lead' | 'member' = 'member',
): Promise<void> {
  await db.insert(projectMembers).values({ projectId, userId, role });
}

/** Insert a task row directly (bypassing the API) for setup. */
async function seedTask(values: Partial<NewTaskRow> & {
  projectId: string | null;
  createdBy: string;
}): Promise<string> {
  const [row] = await db
    .insert(tasks)
    .values({
      title: 'Task',
      rank: 'n',
      status: 'open',
      ...values,
    })
    .returning();
  if (!row) throw new Error('seedTask: no row');
  return row.id;
}

async function getTaskRow(id: string) {
  const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return rows[0];
}

/** Seed a claimant row directly. */
async function seedClaimant(
  taskId: string,
  userId: string,
  points: number | null = null,
): Promise<void> {
  await db.insert(taskClaimants).values({ taskId, userId, points });
}

async function getClaimants(taskId: string) {
  return db.select().from(taskClaimants).where(eq(taskClaimants.taskId, taskId));
}

async function getReviewRows(taskId: string) {
  return db.select().from(taskReviews).where(eq(taskReviews.taskId, taskId));
}

async function getActivities(taskId: string) {
  return db.select().from(activities).where(eq(activities.taskId, taskId));
}

/** POST /tasks/:id/deliver as `u`. */
function deliver(
  taskId: string,
  u: SeededUser,
  allocations: { userId: string; points: number }[],
  totalPoints?: number,
) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/deliver`,
    headers: { cookie: u.cookie, ...CSRF },
    payload: totalPoints === undefined ? { allocations } : { allocations, totalPoints },
  });
}

/** POST /tasks/:id/review as `u`. */
function review(
  taskId: string,
  u: SeededUser,
  payload: Record<string, unknown>,
) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/review`,
    headers: { cookie: u.cookie, ...CSRF },
    payload,
  });
}

/**
 * Seed a project (lead + one worker) with an in_progress task claimed by the
 * worker, ready to deliver.
 */
async function seedDeliverable(opts: {
  points?: number | null;
  taskType?: 'critical' | 'baseline' | 'claimable' | 'collab' | null;
} = {}) {
  const lead = await seedUser('member');
  const worker = await seedUser('member');
  const projectId = await seedProject(lead.id);
  await addMember(projectId, lead.id, 'lead');
  await addMember(projectId, worker.id, 'member');
  const taskId = await seedTask({
    projectId,
    createdBy: lead.id,
    status: 'in_progress',
    points: opts.points === undefined ? 10 : opts.points,
    taskType: opts.taskType ?? null,
  });
  await seedClaimant(taskId, worker.id);
  return { lead, worker, projectId, taskId };
}

beforeEach(async () => {
  // Fresh database per test for isolation.
  if (ctx) await ctx.cleanup();
  ctx = await createTestContext();
  db = ctx.db;
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

describe('structured review (P2 §2): task_reviews + 交付质量', () => {
  it('approve records a task_reviews row with the grade, snapshots task.qualityGrade, and GET /tasks/:id/reviews returns it', async () => {
    const { lead, worker, taskId } = await seedDeliverable({ points: 3 });
    await deliver(taskId, worker, [{ userId: worker.id, points: 3 }]);

    const res = await review(taskId, lead, {
      decision: 'approve',
      qualityGrade: 'a',
      comment: '质量很高',
    });
    expect(res.statusCode).toBe(200);
    const { task } = res.json() as { task: Task };
    expect(task.status).toBe('done');
    expect(task.qualityGrade).toBe('a');

    const rows = await getReviewRows(taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reviewerId: lead.id,
      stage: 'first',
      decision: 'approve',
      qualityGrade: 'a',
      comment: '质量很高',
    });

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/reviews`,
      headers: { cookie: worker.cookie },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as TaskReviewsResponse;
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({
      taskId,
      stage: 'first',
      decision: 'approve',
      qualityGrade: 'a',
      comment: '质量很高',
    });
    expect(body.reviews[0]!.reviewer.id).toBe(lead.id);
    expect(typeof body.reviews[0]!.reviewer.displayName).toBe('string');
  });
});

describe('needsFinalReview computed at deliver (P2 §3)', () => {
  it('A类(critical) task → needsFinalReview even with low points', async () => {
    const { worker, taskId } = await seedDeliverable({ points: 3, taskType: 'critical' });
    const res = await deliver(taskId, worker, [{ userId: worker.id, points: 3 }]);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { task: Task }).task.needsFinalReview).toBe(true);
  });

  it('total points ≥ 8 → needsFinalReview', async () => {
    const { worker, taskId } = await seedDeliverable({ points: 8 });
    const res = await deliver(taskId, worker, [{ userId: worker.id, points: 8 }]);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { task: Task }).task.needsFinalReview).toBe(true);
  });

  it('ordinary 3-point task → no final review needed', async () => {
    const { worker, taskId } = await seedDeliverable({ points: 3 });
    const res = await deliver(taskId, worker, [{ userId: worker.id, points: 3 }]);
    expect(res.statusCode).toBe(200);
    expect((res.json() as { task: Task }).task.needsFinalReview).toBe(false);
  });
});

describe('两级复核 chain (P2 §3)', () => {
  it('lead 初审 → stays pending_review with firstApproved set; second lead approve 403; admin 复核 → done', async () => {
    const { lead, worker, taskId } = await seedDeliverable({ points: 10 });
    await deliver(taskId, worker, [{ userId: worker.id, points: 10 }]);

    // 初审通过 by the project lead.
    const first = await review(taskId, lead, { decision: 'approve' });
    expect(first.statusCode).toBe(200);
    const afterFirst = (first.json() as { task: Task }).task;
    expect(afterFirst.status).toBe('pending_review'); // awaiting 复核
    expect(afterFirst.needsFinalReview).toBe(true);
    expect(afterFirst.firstApprovedBy).toBe(lead.id);
    expect(afterFirst.firstApprovedAt).not.toBeNull();
    expect(afterFirst.firstApprover?.id).toBe(lead.id);
    expect(afterFirst.completedAt).toBeNull();

    // The same (non-admin) lead cannot approve again — 复核 is admin-only.
    const again = await review(taskId, lead, { decision: 'approve' });
    expect(again.statusCode).toBe(403);

    // A global admin's approve completes the chain.
    const admin = await seedUser('admin');
    const final = await review(taskId, admin, { decision: 'approve' });
    expect(final.statusCode).toBe(200);
    const doneTask = (final.json() as { task: Task }).task;
    expect(doneTask.status).toBe('done');
    expect(doneTask.reviewedBy).toBe(admin.id);
    expect(doneTask.firstApprovedBy).toBe(lead.id); // the 初审 record stands

    const rows = await getReviewRows(taskId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.stage).sort()).toEqual(['final', 'first']);
    expect(rows.every((r) => r.decision === 'approve')).toBe(true);
  });

  it('admin single-approve with no 初审 completes the task directly (stage final)', async () => {
    const { worker, taskId } = await seedDeliverable({ points: 10 });
    await deliver(taskId, worker, [{ userId: worker.id, points: 10 }]);

    const admin = await seedUser('admin');
    const res = await review(taskId, admin, { decision: 'approve' });
    expect(res.statusCode).toBe(200);
    const { task } = res.json() as { task: Task };
    expect(task.status).toBe('done');
    expect(task.firstApprovedBy).toBeNull(); // no 初审 ever happened

    const rows = await getReviewRows(taskId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stage).toBe('final');
    expect(rows[0]!.decision).toBe('approve');
  });

  it('admin reject at the 复核 stage → in_progress, shares + firstApproved cleared', async () => {
    const { lead, worker, taskId } = await seedDeliverable({ points: 10 });
    await deliver(taskId, worker, [{ userId: worker.id, points: 10 }]);
    await review(taskId, lead, { decision: 'approve' }); // 初审通过

    const admin = await seedUser('admin');
    const res = await review(taskId, admin, { decision: 'reject', comment: '数据不完整' });
    expect(res.statusCode).toBe(200);
    const { task } = res.json() as { task: Task };
    expect(task.status).toBe('in_progress');
    expect(task.deliveredAt).toBeNull();
    expect(task.firstApprovedBy).toBeNull();
    expect(task.firstApprovedAt).toBeNull();
    expect(task.claimants.every((c) => c.points === null)).toBe(true);

    const rows = await getReviewRows(taskId);
    const reject = rows.find((r) => r.decision === 'reject');
    expect(reject?.stage).toBe('final');
    expect(reject?.comment).toBe('数据不完整');
  });

  it('撤销通过 on a done task clears firstApproved (chain re-runs) but keeps the grade snapshot', async () => {
    const { lead, worker, taskId } = await seedDeliverable({ points: 10 });
    await deliver(taskId, worker, [{ userId: worker.id, points: 10 }]);
    await review(taskId, lead, { decision: 'approve' }); // 初审
    const admin = await seedUser('admin');
    await review(taskId, admin, { decision: 'approve', qualityGrade: 'b' }); // 复核 → done

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/revoke-approval`,
      headers: { cookie: admin.cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(200);
    const { task } = res.json() as { task: Task };
    expect(task.status).toBe('pending_review');
    expect(task.completedAt).toBeNull();
    expect(task.reviewedBy).toBeNull();
    expect(task.firstApprovedBy).toBeNull(); // 重走完整审核链
    expect(task.firstApprovedAt).toBeNull();
    expect(task.qualityGrade).toBe('b'); // snapshot stands until re-reviewed
    expect(task.deliveredAt).not.toBeNull(); // delivery itself is untouched
  });

  it('赛道经理 can 初审 a track project’s task but cannot 复核 (403 after first approval)', async () => {
    const admin = await seedUser('admin');
    const mgr = await seedUser('member');
    const worker = await seedUser('member');
    const trackId = await seedTrack(admin.id);
    await db.insert(trackMembers).values({
      trackId,
      userId: mgr.id,
      role: 'manager',
      rank: 'n',
    });
    // The manager is NOT a member of the project — authority derives from the track.
    const projectId = await seedProject(admin.id, trackId);
    await addMember(projectId, worker.id, 'member');
    const taskId = await seedTask({
      projectId,
      createdBy: admin.id,
      status: 'in_progress',
      points: 10,
    });
    await seedClaimant(taskId, worker.id);
    await deliver(taskId, worker, [{ userId: worker.id, points: 10 }]);

    const first = await review(taskId, mgr, { decision: 'approve' });
    expect(first.statusCode).toBe(200);
    const afterFirst = (first.json() as { task: Task }).task;
    expect(afterFirst.status).toBe('pending_review');
    expect(afterFirst.firstApprovedBy).toBe(mgr.id);

    // A 赛道经理 is lead-equivalent, not a global admin — no 复核 authority.
    const second = await review(taskId, mgr, { decision: 'approve' });
    expect(second.statusCode).toBe(403);
  });
});

describe('POST /tasks/:id/transfer (P2 §5 转让)', () => {
  it('lead transfers a claim from A to B: claimant swapped, status unchanged, transferred activity', async () => {
    const lead = await seedUser('member');
    const a = await seedUser('member');
    const b = await seedUser('member');
    const projectId = await seedProject(lead.id);
    await addMember(projectId, lead.id, 'lead');
    await addMember(projectId, a.id, 'member');
    await addMember(projectId, b.id, 'member');
    const taskId = await seedTask({
      projectId,
      createdBy: lead.id,
      status: 'in_progress',
    });
    await seedClaimant(taskId, a.id);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/transfer`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { fromUserId: a.id, toUserId: b.id, reason: '负载调整' },
    });
    expect(res.statusCode).toBe(200);
    const { task } = res.json() as { task: Task };
    expect(task.status).toBe('in_progress'); // claimant count unchanged
    expect(task.claimants.map((c) => c.userId)).toEqual([b.id]);
    expect(task.claimants[0]!.points).toBeNull(); // incoming claimant starts fresh

    const acts = await getActivities(taskId);
    const transferred = acts.find((x) => x.type === 'transferred');
    expect(transferred).toBeDefined();
    expect(transferred!.meta).toEqual({ from: a.id, to: b.id, reason: '负载调整' });
  });

  it('forbids a plain (non-lead) member from transferring (403)', async () => {
    const lead = await seedUser('member');
    const a = await seedUser('member');
    const b = await seedUser('member');
    const projectId = await seedProject(lead.id);
    await addMember(projectId, lead.id, 'lead');
    await addMember(projectId, a.id, 'member');
    await addMember(projectId, b.id, 'member');
    const taskId = await seedTask({ projectId, createdBy: lead.id, status: 'in_progress' });
    await seedClaimant(taskId, a.id);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/transfer`,
      headers: { cookie: a.cookie, ...CSRF },
      payload: { fromUserId: a.id, toUserId: b.id },
    });
    expect(res.statusCode).toBe(403);
    expect((await getClaimants(taskId)).map((c) => c.userId)).toEqual([a.id]);
  });

  it('rejects transferring a done task (409)', async () => {
    const lead = await seedUser('member');
    const a = await seedUser('member');
    const b = await seedUser('member');
    const projectId = await seedProject(lead.id);
    await addMember(projectId, lead.id, 'lead');
    const taskId = await seedTask({ projectId, createdBy: lead.id, status: 'done' });
    await seedClaimant(taskId, a.id, 5);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/transfer`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { fromUserId: a.id, toUserId: b.id },
    });
    expect(res.statusCode).toBe(409);
  });

  it('rejects transferring to an existing claimant (409) and from a non-claimant (404)', async () => {
    const lead = await seedUser('member');
    const a = await seedUser('member');
    const b = await seedUser('member');
    const outsider = await seedUser('member');
    const projectId = await seedProject(lead.id);
    await addMember(projectId, lead.id, 'lead');
    const taskId = await seedTask({ projectId, createdBy: lead.id, status: 'in_progress' });
    await seedClaimant(taskId, a.id);
    await seedClaimant(taskId, b.id);

    const toClaimant = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/transfer`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { fromUserId: a.id, toUserId: b.id },
    });
    expect(toClaimant.statusCode).toBe(409);

    const fromNonClaimant = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/transfer`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { fromUserId: outsider.id, toUserId: outsider.id },
    });
    expect(fromNonClaimant.statusCode).toBe(404);
  });
});

describe('PATCH /tasks/:id dueDate + dueChangeReason (P2 §5 改期)', () => {
  it('records due_changed {from,to,reason} only when a reason accompanies the change', async () => {
    const lead = await seedUser('member');
    const projectId = await seedProject(lead.id);
    await addMember(projectId, lead.id, 'lead');
    const taskId = await seedTask({
      projectId,
      createdBy: lead.id,
      dueDate: '2026-07-20',
    });

    const withReason = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { dueDate: '2026-08-01', dueChangeReason: '客户要求延期' },
    });
    expect(withReason.statusCode).toBe(200);
    expect((withReason.json() as { task: Task }).task.dueDate).toBe('2026-08-01');

    // A second change WITHOUT a reason records no due_changed activity.
    const withoutReason = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { dueDate: '2026-08-15' },
    });
    expect(withoutReason.statusCode).toBe(200);

    const acts = await getActivities(taskId);
    const dueChanged = acts.filter((x) => x.type === 'due_changed');
    expect(dueChanged).toHaveLength(1);
    expect(dueChanged[0]!.meta).toEqual({
      from: '2026-07-20',
      to: '2026-08-01',
      reason: '客户要求延期',
    });
  });
});

describe('GET /me/review-queue (P2 §4 待我审核)', () => {
  it('lead sees own project’s pending_review minus first-approved; admin sees all; plain member sees none', async () => {
    const lead = await seedUser('member');
    const admin = await seedUser('admin');
    const member = await seedUser('member');
    const projectId = await seedProject(lead.id);
    await addMember(projectId, lead.id, 'lead');
    await addMember(projectId, member.id, 'member');

    // Actionable by the lead now.
    const plainId = await seedTask({
      projectId,
      createdBy: lead.id,
      status: 'pending_review',
      title: '待初审',
    });
    // Already 初审-approved → awaits the 总运营, not the lead.
    const firstApprovedId = await seedTask({
      projectId,
      createdBy: lead.id,
      status: 'pending_review',
      needsFinalReview: true,
      firstApprovedBy: lead.id,
      firstApprovedAt: new Date(),
      title: '待复核',
    });
    // A pool task is reviewable only by an admin.
    const poolId = await seedTask({
      projectId: null,
      createdBy: member.id,
      status: 'pending_review',
      title: '池任务',
    });
    // Noise: a non-pending task never appears.
    await seedTask({ projectId, createdBy: lead.id, status: 'in_progress' });

    const leadRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/review-queue',
      headers: { cookie: lead.cookie },
    });
    expect(leadRes.statusCode).toBe(200);
    const leadIds = (leadRes.json() as { tasks: Task[] }).tasks.map((t) => t.id);
    expect(leadIds).toEqual([plainId]);

    const adminRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/review-queue',
      headers: { cookie: admin.cookie },
    });
    const adminIds = (adminRes.json() as { tasks: Task[] }).tasks.map((t) => t.id);
    expect(adminIds.sort()).toEqual([plainId, firstApprovedId, poolId].sort());

    const memberRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/review-queue',
      headers: { cookie: member.cookie },
    });
    expect((memberRes.json() as { tasks: Task[] }).tasks).toEqual([]);
  });

  it('a 赛道经理 sees pending_review tasks of the track’s projects', async () => {
    const admin = await seedUser('admin');
    const mgr = await seedUser('member');
    const trackId = await seedTrack(admin.id);
    await db.insert(trackMembers).values({
      trackId,
      userId: mgr.id,
      role: 'manager',
      rank: 'n',
    });
    const projectId = await seedProject(admin.id, trackId);
    const taskId = await seedTask({
      projectId,
      createdBy: admin.id,
      status: 'pending_review',
    });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/review-queue',
      headers: { cookie: mgr.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { tasks: Task[] }).tasks.map((t) => t.id)).toEqual([taskId]);
  });
});

describe('GET /me/rejected-tasks (P2 §4 我被退回)', () => {
  it('returns the rejected-and-in_progress task for its claimant only', async () => {
    const { lead, worker, taskId } = await seedDeliverable({ points: 3 });
    await deliver(taskId, worker, [{ userId: worker.id, points: 3 }]);
    const rejected = await review(taskId, lead, {
      decision: 'reject',
      comment: '需要返工',
    });
    expect(rejected.statusCode).toBe(200);
    expect((await getTaskRow(taskId))?.status).toBe('in_progress');

    const mine = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/rejected-tasks',
      headers: { cookie: worker.cookie },
    });
    expect(mine.statusCode).toBe(200);
    expect((mine.json() as { tasks: Task[] }).tasks.map((t) => t.id)).toEqual([taskId]);

    // The lead is not a claimant — nothing was rejected "for" them.
    const leads = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/rejected-tasks',
      headers: { cookie: lead.cookie },
    });
    expect((leads.json() as { tasks: Task[] }).tasks).toEqual([]);
  });

  it('drops a task once a newer review approves it', async () => {
    const { lead, worker, taskId } = await seedDeliverable({ points: 3 });
    await deliver(taskId, worker, [{ userId: worker.id, points: 3 }]);
    await review(taskId, lead, { decision: 'reject' });
    // Redeliver and get approved: the latest review is no longer a reject.
    await deliver(taskId, worker, [{ userId: worker.id, points: 3 }]);
    await review(taskId, lead, { decision: 'approve' });

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/rejected-tasks',
      headers: { cookie: worker.cookie },
    });
    expect((res.json() as { tasks: Task[] }).tasks).toEqual([]);
  });
});

describe('deliverableSpec / acceptanceCriteria round-trip (P2 §1)', () => {
  it('persists through create, PATCH, and GET', async () => {
    const u = await seedUser('member');
    const projectId = await seedProject(u.id);
    await addMember(projectId, u.id, 'member');

    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: { cookie: u.cookie, ...CSRF },
      payload: {
        title: '写周报',
        projectId,
        deliverableSpec: '提交 PDF 文档 + 数据表链接',
        acceptanceCriteria: '数据完整、经 lead 抽查无误',
      },
    });
    expect(created.statusCode).toBe(201);
    let { task } = created.json() as { task: Task };
    expect(task.deliverableSpec).toBe('提交 PDF 文档 + 数据表链接');
    expect(task.acceptanceCriteria).toBe('数据完整、经 lead 抽查无误');

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${task.id}`,
      headers: { cookie: u.cookie, ...CSRF },
      payload: { deliverableSpec: '改为提交截图', acceptanceCriteria: null },
    });
    expect(patched.statusCode).toBe(200);
    task = (patched.json() as { task: Task }).task;
    expect(task.deliverableSpec).toBe('改为提交截图');
    expect(task.acceptanceCriteria).toBeNull();

    const fetched = await ctx.app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}`,
      headers: { cookie: u.cookie },
    });
    expect(fetched.statusCode).toBe(200);
    task = (fetched.json() as { task: Task }).task;
    expect(task.deliverableSpec).toBe('改为提交截图');
    expect(task.acceptanceCriteria).toBeNull();
  });
});
