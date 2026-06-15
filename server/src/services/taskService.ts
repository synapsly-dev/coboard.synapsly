import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type {
  AssignTaskInput,
  CreateTaskInput,
  Task,
  TaskStatus,
  UpdateTaskInput,
} from 'shared';
import type { Database } from '../db/index.js';
import { tasks, type TaskRow } from '../db/schema.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import {
  canEditTask,
  requireProjectLead,
  requireProjectMember,
  type ProjectMembership,
} from '../lib/guards.js';
import type { FastifyRequest } from 'fastify';
import { publishChange, recordActivity } from './activityService.js';
import type { RealtimeBus } from '../realtime/bus.js';

/**
 * Task / board domain service (§6.1, §6.2, §6.5). Owns all task mutations: create,
 * edit (fields/status/rank), claim, release, assign, delete. Every mutation records
 * an activity AND publishes a `task` realtime event so SSE clients refresh their
 * board (§6.5). Authorization is delegated to `lib/guards.ts` (§6.3).
 *
 * `rank` is a lexicographic text key for intra-column ordering (§5/§6.1): tasks in
 * a column are sorted by `rank ASC, created_at ASC`. New tasks are appended after
 * the current last rank in their target column.
 */

// ---------------------------------------------------------------------------
// Rank: fractional/lexicographic ordering key (§6.1)
// ---------------------------------------------------------------------------

/**
 * Ordered alphabet for rank digits. Lexicographic string comparison over this
 * alphabet matches the intended order. We use a midpoint scheme so a rank can
 * always be generated strictly between any two neighbours without re-indexing.
 */
const RANK_DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const RANK_BASE = RANK_DIGITS.length;
const RANK_MIN = 0;
const RANK_MAX = RANK_BASE - 1;
/** Default rank used for the very first task in an empty column (~midpoint). */
const RANK_INITIAL = RANK_DIGITS[Math.floor(RANK_BASE / 2)] as string;

/** Digit value of the char at `index` in `s` (defaults: low for missing). */
function digitAt(s: string, index: number, fallback: number): number {
  if (index >= s.length) return fallback;
  const idx = RANK_DIGITS.indexOf(s.charAt(index));
  return idx < 0 ? fallback : idx;
}

/** The rank character for a digit value (guaranteed in-range). */
function digitChar(value: number): string {
  const clamped = Math.max(RANK_MIN, Math.min(RANK_MAX, value));
  return RANK_DIGITS.charAt(clamped);
}

/**
 * Generate a rank that sorts strictly between `before` and `after`. Either bound
 * may be null (open-ended). The result is a string over RANK_DIGITS that compares
 * lexicographically between the two — a simplified fractional-index scheme that
 * never needs a global re-index.
 */
export function rankBetween(before: string | null, after: string | null): string {
  if (before === null && after === null) return RANK_INITIAL;

  let prefix = '';
  let i = 0;
  for (;;) {
    // Missing digits: treat `before` as padded with the min digit, `after` as
    // padded with one past the max (so an open upper bound has room above).
    const b = before === null ? RANK_MIN : digitAt(before, i, RANK_MIN);
    const a = after === null ? RANK_BASE : digitAt(after, i, RANK_BASE);

    if (a - b > 1) {
      // Room for a midpoint digit strictly between the two bounds.
      return prefix + digitChar(Math.floor((a + b) / 2));
    }

    // Bounds are adjacent (or equal) at this position: keep the lower digit and
    // descend, widening the upper bound to "open" below this shared prefix.
    prefix += digitChar(b);
    i += 1;
    if (after !== null && i >= after.length) {
      // We have matched all of `after`; below it the upper bound is open.
      after = null;
    }
  }
}

/** Compute a rank that appends after the last task in the given column. */
async function nextRankForColumn(
  db: Database,
  projectId: string,
  status: TaskStatus,
): Promise<string> {
  const rows = await db
    .select({ rank: tasks.rank })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, status)))
    .orderBy(desc(tasks.rank))
    .limit(1);
  const last = rows[0]?.rank ?? null;
  return rankBetween(last, null);
}

