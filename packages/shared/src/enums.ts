import { z } from 'zod';

/**
 * Cross-cutting enumerations — the single source of truth for both the Drizzle
 * pg-enums (server) and the zod contracts (this package). Values mirror §5/§6 of
 * the design spec exactly. Identifiers/values are English; UI labels live on the web.
 */

/** Global account role (§5 users.role, §6.3). */
export const userRoles = ['super_admin', 'admin', 'member'] as const;
export const userRoleSchema = z.enum(userRoles);
export type UserRole = (typeof userRoles)[number];

/** Highest local role. Exactly one active Coboard account may hold it. */
export function isSuperAdminRole(role: UserRole | null | undefined): boolean {
  return role === 'super_admin';
}

/** Global admin tier: super_admin plus ordinary admin. */
export function isAdminRole(role: UserRole | null | undefined): boolean {
  return role === 'super_admin' || role === 'admin';
}

/** Per-project membership role (§5 project_members.role, §6.3). */
export const projectRoles = ['lead', 'member'] as const;
export const projectRoleSchema = z.enum(projectRoles);
export type ProjectRole = (typeof projectRoles)[number];

/**
 * Task / board column status (§6.1; lifecycle v2 §1). The board now has four
 * columns: open → in_progress → pending_review → done. `pending_review` is the
 * post-deliver state awaiting a lead/admin review (v2 §1).
 */
export const taskStatuses = ['open', 'in_progress', 'pending_review', 'done'] as const;
export const taskStatusSchema = z.enum(taskStatuses);
export type TaskStatus = (typeof taskStatuses)[number];

/** Task priority (§5 tasks.priority, default 'medium'). */
export const priorities = ['low', 'medium', 'high', 'urgent'] as const;
export const prioritySchema = z.enum(priorities);
export type Priority = (typeof priorities)[number];

/**
 * Track membership role (P0 §3). A 赛道 (track) carries `manager`s (赛道运营经理 —
 * the new middle management tier, lead-equivalent over every project in the track)
 * and plain `member`s. Distinct from projectRoles / orgMemberRoles.
 */
export const trackMemberRoles = ['manager', 'member'] as const;
export const trackMemberRoleSchema = z.enum(trackMemberRoles);
export type TrackMemberRole = (typeof trackMemberRoles)[number];

/**
 * Task type A/B/C/D (运营需求 §4.1). Orthogonal to `priority`. Values are English
 * semantic identifiers; the UI renders the letter code + Chinese label:
 *   critical  → A 类·关键任务  (高价值/高风险/跨部门；必须指定主负责人)
 *   baseline  → B 类·底线任务  (每个活跃成员每周最低交付；点对点分配)
 *   claimable → C 类·认领任务  (进入公共任务池，主动认领)
 *   collab    → D 类·协作任务  (轻量辅助支持；开放辅助认领)
 */
export const taskTypes = ['critical', 'baseline', 'claimable', 'collab'] as const;
export const taskTypeSchema = z.enum(taskTypes);
export type TaskType = (typeof taskTypes)[number];

/**
 * 交付质量 A/B/C/D (P2 §2, 运营需求 §4.2). Recorded at review time. Distinct from
 * taskTypes: 任务类型管理任务，交付质量验收成果. Values lowercase to avoid clashing
 * with the type letters in code; UI renders the uppercase letter.
 */
export const qualityGrades = ['a', 'b', 'c', 'd'] as const;
export const qualityGradeSchema = z.enum(qualityGrades);
export type QualityGrade = (typeof qualityGrades)[number];

/**
 * 质量系数 (运营需求 §4.2/§8): suggested final points = base × coefficient. The
 * system SUGGESTS; the reviewer confirms points manually (docx §13.5).
 */
export const QUALITY_COEFFICIENTS: Record<QualityGrade, number> = {
  a: 1.2,
  b: 1.0,
  c: 0.6,
  d: 0,
};

/**
 * Review stage (P2 §3 两级复核): `first` = 初审 (project lead / 赛道经理), `final`
 * = 复核 (global admin / 总运营) for high-value tasks (A类 or points ≥ 8).
 */
export const reviewStages = ['first', 'final'] as const;
export const reviewStageSchema = z.enum(reviewStages);
export type ReviewStage = (typeof reviewStages)[number];

/** Review decision (P2 §2; mirrors the wire reviewDecisionSchema). */
export const reviewDecisions = ['approve', 'reject'] as const;

/**
 * 资产库 kind (P3 §1, 运营需求 §9 周复盘沉淀): content=内容库, feedback=反馈库,
 * resource=资源库, issue=问题清单. Assets are the durable output of the weekly
 * retrospective loop — reusable content, user feedback, resource leads, issues.
 */
