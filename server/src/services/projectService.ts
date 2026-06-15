import { and, asc, eq } from 'drizzle-orm';
import type {
  CreateProjectInput,
  Project,
  ProjectMemberWithUser,
  ProjectRole,
  UpdateProjectInput,
  User,
} from 'shared';
import type { Database } from '../db/index.js';
import {
  projectMembers,
  projects,
  users,
  type ProjectMemberRow,
  type ProjectRow,
  type UserRow,
} from '../db/schema.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { publishChange } from './activityService.js';

/**
 * Project & membership business logic (§6.3, §7). Routes stay thin: they run the
 * auth/project guards and validate input, then delegate here. This module owns
 * visibility rules (non-members cannot see a project), lead/admin-only mutations,
 * uniqueness conflicts, and realtime fan-out for project/membership changes.
 *
 * Postgres uniqueness violation code; mapped to a 409 so concurrent/duplicate
 * writes surface as the §7 conflict shape rather than a 500.
 */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

// ---------------------------------------------------------------------------
// Presenters: DB rows -> wire shapes (§5/§7). Dates become ISO-8601 strings.
// ---------------------------------------------------------------------------

/** Public-safe user (never leaks password_hash). */
export function presentUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarColor: row.avatarColor,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

export function presentProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    description: row.description,
    archived: row.archived,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function presentMember(
  member: ProjectMemberRow,
  user: UserRow,
): ProjectMemberWithUser {
  return {
    id: member.id,
    projectId: member.projectId,
    userId: member.userId,
    role: member.role,
    createdAt: member.createdAt.toISOString(),
    user: presentUser(user),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Projects visible to a user (§6.3): admins see every project; everyone else sees
 * only the projects they are a member of. Ordered by creation time for stability.
 */
export async function listVisibleProjects(
  db: Database,
  user: UserRow,
): Promise<Project[]> {
  if (user.role === 'admin') {
    const rows = await db
      .select()
      .from(projects)
      .orderBy(asc(projects.createdAt));
    return rows.map(presentProject);
  }

  const rows = await db
    .select({ project: projects })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(eq(projectMembers.userId, user.id))
    .orderBy(asc(projects.createdAt));
  return rows.map((r) => presentProject(r.project));
}

/** Members of a project joined with their user, oldest first. */
export async function listProjectMembers(
  db: Database,
  projectId: string,
): Promise<ProjectMemberWithUser[]> {
  const rows = await db
    .select({ member: projectMembers, user: users })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(projectMembers.createdAt));
  return rows.map((r) => presentMember(r.member, r.user));
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a project (admin only — enforced in the route) and auto-add the creator
 * as the project lead (§6.3 / §7). A duplicate `key` surfaces as a 409.
 */
export async function createProject(
  db: Database,
  creator: UserRow,
  input: CreateProjectInput,
): Promise<Project> {
  let row: ProjectRow | undefined;
  try {
    [row] = await db
      .insert(projects)
      .values({
        name: input.name,
        key: input.key,
        description: input.description ?? null,
        createdBy: creator.id,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('项目标识已被占用');
    }
    throw error;
  }

  if (!row) {
    throw new Error('创建项目失败：未返回插入行');
  }

  // Auto-enroll the creator as lead so they can manage the project immediately.
  await db.insert(projectMembers).values({
    projectId: row.id,
    userId: creator.id,
    role: 'lead',
  });

  const project = presentProject(row);
  publishChange({
    type: 'created',
    projectId: project.id,
    entity: 'project',
    payload: { projectId: project.id },
  });
  return project;
}

/**
 * Update a project's name/description/archived flag (§7). Caller must already be a
 * lead or admin (enforced via the project-lead guard in the route).
 */
export async function updateProject(
  db: Database,
  projectId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  const patch: Partial<ProjectRow> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.archived !== undefined) patch.archived = input.archived;

  const [row] = await db
    .update(projects)
    .set(patch)
    .where(eq(projects.id, projectId))
    .returning();

  if (!row) {
    throw notFound('项目不存在');
  }

  const project = presentProject(row);
  publishChange({
    type: 'updated',
    projectId: project.id,
    entity: 'project',
    payload: { projectId: project.id },
  });
  return project;
}

/**
 * Add a user to a project with a role (§6.3 / §7). Validates the target user
 * exists and is not already a member; either condition yields the right §7 status
 * (404 for an unknown user, 409 for a duplicate membership).
 */
export async function addProjectMember(
  db: Database,
  projectId: string,
  // Accepts an optional `role` so the call site is independent of zod's
  // optional-vs-required default inference; defaults to 'member' (schema/DB default).
  input: { userId: string; role?: ProjectRole },
): Promise<ProjectMemberWithUser> {
  const role: ProjectRole = input.role ?? 'member';
  const [targetUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!targetUser) {
    throw notFound('用户不存在');
  }

  let member: ProjectMemberRow | undefined;
  try {
    [member] = await db
      .insert(projectMembers)
      .values({
        projectId,
        userId: input.userId,
        role,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('该用户已是项目成员');
    }
    throw error;
  }

  if (!member) {
    throw new Error('添加成员失败：未返回插入行');
  }

  publishChange({
    type: 'updated',
    projectId,
    entity: 'project',
    payload: { projectId, userId: input.userId },
  });
  return presentMember(member, targetUser);
}

/**
 * Remove a user from a project (§6.3 / §7). Refuses to remove the project's last
 * lead so a project can never become unmanageable. A non-member yields a 404.
 */
export async function removeProjectMember(
  db: Database,
  projectId: string,
  userId: string,
): Promise<void> {
  const [member] = await db
    .select()
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    )
    .limit(1);
  if (!member) {
    throw notFound('该用户不是项目成员');
  }

  if (member.role === 'lead') {
    const leads = await db
      .select({ id: projectMembers.id })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.role, 'lead'),
        ),
      );
    if (leads.length <= 1) {
      throw forbidden('不能移除项目唯一的负责人');
    }
  }

  await db
    .delete(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    );

  publishChange({
    type: 'updated',
    projectId,
    entity: 'project',
    payload: { projectId, userId },
  });
}
