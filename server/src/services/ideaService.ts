import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Idea, IdeaStatus, IdeaWithContext, UserSummary } from 'shared';
import type { Database } from '../db/index.js';
import {
  ideas,
  projects,
  tasks,
  users,
  type IdeaRow,
  type UserRow,
} from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { publishChange } from './activityService.js';
import { bus, type RealtimeBus } from '../realtime/bus.js';

/**
 * Ideas / inspiration service (§7.1). Owns the data access for ideas posted against
 * a task: listing a task's ideas, posting a new one, the cross-project 灵感区 listing,
 * and the lead/admin adopt/reject mutations. Authorization (project membership,
 * lead/admin) is enforced by the route via guards; this layer only encodes the
 * visibility scope it is handed plus the data access and realtime fan-out.
 *
 * Adopted ideas' `reward_points` feed the contribution-points aggregation in
 * statsService (a user's total points = task-share points + adopted-idea rewards).
 */

// ---------------------------------------------------------------------------
// Row -> wire mapping
// ---------------------------------------------------------------------------

/** Map a user row to the §7.1 public-display summary (no email / password). */
function toUserSummary(row: UserRow): UserSummary {
  return {
    id: row.id,
    displayName: row.displayName,
    avatarColor: row.avatarColor,
    hasAvatar: row.avatarMime != null,
  };
}