// ---------------------------------------------------------------------------
// Row → wire mapping (§5 entity shape, ISO timestamps)
// ---------------------------------------------------------------------------

/** Serialize a persisted task row to the shared `Task` wire shape. */
export function serializeTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    status: row.status,
    assigneeId: row.assigneeId,
    points: row.points,
    priority: row.priority,
    dueDate: row.dueDate,
    createdBy: row.createdBy,
    rank: row.rank,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    completedBy: row.completedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Load a task row by id or throw 404. */
async function loadTask(db: Database, taskId: string): Promise<TaskRow> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  const task = rows[0];
  if (!task) {
    throw notFound('任务不存在');
  }
  return task;
}

/**
 * Resolve the membership context for a task's project (enforces visibility) and
 * return both the task and the membership. Non-members get 403 via the guard.
 */
async function loadTaskWithMembership(
  db: Database,
  request: FastifyRequest,
  taskId: string,
): Promise<{ task: TaskRow; membership: ProjectMembership }> {
  const task = await loadTask(db, taskId);
  const membership = await requireProjectMember(db, request, task.projectId);
  return { task, membership };
}

/** Publish a `task` realtime event for board invalidation (§6.5). */
function publishTaskChange(
  bus: RealtimeBus,
  type: string,
  task: TaskRow,
): void {
  publishChange(
    {
      type,
      projectId: task.projectId,
      entity: 'task',
      payload: { taskId: task.id, status: task.status },
    },
    bus,
  );
}

// ---------------------------------------------------------------------------
// Board read (§7 GET /projects/:id/tasks)
// ---------------------------------------------------------------------------

/**
 * Return all tasks for a project, ordered for the board (by rank then creation).
 * The client groups by `status` into the three fixed columns (§6.1).
 */
export async function listBoardTasks(db: Database, projectId: string): Promise<Task[]> {
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.rank), asc(tasks.createdAt));
  return rows.map(serializeTask);
}

// ---------------------------------------------------------------------------
// Create (§6.1 / §6.2 POST /projects/:id/tasks)
// ---------------------------------------------------------------------------

/**
 * Create a task. Defaults to `open`/unassigned. If `assigneeId` is supplied the
 * task is dispatched on creation → `in_progress` with that assignee (§6.1, §6.2).
 * Records `created` (+ `assigned` when dispatched) and publishes a task event.
 */
export async function createTask(
  db: Database,
  bus: RealtimeBus,
  request: FastifyRequest,
  projectId: string,
  input: CreateTaskInput,
): Promise<Task> {
  const membership = await requireProjectMember(db, request, projectId);
  const actor = membership.user;

  const dispatched = input.assigneeId != null;
  const status: TaskStatus = dispatched ? 'in_progress' : 'open';
  const rank = await nextRankForColumn(db, projectId, status);

  const [created] = await db
    .insert(tasks)
    .values({
      projectId,
      title: input.title,
      description: input.description ?? null,
      status,
      assigneeId: input.assigneeId ?? null,
      points: input.points ?? null,
      priority: input.priority,
      dueDate: input.dueDate ?? null,
      createdBy: actor.id,
      rank,
    })
    .returning();

  if (!created) {
    throw new Error('创建任务失败：未返回插入行');
  }

  await recordActivity(db, {
    taskId: created.id,
    projectId,
    actorId: actor.id,
    type: 'created',
    meta: { title: created.title },
  }, bus);

  if (dispatched) {
    await recordActivity(db, {
      taskId: created.id,
      projectId,
      actorId: actor.id,
      type: 'assigned',
      meta: { assigneeId: created.assigneeId },
    }, bus);
  }

  publishTaskChange(bus, 'created', created);
  return serializeTask(created);
}

// ---------------------------------------------------------------------------
// Read single (§7 GET /tasks/:id)
// ---------------------------------------------------------------------------

export async function getTask(
  db: Database,
  request: FastifyRequest,
  taskId: string,
): Promise<Task> {
  const { task } = await loadTaskWithMembership(db, request, taskId);
  return serializeTask(task);
}