export const assetKinds = ['content', 'feedback', 'resource', 'issue'] as const;
export const assetKindSchema = z.enum(assetKinds);
export type AssetKind = (typeof assetKinds)[number];

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
  // P2 异常流: a lead moved a task between people / changed the DDL with a reason.
  'transferred',
  'due_changed',
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
 * Org-tree node kind (team org / division-of-labor page). Purely a visual/semantic
 * label — the tree nests to any depth regardless of kind: `track` (赛道) and
 * `department` (部门) may sit side-by-side at the team root, `group` (小组) is
 * the execution level, and `position` (岗位, P1) is a recruitable leaf that carries
 * a headcount and accepts 申报 (applications). A `track` node is linked to the
 * operational Track entity rather than being a second, name-only copy of it.
 */
export const orgNodeKinds = ['department', 'group', 'position', 'track'] as const;
export const orgNodeKindSchema = z.enum(orgNodeKinds);
export type OrgNodeKind = (typeof orgNodeKinds)[number];

/**
 * 岗位申报 status (P1 §1). `pending` awaits a decision; an approver moves it to
 * `approved` (writing the member row) or `rejected`; the applicant may withdraw
 * their own pending application (`withdrawn`).
 */
export const applicationStatuses = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export const applicationStatusSchema = z.enum(applicationStatuses);
export type ApplicationStatus = (typeof applicationStatuses)[number];

/**
 * A person's role on an org-tree node: `lead` (负责人) or `member` (成员). A node may
 * carry multiple of each. Distinct from the project membership role enum.
 */
export const orgMemberRoles = ['lead', 'member'] as const;
export const orgMemberRoleSchema = z.enum(orgMemberRoles);
export type OrgMemberRole = (typeof orgMemberRoles)[number];

/**
 * Durable per-recipient notification kinds. These remain application-level text
 * values rather than PostgreSQL enums: notification producers will grow over time,
 * and adding a new producer must not require altering a database enum.
 */
export const notificationTypes = [
  'task_assigned',
  'task_unassigned',
  'task_transferred',
  'user_mentioned',
  'comment_replied',
  'task_delivered',
  'review_requested',
  'review_approved',
  'review_rejected',
  'task_reopened',
  'deadline_changed',
  'deadline_due_soon',
  'deadline_overdue',
  'application_submitted',
  'application_approved',
  'application_rejected',
  'membership_changed',
  'role_changed',
  'account_status_changed',
  'points_awarded',
  'idea_adopted',
  'idea_rejected',
  'announcement_published',
  'watched_entity_updated',
] as const;
export const notificationTypeSchema = z.enum(notificationTypes);
export type NotificationType = (typeof notificationTypes)[number];

/** Objects a notification may deep-link to. `actor` and `recipient` stay users. */
export const notificationEntityTypes = [
  'task',
  'comment',
  'project',
  'track',
  'org_application',
  'org_node',
  'announcement',
  'user',
  'idea',
  'asset',
] as const;
export const notificationEntityTypeSchema = z.enum(notificationEntityTypes);
export type NotificationEntityType = (typeof notificationEntityTypes)[number];

/** Entity kinds users may explicitly watch or mute. */
export const subscriptionEntityTypes = [
  'task',
  'project',
  'track',
  'org_node',
  'idea',
  'asset',
] as const;
export const subscriptionEntityTypeSchema = z.enum(subscriptionEntityTypes);
export type SubscriptionEntityType = (typeof subscriptionEntityTypes)[number];

export const notificationPriorities = ['normal', 'high', 'urgent'] as const;
export const notificationPrioritySchema = z.enum(notificationPriorities);
export type NotificationPriority = (typeof notificationPriorities)[number];

/** Explicit per-entity override. Absence means normal rule-based delivery. */
export const entitySubscriptionModes = ['watching', 'muted'] as const;
export const entitySubscriptionModeSchema = z.enum(entitySubscriptionModes);
export type EntitySubscriptionMode = (typeof entitySubscriptionModes)[number];

/** Stable preference groups shown in notification settings. */
export const notificationTopics = [
  'assignments',
  'mentions',
  'reviews',
  'deadlines',
  'applications',
  'membership',
  'announcements',
  'watched_updates',
  'points',
  'security',
] as const;
export const notificationTopicSchema = z.enum(notificationTopics);
export type NotificationTopic = (typeof notificationTopics)[number];

export const notificationChannels = ['in_app', 'browser', 'email'] as const;
export const notificationChannelSchema = z.enum(notificationChannels);
export type NotificationChannel = (typeof notificationChannels)[number];

/** Missing preference rows inherit the system default for the topic/channel. */
export const notificationDeliveries = ['immediate', 'daily_digest', 'off'] as const;
export const notificationDeliverySchema = z.enum(notificationDeliveries);
export type NotificationDelivery = (typeof notificationDeliveries)[number];

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