/** Map an idea row + its author to the §7.1 `Idea` wire shape. */
function toIdea(row: IdeaRow, author: UserRow): Idea {
  return {
    id: row.id,
    taskId: row.taskId,
    author: toUserSummary(author),
    body: row.body,
    status: row.status,
    rewardPoints: row.rewardPoints,
    adoptedBy: row.adoptedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

/** Load an idea by id or throw 404. */
export async function loadIdeaOrThrow(db: Database, ideaId: string): Promise<IdeaRow> {
  const rows = await db.select().from(ideas).where(eq(ideas.id, ideaId)).limit(1);
  const idea = rows[0];
  if (!idea) {
    throw notFound('想法不存在');
  }
  return idea;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List a task's ideas (newest first) joined with their authors (§7.1). */
export async function listTaskIdeas(db: Database, taskId: string): Promise<Idea[]> {
  const rows = await db
    .select({ idea: ideas, author: users })
    .from(ideas)
    .innerJoin(users, eq(ideas.authorId, users.id))
    .where(eq(ideas.taskId, taskId))
    .orderBy(desc(ideas.createdAt));
  return rows.map((r) => toIdea(r.idea, r.author));
}

/**
 * Describes which projects the cross-project 灵感区 listing may aggregate over.
 * - `{ kind: 'all' }`                  — every project (global admin).
 * - `{ kind: 'projects', projectIds }` — the explicit set the caller belongs to.
 */
export type IdeaScope =
  | { kind: 'all' }
  | { kind: 'projects'; projectIds: string[] };

/**
 * List all ideas across the caller's visible projects (§7.1), newest first, each
 * enriched with its task title + owning project. Optionally filtered by status.
 * `scope` constrains visibility (admins: all projects; members: their projects).
 */
export async function listVisibleIdeas(
  db: Database,
  scope: IdeaScope,
  status?: IdeaStatus,
): Promise<IdeaWithContext[]> {
  if (scope.kind === 'projects' && scope.projectIds.length === 0) {
    return [];
  }

  const conditions = [];
  if (scope.kind === 'projects') {
    conditions.push(inArray(tasks.projectId, scope.projectIds));
  }
  if (status) {
    conditions.push(eq(ideas.status, status));
  }

  const rows = await db
    .select({
      idea: ideas,
      author: users,
      taskTitle: tasks.title,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(ideas)
    .innerJoin(users, eq(ideas.authorId, users.id))
    .innerJoin(tasks, eq(ideas.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(ideas.createdAt));

  return rows.map((r) => ({
    ...toIdea(r.idea, r.author),
    taskTitle: r.taskTitle,
    projectId: r.projectId,
    projectName: r.projectName,
  }));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateIdeaParams {
  taskId: string;
  projectId: string;
  authorId: string;
  body: string;
}

/**
 * Post an idea on a task (§7.1, any project member). Publishes an `idea`-entity
 * realtime event so other clients refresh. Returns the new idea joined with its
 * author.
 */
export async function createIdea(
  db: Database,
  params: CreateIdeaParams,
  realtimeBus: RealtimeBus = bus,
): Promise<Idea> {
  const [inserted] = await db
    .insert(ideas)
    .values({
      taskId: params.taskId,
      authorId: params.authorId,
      body: params.body,
    })
    .returning();

  if (!inserted) {
    // Unreachable: insert..returning yields a row on success.
    throw new Error('创建想法失败：未返回插入行');
  }

  const author = await loadUserOrThrow(db, params.authorId);

  publishChange(
    {
      type: 'idea_created',
      projectId: params.projectId,
      entity: 'idea',
      payload: { ideaId: inserted.id, taskId: params.taskId, authorId: params.authorId },
    },
    realtimeBus,
  );

  return toIdea(inserted, author);
}

/**
 * Adopt an idea + grant reward points (§7.1, lead/admin only — enforced by the
 * route). Idempotent-safe: re-adopting an already-adopted idea updates its reward
 * points + adopter. Bumps `updated_at` (the adoption time used by the stats time
 * filter). Publishes an `idea` realtime event AND a `task` event so stats refresh.
 */
export async function adoptIdea(
  db: Database,
  idea: IdeaRow,
  projectId: string,
  adopterId: string,
  rewardPoints: number,
  realtimeBus: RealtimeBus = bus,
): Promise<Idea> {
  const [updated] = await db
    .update(ideas)
    .set({
      status: 'adopted',
      rewardPoints,
      adoptedBy: adopterId,
      updatedAt: new Date(),
    })
    .where(eq(ideas.id, idea.id))
    .returning();
  if (!updated) throw notFound('想法不存在');

  const author = await loadUserOrThrow(db, updated.authorId);
  publishIdeaChange(realtimeBus, 'idea_adopted', updated, projectId);
  return toIdea(updated, author);
}

/**
 * Reject an idea (§7.1, lead/admin only). Clears any reward points and marks the
 * idea `rejected`, bumping `updated_at`. Publishes the same events as adopt so the
 * 灵感区 list and stats refresh.
 */
export async function rejectIdea(
  db: Database,
  idea: IdeaRow,
  projectId: string,
  reviewerId: string,
  realtimeBus: RealtimeBus = bus,
): Promise<Idea> {
  const [updated] = await db
    .update(ideas)
    .set({
      status: 'rejected',
      rewardPoints: null,
      adoptedBy: reviewerId,
      updatedAt: new Date(),
    })
    .where(eq(ideas.id, idea.id))
    .returning();
  if (!updated) throw notFound('想法不存在');

  const author = await loadUserOrThrow(db, updated.authorId);
  publishIdeaChange(realtimeBus, 'idea_rejected', updated, projectId);
  return toIdea(updated, author);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Publish both an `idea`-entity event (refresh idea lists) and a `task`-entity
 * event (adopting/rejecting an idea shifts contribution points, so stats refresh).
 */
function publishIdeaChange(
  realtimeBus: RealtimeBus,
  type: string,
  idea: IdeaRow,
  projectId: string,
): void {
  publishChange(
    {
      type,
      projectId,
      entity: 'idea',
      payload: { ideaId: idea.id, taskId: idea.taskId, authorId: idea.authorId },
    },
    realtimeBus,
  );
  // Adopting/rejecting changes the author's contribution points (§7.1); the
  // `task` channel is what the client uses to invalidate the `stats` queries.
  publishChange(
    {
      type,
      projectId,
      entity: 'task',
      payload: { taskId: idea.taskId },
    },
    realtimeBus,
  );
}

/** Load a user row by id or throw 404 (the author of a just-written idea). */
async function loadUserOrThrow(db: Database, userId: string): Promise<UserRow> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const user = rows[0];
  if (!user) {
    throw notFound('用户不存在');
  }
  return user;
}
