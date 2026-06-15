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

/** Task / board column status (§5 tasks.status, §6.1). */
export const taskStatuses = ['open', 'in_progress', 'done'] as const;
export const taskStatusSchema = z.enum(taskStatuses);
export type TaskStatus = (typeof taskStatuses)[number];

/** Task priority (§5 tasks.priority, default 'medium'). */
export const priorities = ['low', 'medium', 'high', 'urgent'] as const;
export const prioritySchema = z.enum(priorities);
export type Priority = (typeof priorities)[number];

/** Activity / timeline event type (§5 activities.type). */
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
] as const;
export const activityTypeSchema = z.enum(activityTypes);
export type ActivityType = (typeof activityTypes)[number];
