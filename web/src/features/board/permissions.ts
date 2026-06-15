import type { ProjectMemberWithUser, ProjectRole, Task, User } from 'shared';

/**
 * Front-end permission predicates (§6.3). These mirror the server guards so the
 * UI can hide actions a user can't perform — but they are NOT a security boundary
 * (the server re-checks every write). Keep them conservative and aligned with the
 * spec; when in doubt, show the control and let the server reject.
 */

export interface TaskPermissionContext {
  user: User | null;
  /** The current user's per-project role, if a member of this project. */
  projectRole: ProjectRole | undefined;
}

/** Resolve the current user's project role from the members list. */
export function resolveProjectRole(
  members: ProjectMemberWithUser[] | undefined,
  userId: string | undefined,
): ProjectRole | undefined {
  if (!members || !userId) return undefined;
  return members.find((m) => m.userId === userId)?.role;
}

/** Global admin or project lead — the "manager" tier (§6.3). */
export function isManager(ctx: TaskPermissionContext): boolean {
  return ctx.user?.role === 'admin' || ctx.projectRole === 'lead';
}

/**
 * Can the user edit a task's fields / move it on the board (§6.3)?
 * - admin / lead: any task in the project.
 * - member: tasks they created or are assigned to.
 */
export function canEditTask(ctx: TaskPermissionContext, task: Task): boolean {
  if (!ctx.user) return false;
  if (isManager(ctx)) return true;
  return task.createdBy === ctx.user.id || task.assigneeId === ctx.user.id;
}

/** Can the user delete a task? admin / lead, or the creator (§6.3). */
export function canDeleteTask(ctx: TaskPermissionContext, task: Task): boolean {
  if (!ctx.user) return false;
  if (isManager(ctx)) return true;
  return task.createdBy === ctx.user.id;
}

/** Can the user dispatch (assign) tasks? admin / lead only (§6.2). */
export function canAssign(ctx: TaskPermissionContext): boolean {
  return isManager(ctx);
}

/** Can the user release this task? the assignee themselves, or admin / lead (§6.2). */
export function canRelease(ctx: TaskPermissionContext, task: Task): boolean {
  if (!ctx.user || !task.assigneeId) return false;
  return task.assigneeId === ctx.user.id || isManager(ctx);
}

/** Can the user claim this task? any member, when it's open + unassigned (§6.2). */
export function canClaim(ctx: TaskPermissionContext, task: Task): boolean {
  return !!ctx.user && task.status === 'open' && task.assigneeId === null;
}
