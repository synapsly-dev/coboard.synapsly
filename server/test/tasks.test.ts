import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from 'shared';
import type { Database } from '../src/db/index.js';
import {
  projectMembers,
  projects,
  tasks,
  users,
  type NewTaskRow,
} from '../src/db/schema.js';
import { createSession } from '../src/auth/session.js';
import { rankBetween } from '../src/services/taskService.js';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';

/**
 * Task / board feature tests (§6.1, §6.2, §10). Covers the characteristic domain
 * logic: claim race (one winner, the other 409), claim → in_progress, completion
 * attribution (completed_by), reopen clearing it, and the permission matrix.
 *
 * Auth: the auth/login route is still a stub during parallel development, so tests
 * authenticate by seeding a session row directly and signing the session cookie —
 * exactly what the production auth pre-handler reads.
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
async function seedUser(role: 'admin' | 'member' = 'member'): Promise<SeededUser> {
  seq += 1;
  const [row] = await db
    .insert(users)
    .values({
      email: `u${seq}@coboard.test`,
      passwordHash: 'x', // hash irrelevant; we authenticate via session row
      displayName: `User ${seq}`,
      avatarColor: '#3b82f6',
      role,
    })
    .returning();
  if (!row) throw new Error('seedUser: no row');
  const { token } = await createSession(db, row.id);
  const cookie = `coboard_session=${ctx.app.signCookie(token)}`;
  return { id: row.id, cookie };
}

/** Insert a project created by `creatorId`. */
async function seedProject(creatorId: string): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(projects)
    .values({
      name: `Project ${seq}`,
      key: `P${seq}`,
      createdBy: creatorId,
    })
    .returning();
  if (!row) throw new Error('seedProject: no row');
  return row.id;
}

/** Add a membership row. */
async function addMember(
  projectId: string,
  userId: string,
  role: 'lead' | 'member' = 'member',
): Promise<void> {
  await db.insert(projectMembers).values({ projectId, userId, role });
}

