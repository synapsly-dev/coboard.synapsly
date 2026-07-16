import { isAdminRole, type ProjectRole } from '../enums.js';
import type { ProjectMemberWithUser, Task, User } from '../schema.js';

export interface TaskPermissionContext {
  user: User | null;
  projectRole: ProjectRole | undefined;
}

export type PendingReviewStage = 'single' | 'first' | 'final';

export function resolveProjectRole(
  members: ProjectMemberWithUser[] | undefined,
  userId: string | undefined,
): ProjectRole | undefined {
  if (!members || !userId) return undefined;
  return members.find((member) => member.userId === userId)?.role;
}

export function activeTaskStatus(
  claimantCount: number,
  minClaimants: number,
): 'open' | 'in_progress' {
  return claimantCount >= minClaimants ? 'in_progress' : 'open';
}

export function isPoolTask(task: Task): boolean {
  return task.projectId === null;
}

export function isManager(ctx: TaskPermissionContext, task: Task): boolean {
  if (!ctx.user) return false;
  if (isAdminRole(ctx.user.role)) return true;
  if (isPoolTask(task)) return task.createdBy === ctx.user.id;
  return ctx.projectRole === 'lead';
}

export function isClaimant(ctx: TaskPermissionContext, task: Task): boolean {
  return ctx.user != null && task.claimants.some((claimant) => claimant.userId === ctx.user!.id);
}

export function canEditTask(ctx: TaskPermissionContext, task: Task): boolean {
  if (!ctx.user) return false;
  return isManager(ctx, task) || task.createdBy === ctx.user.id || isClaimant(ctx, task);
}

export function canDeleteTask(ctx: TaskPermissionContext, task: Task): boolean {
  if (!ctx.user) return false;
  return isManager(ctx, task) || task.createdBy === ctx.user.id;
}

export function canAssign(ctx: TaskPermissionContext, task: Task): boolean {
  return isManager(ctx, task);
}

export function isClaimFull(task: Task): boolean {
  return task.maxClaimants != null && task.claimants.length >= task.maxClaimants;
}

export function isBelowMinClaimants(task: Task): boolean {
  return task.claimants.length < task.minClaimants;
}

export function canClaim(ctx: TaskPermissionContext, task: Task): boolean {
  if (!ctx.user) return false;
  if (task.status !== 'open' && task.status !== 'in_progress') return false;
  return !isClaimFull(task) && !isClaimant(ctx, task);
}

export function canDeliver(ctx: TaskPermissionContext, task: Task): boolean {
  if (!ctx.user || task.status !== 'in_progress' || task.claimants.length === 0) return false;
  return isClaimant(ctx, task) || isManager(ctx, task);
}

function isTaskReviewer(ctx: TaskPermissionContext, task: Task): boolean {
  if (!ctx.user) return false;
  if (isAdminRole(ctx.user.role)) return true;
  return !isPoolTask(task) && ctx.projectRole === 'lead';
}

export function pendingReviewStage(task: Task): PendingReviewStage {
  if (!task.needsFinalReview) return 'single';
  return task.firstApprovedAt == null ? 'first' : 'final';
}

export function canReview(ctx: TaskPermissionContext, task: Task): boolean {
  if (task.status !== 'pending_review' || !isTaskReviewer(ctx, task)) return false;
  if (pendingReviewStage(task) === 'final') {
    return ctx.user != null && isAdminRole(ctx.user.role);
  }
  return true;
}

export function canRevokeApproval(ctx: TaskPermissionContext, task: Task): boolean {
  return task.status === 'done' && isTaskReviewer(ctx, task);
}
