import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { ProjectRole } from 'shared';
import type { Database } from '../db/index.js';
import {
  projectMembers,
  projects,
  type ProjectRow,
  type TaskRow,
  type UserRow,
} from '../db/schema.js';
import { forbidden, notFound, unauthorized } from './errors.js';

/**
 * Centralized authorization (§6.3). Every write path must pass through a guard;
 * the front-end only hides actions cosmetically. Guards throw AppError (401/403/
 * 404) and otherwise return the resolved context the handler needs.
 */

/** Require an authenticated, active user. Returns the user row. */
export function requireAuth(request: FastifyRequest): UserRow {
  if (!request.user) {
    throw unauthorized();
  }
  return request.user;
}

/** Require a global admin. */
export function requireAdmin(request: FastifyRequest): UserRow {
  const user = requireAuth(request);
  if (user.role !== 'admin') {
    throw forbidden('需要管理员权限');
  }
  return user;
}

export interface ProjectMembership {
  user: UserRow;
  project: ProjectRow;
  /** The user's role in this project; admins are treated as 'lead'. */
  projectRole: ProjectRole;
  /** True if the user is a real member row (false for admins acting cross-project). */
  isMemberRow: boolean;
}

/** Load a project by id or throw 404. */
async function loadProject(db: Database, projectId: string): Promise<ProjectRow> {
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const project = rows[0];
  if (!project) {
    throw notFound('项目不存在');
  }
  return project;
}

/**
 * Resolve a user's membership in a project. Global admins are granted lead-level
 * access to every project even without a membership row (§6.3). Throws 403 for
 * non-admins who are not members (non-members must not even see the project).
 */
export async function requireProjectMember(
  db: Database,
  request: FastifyRequest,
  projectId: string,
): Promise<ProjectMembership> {
  const user = requireAuth(request);
  const project = await loadProject(db, projectId);

  const rows = await db
    .select()
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, user.id),
      ),
    )
    .limit(1);
  const membership = rows[0];

  if (membership) {
    return {
      user,
      project,
      projectRole: membership.role,
      isMemberRow: true,
    };
  }

  if (user.role === 'admin') {
    return { user, project, projectRole: 'lead', isMemberRow: false };
  }

  // Non-members must not learn whether the project exists.
  throw forbidden('你不是该项目成员');
}

/**
 * Require the user to be a project lead (or global admin). Builds on
 * requireProjectMember.
 */
export async function requireProjectLead(
  db: Database,
  request: FastifyRequest,
  projectId: string,
): Promise<ProjectMembership> {
  const ctx = await requireProjectMember(db, request, projectId);
  if (ctx.projectRole !== 'lead') {
    throw forbidden('需要项目负责人权限');
  }
  return ctx;
}

/**
 * Whether `user` may edit/delete `task` within `membership` (§6.3):
 * - global admin: yes
 * - project lead: yes (any task in the project)
 * - member: only tasks they created or are assigned to
 */
export function canEditTask(membership: ProjectMembership, task: TaskRow): boolean {
  const { user, projectRole } = membership;
  if (user.role === 'admin') return true;
  if (projectRole === 'lead') return true;
  return task.createdBy === user.id || task.assigneeId === user.id;
}

/** Throwing variant of canEditTask. */
export function requireCanEditTask(
  membership: ProjectMembership,
  task: TaskRow,
): void {
  if (!canEditTask(membership, task)) {
    throw forbidden('只能编辑自己创建或负责的任务');
  }
}
