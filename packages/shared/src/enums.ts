import { z } from 'zod';

/**
 * Cross-cutting enumerations — the single source of truth for both the Drizzle
 * pg-enums (server) and the zod contracts (this package). Values mirror §5/§6 of
 * the design spec exactly. Identifiers/values are English; UI labels live on the web.
 */

/** Global account role (§5 users.role, §6.3). */
export const userRoles = ['admin', 'member'] as const;
export const userRoleSchema = z.enum(userRoles);
export type UserRole = (typeof userRoles)[number];

/** Per-project membership role (§5 project_members.role, §6.3). */
export const projectRoles = ['lead', 'member'] as const;
export const projectRoleSchema = z.enum(projectRoles);
export type ProjectRole = (typeof projectRoles)[number];

/**
 * Task / board column status (§6.1; lifecycle v2 §1). The board now has four
 * columns: open → in_progress → pending_review → done. `pending_review` is the
 * post-deliver state awaiting a lead/admin review (v2 §1).
 */
export const taskStatuses = [
  'open',
  'in_progress',
  'pending_review',
  'done',
] as const;
export const taskStatusSchema = z.enum(taskStatuses);
export type TaskStatus = (typeof taskStatuses)[number];

/** Task priority (§5 tasks.priority, default 'medium'). */
export const priorities = ['low', 'medium', 'high', 'urgent'] as const;
export const prioritySchema = z.enum(priorities);
export type Priority = (typeof priorities)[number];

/**
 * Activity / timeline event type (§5 activities.type). Lifecycle v2 (§3) adds
 * `delivered` (a claimant/lead submitted points allocations for review) and
 * `rejected` (a lead/admin sent the task back to in_progress).
 */
export const activityTypes = [
  'created',
  'claimed',
  'assigned',
  'unassigned',
  'released',
  'status_changed',
  'completed',
  'reopened',
  'commented',
  'updated',
  'delivered',
  'rejected',
] as const;
export const activityTypeSchema = z.enum(activityTypes);
export type ActivityType = (typeof activityTypes)[number];

/**
 * Idea / inspiration review status (§7.1). A posted idea starts `pending`; a
 * project lead / global admin either `adopted` it (writing a reward-points value
 * credited to the author's contribution) or `rejected` it.
 */
export const ideaStatuses = ['pending', 'adopted', 'rejected'] as const;
export const ideaStatusSchema = z.enum(ideaStatuses);
export type IdeaStatus = (typeof ideaStatuses)[number];

/**
 * Attachment mimes Coboard will serve INLINE for in-app preview (image lightbox +
 * embedded PDF). Anything else is always sent as a download. The list is the single
 * source of truth shared by the server (which only honours `?inline=1` for these,
 * with `X-Content-Type-Options: nosniff`, so arbitrary uploads can never be rendered
 * as a document) and the web client (which decides whether to offer a 预览 control).
 * SVG is intentionally excluded — it can carry script if ever opened as a document.
 */
export const inlinePreviewableMimes = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
] as const;

/** Whether an attachment of this mime may be previewed inline (vs download-only). */
export function isInlinePreviewable(mime: string): boolean {
  return (inlinePreviewableMimes as readonly string[]).includes(mime);
}

/** Whether an attachment of this mime is an image (rendered as a thumbnail/lightbox). */
export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/') && mime !== 'image/svg+xml';
}