/** Insert a task row directly (bypassing the API) for setup. */
async function seedTask(values: Partial<NewTaskRow> & {
  projectId: string;
  createdBy: string;
}): Promise<Task['id']> {
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

beforeEach(async () => {
  // Fresh database per test for isolation.
  if (ctx) await ctx.cleanup();
  ctx = await createTestContext();
  db = ctx.db;
});

afterAll(async () => {
  if (ctx) await ctx.cleanup();
});

describe('rankBetween (intra-column ordering key)', () => {
  it('produces a key strictly between its neighbours', () => {
    const a = rankBetween(null, null);
    const before = rankBetween(null, a);
    const after = rankBetween(a, null);
    expect(before < a).toBe(true);
    expect(a < after).toBe(true);

    const mid = rankBetween(before, a);
    expect(before < mid).toBe(true);
    expect(mid < a).toBe(true);
  });

  it('keeps order stable across repeated insertions between two keys', () => {
    let lo = rankBetween(null, null);
    let hi = rankBetween(lo, null);
    for (let i = 0; i < 30; i += 1) {
      const mid = rankBetween(lo, hi);
      expect(lo < mid).toBe(true);
      expect(mid < hi).toBe(true);
      hi = mid; // keep squeezing between lo and the newest mid
    }
  });
});

describe('GET /projects/:id/tasks (board)', () => {
  it('returns all tasks for members and 403 for non-members', async () => {
    const owner = await seedUser('member');
    const projectId = await seedProject(owner.id);
    await addMember(projectId, owner.id, 'lead');
    await seedTask({ projectId, createdBy: owner.id, title: 'A', rank: 'a' });
    await seedTask({ projectId, createdBy: owner.id, title: 'B', rank: 'b' });

    const ok = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/tasks`,
      headers: { cookie: owner.cookie },
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { tasks: Task[] };
    expect(body.tasks).toHaveLength(2);

    const outsider = await seedUser('member');
    const denied = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/tasks`,
      headers: { cookie: outsider.cookie },
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('POST /projects/:id/tasks (create)', () => {
  it('defaults to open/unassigned', async () => {
    const u = await seedUser('member');
    const projectId = await seedProject(u.id);
    await addMember(projectId, u.id, 'member');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tasks`,
      headers: { cookie: u.cookie, ...CSRF },
      payload: { title: '写文档' },
    });
    expect(res.statusCode).toBe(201);
    const { task } = res.json() as { task: Task };
    expect(task.status).toBe('open');
    expect(task.assigneeId).toBeNull();
    expect(task.priority).toBe('medium');
  });

  it('dispatches to in_progress when assigneeId is given', async () => {
    const u = await seedUser('member');
    const projectId = await seedProject(u.id);
    await addMember(projectId, u.id, 'member');

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tasks`,
      headers: { cookie: u.cookie, ...CSRF },
      payload: { title: '上线', assigneeId: u.id, points: 5, priority: 'high' },
    });
    expect(res.statusCode).toBe(201);
    const { task } = res.json() as { task: Task };
    expect(task.status).toBe('in_progress');
    expect(task.assigneeId).toBe(u.id);
    expect(task.points).toBe(5);
    expect(task.priority).toBe('high');
  });
});

describe('POST /tasks/:id/claim', () => {
  it('claims an open, unassigned task → assignee=self, status=in_progress', async () => {
    const u = await seedUser('member');
    const projectId = await seedProject(u.id);
    await addMember(projectId, u.id, 'member');
    const taskId = await seedTask({ projectId, createdBy: u.id });

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/claim`,
      headers: { cookie: u.cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(200);
    const { task } = res.json() as { task: Task };
    expect(task.assigneeId).toBe(u.id);
    expect(task.status).toBe('in_progress');
  });

  it('returns 409 to the second of two concurrent claimers', async () => {
    const a = await seedUser('member');
    const b = await seedUser('member');
    const projectId = await seedProject(a.id);
    await addMember(projectId, a.id, 'member');
    await addMember(projectId, b.id, 'member');
    const taskId = await seedTask({ projectId, createdBy: a.id });

    // Fire both claims concurrently.
    const [r1, r2] = await Promise.all([
      ctx.app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/claim`,
        headers: { cookie: a.cookie, ...CSRF },
      }),
      ctx.app.inject({
        method: 'POST',
        url: `/api/tasks/${taskId}/claim`,
        headers: { cookie: b.cookie, ...CSRF },
      }),
    ]);

    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);

    // Exactly one winner; the task is claimed by one of them.
    const row = await getTaskRow(taskId);
    expect(row?.status).toBe('in_progress');
    expect([a.id, b.id]).toContain(row?.assigneeId);
  });

  it('returns 409 when claiming an already in_progress task', async () => {
    const a = await seedUser('member');
    const b = await seedUser('member');
    const projectId = await seedProject(a.id);
    await addMember(projectId, a.id, 'member');
    await addMember(projectId, b.id, 'member');
    const taskId = await seedTask({
      projectId,
      createdBy: a.id,
      status: 'in_progress',
      assigneeId: a.id,
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/claim`,
      headers: { cookie: b.cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('POST /tasks/:id/release', () => {
  it('lets the assignee release back to open/unassigned', async () => {
    const u = await seedUser('member');
    const projectId = await seedProject(u.id);
    await addMember(projectId, u.id, 'member');
    const taskId = await seedTask({
      projectId,
      createdBy: u.id,
      status: 'in_progress',
      assigneeId: u.id,
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/release`,
      headers: { cookie: u.cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(200);
    const { task } = res.json() as { task: Task };
    expect(task.assigneeId).toBeNull();
    expect(task.status).toBe('open');
  });

  it('forbids a non-assignee, non-lead member from releasing', async () => {
    const owner = await seedUser('member');
    const assignee = await seedUser('member');
    const other = await seedUser('member');
    const projectId = await seedProject(owner.id);
    await addMember(projectId, assignee.id, 'member');
    await addMember(projectId, other.id, 'member');
    const taskId = await seedTask({
      projectId,
      createdBy: owner.id,
      status: 'in_progress',
      assigneeId: assignee.id,
    });

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/release`,
      headers: { cookie: other.cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /tasks/:id/assign (dispatch)', () => {
  it('lets a lead assign and moves an open task to in_progress', async () => {
    const lead = await seedUser('member');
    const worker = await seedUser('member');
    const projectId = await seedProject(lead.id);
    await addMember(projectId, lead.id, 'lead');
    await addMember(projectId, worker.id, 'member');
    const taskId = await seedTask({ projectId, createdBy: lead.id });

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/assign`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { assigneeId: worker.id },
    });
    expect(res.statusCode).toBe(200);
    const { task } = res.json() as { task: Task };
    expect(task.assigneeId).toBe(worker.id);
    expect(task.status).toBe('in_progress');
  });

  it('forbids a plain member from dispatching', async () => {
    const member = await seedUser('member');
    const worker = await seedUser('member');
    const projectId = await seedProject(member.id);
    await addMember(projectId, member.id, 'member');
    await addMember(projectId, worker.id, 'member');
    const taskId = await seedTask({ projectId, createdBy: member.id });

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/assign`,
      headers: { cookie: member.cookie, ...CSRF },
      payload: { assigneeId: worker.id },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /tasks/:id (status transitions)', () => {
  it('completing sets completed_at and completed_by to the assignee', async () => {
    const u = await seedUser('member');
    const projectId = await seedProject(u.id);
    await addMember(projectId, u.id, 'member');
    const taskId = await seedTask({
      projectId,
      createdBy: u.id,
      status: 'in_progress',
      assigneeId: u.id,
    });

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: u.cookie, ...CSRF },
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(200);
    const { task } = res.json() as { task: Task };
    expect(task.status).toBe('done');
    expect(task.completedAt).not.toBeNull();
    expect(task.completedBy).toBe(u.id);
  });

  it('falls back to the operator for completed_by when unassigned', async () => {
    const lead = await seedUser('member');
    const projectId = await seedProject(lead.id);
    await addMember(projectId, lead.id, 'lead');
    const taskId = await seedTask({ projectId, createdBy: lead.id, status: 'open' });

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: lead.cookie, ...CSRF },
      payload: { status: 'done' },
    });
    expect(res.statusCode).toBe(200);
    const { task } = res.json() as { task: Task };
    expect(task.completedBy).toBe(lead.id);
  });

  it('reopening a done task clears completed_at and completed_by', async () => {
    const u = await seedUser('member');
    const projectId = await seedProject(u.id);
    await addMember(projectId, u.id, 'member');
    const taskId = await seedTask({
      projectId,
      createdBy: u.id,
      status: 'done',
      assigneeId: u.id,
      completedAt: new Date(),
      completedBy: u.id,
    });

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: u.cookie, ...CSRF },
      payload: { status: 'in_progress' },
    });
    expect(res.statusCode).toBe(200);
    const { task } = res.json() as { task: Task };
    expect(task.status).toBe('in_progress');
    expect(task.completedAt).toBeNull();
    expect(task.completedBy).toBeNull();
  });

  it('forbids editing a task you neither created nor are assigned to', async () => {
    const owner = await seedUser('member');
    const other = await seedUser('member');
    const projectId = await seedProject(owner.id);
    await addMember(projectId, owner.id, 'member');
    await addMember(projectId, other.id, 'member');
    const taskId = await seedTask({ projectId, createdBy: owner.id });

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: other.cookie, ...CSRF },
      payload: { title: '改个标题' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /tasks/:id', () => {
  it('lets the creator delete', async () => {
    const u = await seedUser('member');
    const projectId = await seedProject(u.id);
    await addMember(projectId, u.id, 'member');
    const taskId = await seedTask({ projectId, createdBy: u.id });

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: u.cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(204);
    expect(await getTaskRow(taskId)).toBeUndefined();
  });

  it('forbids a non-creator member from deleting', async () => {
    const owner = await seedUser('member');
    const other = await seedUser('member');
    const projectId = await seedProject(owner.id);
    await addMember(projectId, owner.id, 'member');
    await addMember(projectId, other.id, 'member');
    const taskId = await seedTask({ projectId, createdBy: owner.id });

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: other.cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets a global admin delete any task', async () => {
    const member = await seedUser('member');
    const admin = await seedUser('admin');
    const projectId = await seedProject(member.id);
    await addMember(projectId, member.id, 'member');
    const taskId = await seedTask({ projectId, createdBy: member.id });

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tasks/${taskId}`,
      headers: { cookie: admin.cookie, ...CSRF },
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('realtime bus', () => {
  it('publishes a task event after a mutation', async () => {
    const u = await seedUser('member');
    const projectId = await seedProject(u.id);
    await addMember(projectId, u.id, 'member');

    const events: { entity: string; type: string }[] = [];
    const unsubscribe = ctx.bus.subscribe([projectId], (e) =>
      events.push({ entity: e.entity, type: e.type }),
    );

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tasks`,
      headers: { cookie: u.cookie, ...CSRF },
      payload: { title: '发事件' },
    });
    expect(res.statusCode).toBe(201);
    unsubscribe();

    // We expect at least an activity event (created) and a task event (created).
    expect(events.some((e) => e.entity === 'task' && e.type === 'created')).toBe(true);
    expect(events.some((e) => e.entity === 'activity' && e.type === 'created')).toBe(true);
  });
});