// ---------------------------------------------------------------------------
// Update fields / status / rank (§6.1 PATCH /tasks/:id)
// ---------------------------------------------------------------------------

/**
 * Patch a task. Handles field edits, status transitions, and rank changes:
 * - moving to `done` sets `completed_at=now` and `completed_by` (current assignee,
 *   falling back to the actor) and records `completed` (§6.2).
 * - reopening (done → open|in_progress) clears `completed_at/completed_by` and
 *   records `reopened` (§6.2).
 * - other status changes record `status_changed` with {from,to}.
 * - field-only edits record `updated`.
 * Requires edit permission on the task (§6.3).
 */
export async function updateTask(
  db: Database,
  bus: RealtimeBus,
  request: FastifyRequest,
  taskId: string,
  input: UpdateTaskInput,
): Promise<Task> {
  const { task, membership } = await loadTaskWithMembership(db, request, taskId);
  if (!canEditTask(membership, task)) {
    throw forbidden('只能编辑自己创建或负责的任务');
  }
  const actor = membership.user;

  const patch: Partial<TaskRow> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.points !== undefined) patch.points = input.points;
  if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
  if (input.rank !== undefined) patch.rank = input.rank;

  const nextStatus = input.status;
  const statusChanged = nextStatus !== undefined && nextStatus !== task.status;

  // Determine the activity type for the status transition (if any).
  let statusActivity:
    | { type: 'completed' | 'reopened' | 'status_changed'; from: TaskStatus; to: TaskStatus }
    | null = null;

  if (statusChanged) {
    const to = nextStatus as TaskStatus;
    patch.status = to;
    if (to === 'done') {
      patch.completedAt = new Date();
      // Contribution attribution: current assignee, else the operator (§6.2).
      patch.completedBy = task.assigneeId ?? actor.id;
      statusActivity = { type: 'completed', from: task.status, to };
    } else if (task.status === 'done') {
      // Reopen: clear completion attribution (§6.2).
      patch.completedAt = null;
      patch.completedBy = null;
      statusActivity = { type: 'reopened', from: task.status, to };
    } else {
      statusActivity = { type: 'status_changed', from: task.status, to };
    }
  }

  const [updated] = await db
    .update(tasks)
    .set(patch)
    .where(eq(tasks.id, taskId))
    .returning();

  if (!updated) {
    throw notFound('任务不存在');
  }

  if (statusActivity) {
    await recordActivity(db, {
      taskId,
      projectId: updated.projectId,
      actorId: actor.id,
      type: statusActivity.type,
      meta: { from: statusActivity.from, to: statusActivity.to },
    }, bus);
  } else {
    // Field-only edit (incl. rank reorder).
    await recordActivity(db, {
      taskId,
      projectId: updated.projectId,
      actorId: actor.id,
      type: 'updated',
      meta: { fields: Object.keys(patch) },
    }, bus);
  }

  publishTaskChange(bus, statusActivity ? statusActivity.type : 'updated', updated);
  return serializeTask(updated);
}

// ---------------------------------------------------------------------------
// Claim (§6.2 POST /tasks/:id/claim)
// ---------------------------------------------------------------------------

/**
 * Claim an unassigned, open task: sets assignee=self, status=in_progress (§6.2).
 * Returns 409 if the task is already claimed/not open — the update is conditional
 * (`WHERE status='open' AND assignee IS NULL`) so concurrent claimers race safely:
 * exactly one update affects a row, the loser gets a conflict.
 */
export async function claimTask(
  db: Database,
  bus: RealtimeBus,
  request: FastifyRequest,
  taskId: string,
): Promise<Task> {
  const { task, membership } = await loadTaskWithMembership(db, request, taskId);
  const actor = membership.user;

  const updatedRows = await db
    .update(tasks)
    .set({ assigneeId: actor.id, status: 'in_progress' })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.status, 'open'),
        // assignee must be null: an unassigned, open task.
        isNull(tasks.assigneeId),
      ),
    )
    .returning();

  const updated = updatedRows[0];
  if (!updated) {
    // Either it wasn't open/unassigned or it vanished — distinguish for a clear msg.
    throw conflict('任务已被认领或不可认领');
  }

  await recordActivity(db, {
    taskId,
    projectId: task.projectId,
    actorId: actor.id,
    type: 'claimed',
    meta: {},
  }, bus);

  publishTaskChange(bus, 'claimed', updated);
  return serializeTask(updated);
}

// ---------------------------------------------------------------------------
// Release (§6.2 POST /tasks/:id/release)
// ---------------------------------------------------------------------------

/**
 * Release a task back to the pool: assignee=null, status=open (§6.2). Permitted to
 * the current assignee or a project lead/admin.
 */
export async function releaseTask(
  db: Database,
  bus: RealtimeBus,
  request: FastifyRequest,
  taskId: string,
): Promise<Task> {
  const { task, membership } = await loadTaskWithMembership(db, request, taskId);
  const actor = membership.user;

  const isAssignee = task.assigneeId === actor.id;
  const isLead = membership.projectRole === 'lead' || actor.role === 'admin';
  if (!isAssignee && !isLead) {
    throw forbidden('只有负责人或项目负责人可以释放任务');
  }

  const [updated] = await db
    .update(tasks)
    .set({ assigneeId: null, status: 'open', completedAt: null, completedBy: null })
    .where(eq(tasks.id, taskId))
    .returning();

  if (!updated) {
    throw notFound('任务不存在');
  }

  await recordActivity(db, {
    taskId,
    projectId: task.projectId,
    actorId: actor.id,
    type: 'released',
    meta: { previousAssigneeId: task.assigneeId },
  }, bus);

  publishTaskChange(bus, 'released', updated);
  return serializeTask(updated);
}

// ---------------------------------------------------------------------------
// Assign / dispatch (§6.2 POST /tasks/:id/assign)
// ---------------------------------------------------------------------------

/**
 * Dispatch a task to a member (lead/admin only). Sets the assignee and, if the
 * task is still `open`, moves it to `in_progress` (§6.2). Records `assigned`.
 */
export async function assignTask(
  db: Database,
  bus: RealtimeBus,
  request: FastifyRequest,
  taskId: string,
  input: AssignTaskInput,
): Promise<Task> {
  const task = await loadTask(db, taskId);
  // Lead/admin only — enforce via the project lead guard.
  const membership = await requireProjectLead(db, request, task.projectId);
  const actor = membership.user;

  const nextStatus: TaskStatus = task.status === 'open' ? 'in_progress' : task.status;

  const [updated] = await db
    .update(tasks)
    .set({ assigneeId: input.assigneeId, status: nextStatus })
    .where(eq(tasks.id, taskId))
    .returning();

  if (!updated) {
    throw notFound('任务不存在');
  }

  await recordActivity(db, {
    taskId,
    projectId: task.projectId,
    actorId: actor.id,
    type: 'assigned',
    meta: { assigneeId: input.assigneeId, previousAssigneeId: task.assigneeId },
  }, bus);

  publishTaskChange(bus, 'assigned', updated);
  return serializeTask(updated);
}

// ---------------------------------------------------------------------------
// Delete (§6.3 DELETE /tasks/:id)
// ---------------------------------------------------------------------------

/**
 * Delete a task. Permitted to the creator, a project lead, or a global admin
 * (§6.3 — canEditTask covers creator/lead/admin). Publishes a deletion event; no
 * activity row is recorded since the task (and its activities) cease to exist.
 */
export async function deleteTask(
  db: Database,
  bus: RealtimeBus,
  request: FastifyRequest,
  taskId: string,
): Promise<void> {
  const { task, membership } = await loadTaskWithMembership(db, request, taskId);
  if (!canEditTask(membership, task)) {
    throw forbidden('只能删除自己创建或负责的任务');
  }

  await db.delete(tasks).where(eq(tasks.id, taskId));

  publishChange(
    {
      type: 'deleted',
      projectId: task.projectId,
      entity: 'task',
      payload: { taskId: task.id },
    },
    bus,
  );
}
