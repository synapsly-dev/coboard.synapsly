import { z } from 'zod';
import {
  activityTypeSchema,
  applicationStatusSchema,
  ideaStatusSchema,
  orgMemberRoleSchema,
  orgNodeKindSchema,
  prioritySchema,
  projectRoleSchema,
  assetKindSchema,
  qualityGradeSchema,
  reviewDecisions,
  reviewStageSchema,
  taskStatusSchema,
  taskTypeSchema,
  trackMemberRoleSchema,
  userRoleSchema,
} from './enums.js';

/**
 * Zod contracts — the single source of truth for every request/response body
 * (§7) and every entity (§5). Front-end forms and back-end validation both import
 * from here. Keep this exhaustive; downstream agents depend on it.
 *
 * Conventions:
 * - Timestamps cross the wire as ISO-8601 strings (JSON-serialized Date).
 * - UUIDs validated with `.uuid()`.
 * - `*Input` schemas describe request bodies; `*Schema` (no suffix) describe
 *   persisted entities as returned by the API.
 */

// ---------------------------------------------------------------------------
// Primitive / shared helpers
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid();
/** ISO-8601 datetime string (e.g. "2026-06-15T08:00:00.000Z"). */
export const isoDateTimeSchema = z.string().datetime({ offset: true });
/** Calendar date string "YYYY-MM-DD" (tasks.due_date). */
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

export const emailSchema = z.string().trim().email('邮箱格式不正确').max(254);
export const displayNameSchema = z.string().trim().min(1, '昵称不能为空').max(80);
/** Hex color for avatar background, e.g. "#3b82f6". */
export const avatarColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色应为 #RRGGBB 格式');
/** Project short key — used in URLs/labels, uppercase-ish slug. */
export const projectKeySchema = z
  .string()
  .trim()
  .min(2, '项目标识至少 2 位')
  .max(10, '项目标识最多 10 位')
  .regex(/^[A-Z0-9]+$/, '项目标识只能包含大写字母和数字');

/** Track short key — a lowercase slug identifying a 赛道 (P0 §2). */
export const trackKeySchema = z
  .string()
  .trim()
  .min(2, '赛道标识至少 2 位')
  .max(20, '赛道标识最多 20 位')
  .regex(/^[a-z0-9-]+$/, '赛道标识只能包含小写字母、数字和连字符');
/** Track display name. */
export const trackNameSchema = z.string().trim().min(1, '赛道名称不能为空').max(60);
/** Free-text weekly goal / minimum-KPI blurb for a track (§3 赛道层). */
export const trackWeeklyGoalSchema = z.string().trim().max(2000);

/** Hex color for a task label, e.g. "#ef4444". */
export const labelColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色应为 #RRGGBB 格式');
/** Label display name (the shared catalog is keyed on a unique name). */
export const labelNameSchema = z.string().trim().min(1, '标签名称不能为空').max(30);

// ---------------------------------------------------------------------------
// Entities (§5) — shapes as returned by the API
// ---------------------------------------------------------------------------

/** Public-safe user (never includes password_hash). */
export const userSchema = z.object({
  id: uuidSchema,
  email: emailSchema,
  displayName: displayNameSchema,
  avatarColor: avatarColorSchema,
  role: userRoleSchema,
  isActive: z.boolean(),
  /** Whether the user has uploaded a profile picture (fetch via /users/:id/avatar). */
  hasAvatar: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type User = z.infer<typeof userSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  userId: uuidSchema,
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
});
export type Session = z.infer<typeof sessionSchema>;

export const projectSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  key: projectKeySchema,
  description: z.string().nullable(),
  archived: z.boolean(),
  /** Owning 赛道 (P0 §2). Null = not yet grouped under a track (未归类). */
  trackId: uuidSchema.nullable(),
  createdBy: uuidSchema,
  createdAt: isoDateTimeSchema,
});
export type Project = z.infer<typeof projectSchema>;

export const projectMemberSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema,
  userId: uuidSchema,
  role: projectRoleSchema,
  createdAt: isoDateTimeSchema,
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;

/** Project member joined with its user (returned by GET /projects/:id/members). */
export const projectMemberWithUserSchema = projectMemberSchema.extend({
  user: userSchema,
});
export type ProjectMemberWithUser = z.infer<typeof projectMemberWithUserSchema>;

/**
 * A user's display summary embedded in other entities (claimant, idea author,
 * announcement author, task reviewer). Carries only the public display fields, not
 * the full user row. Defined before `taskSchema` so the task's `reviewer` can use it.
 */
export const userSummarySchema = z.object({
  id: uuidSchema,
  displayName: displayNameSchema,
  avatarColor: avatarColorSchema,
  /** Whether the user has an uploaded avatar (fetch via /users/:id/avatar). */
  hasAvatar: z.boolean(),
});
export type UserSummary = z.infer<typeof userSummarySchema>;

/**
 * A claimant of a task as embedded in the task wire shape (lifecycle v2 §2/§3):
 * the user's display summary plus their points share. `points` is null until the
 * task is delivered (and is reset to null again on a reject). This is a display
 * summary; the full user row is not carried.
 */
export const taskClaimantSchema = z.object({
  userId: uuidSchema,
  displayName: displayNameSchema,
  avatarColor: avatarColorSchema,
  /** Whether the claimant has an uploaded avatar (fetch via /users/:id/avatar). */
  hasAvatar: z.boolean(),
  /** Per-claimant points share; null until delivered / after a reject. */
  points: z.number().int().nullable(),
  claimedAt: isoDateTimeSchema,
});
export type TaskClaimant = z.infer<typeof taskClaimantSchema>;

/**
 * A custom task label (task-labels feature). A GLOBAL catalog entry — one shared set
 * of `{ name, color }` labels across every project/task, many-to-many with tasks.
 * `color` is a #RRGGBB hex; the front-end derives readable foreground text from it.
 */
export const labelSchema = z.object({
  id: uuidSchema,
  name: labelNameSchema,
  color: labelColorSchema,
});
export type Label = z.infer<typeof labelSchema>;

/**
 * Task wire shape (lifecycle v2 §2/§3; no-project tasks §8). The single
 * `assigneeId`/`completedBy` fields are gone — the set of workers is carried in
 * `claimants`. `deliveredAt`/`deliveredBy` are set on deliver and cleared on reject;
 * `reviewedBy` is the last reviewer; `completedAt` is set when a review approves the
 * task.
 *
 * `projectId` is nullable (§8): a NULL means a "no-project" / task-pool task,
 * visible to every logged-in user. `projectName`/`projectKey` carry lightweight
 * owning-project context for the all-projects view; both are null for pool tasks.
 */
export const taskSchema = z.object({
  id: uuidSchema,
  projectId: uuidSchema.nullable(),
  /** Owning project's display name; null for no-project (pool) tasks (§8). */
  projectName: z.string().nullable(),
  /** Owning project's short key; null for no-project (pool) tasks (§8). */
  projectKey: projectKeySchema.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  points: z.number().int().nonnegative().nullable(),
  priority: prioritySchema,
  /**
   * Task type A/B/C/D (运营需求 §4.1); null = 未分类. Orthogonal to `priority` —
   * governs responsibility/claim model (see taskTypes enum). Rendered as a prominent
   * badge on the card.
   */
  taskType: taskTypeSchema.nullable(),
  /** 提交物要求 (P2 §1, 运营需求 §5.1): what to hand in. Null = unspecified. */
  deliverableSpec: z.string().nullable(),
  /** 验收标准 (P2 §1, 运营需求 §5.1): what counts as done/qualified. */
  acceptanceCriteria: z.string().nullable(),
  /** 交付质量 A/B/C/D snapshot from the latest review (P2 §2); null = ungraded. */
  qualityGrade: qualityGradeSchema.nullable(),
  /**
   * 两级复核 (P2 §3): true when this delivery requires a final admin (总运营)
   * review after the first approve — set at deliver time for A类 or points ≥ 8.
   */
  needsFinalReview: z.boolean(),
  /** The 初审 approver; null until first-approved (or after reject/revoke). */
  firstApprovedBy: uuidSchema.nullable(),
  /** 初审人 summary resolved from `firstApprovedBy`. */
  firstApprover: userSummarySchema.nullable(),
  firstApprovedAt: isoDateTimeSchema.nullable(),
  /**
   * Claim-count limits (claim-limits feature). `minClaimants` (>= 1) is the lower
   * bound: while the claimant count is below it the task stays in 待认领 (open) and
   * is flagged 未达下限; reaching it advances the task to 进行中. `maxClaimants`
   * (null = unlimited) caps how many users may claim.
   */
  minClaimants: z.number().int(),
  maxClaimants: z.number().int().nullable(),
  dueDate: dateOnlySchema.nullable(),
  createdBy: uuidSchema,
  /** The publisher (发布者) summary resolved from `createdBy`; null if the user is gone. */
  creator: userSummarySchema.nullable(),
  rank: z.string(),
  completedAt: isoDateTimeSchema.nullable(),
  deliveredAt: isoDateTimeSchema.nullable(),
  deliveredBy: uuidSchema.nullable(),
  /** The deliverer (交付人) summary resolved from `deliveredBy`; null until delivered. */
  deliverer: userSummarySchema.nullable(),
  reviewedBy: uuidSchema.nullable(),
  /**
   * The reviewer (审阅人) summary resolved from `reviewedBy` — who last approved or
   * rejected this task; null until it has been reviewed (or after a 撤销通过 returns
   * it to 待审阅). Lets the UI note the review result's reviewer without a lookup.
   */
  reviewer: userSummarySchema.nullable(),
  /** The set of users who have claimed this task, with their points shares. */
  claimants: z.array(taskClaimantSchema),
  /** The task's labels from the global catalog (task-labels feature). */
  labels: z.array(labelSchema),
  createdAt: isoDateTimeSchema,
});
export type Task = z.infer<typeof taskSchema>;

/**
 * A file attached to an idea (§7.1) or a comment — same in-DB recipe as task
 * files (bytea, ≤5MB, enforced server-side). Metadata only: the raw bytes NEVER
 * cross the wire in this shape; they stream separately via
 * GET /{ideas|comments}/:id/files/:fileId.
 */
export const attachmentSchema = z.object({
  id: uuidSchema,
  filename: z.string(),
  mime: z.string(),
  /** Stored byte size of the file (≤ 5MB). */
  sizeBytes: z.number().int().nonnegative(),
  uploaderId: uuidSchema,
  createdAt: isoDateTimeSchema,
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** POST /{ideas|comments}/:id/files — upload response (the created file). */
export const attachmentsResponseSchema = z.object({
  files: z.array(attachmentSchema),
});
export type AttachmentsResponse = z.infer<typeof attachmentsResponseSchema>;

export const commentSchema = z.object({
  id: uuidSchema,
  taskId: uuidSchema,
  authorId: uuidSchema,
  body: z.string(),
  mentions: z.array(uuidSchema),
  createdAt: isoDateTimeSchema,
  editedAt: isoDateTimeSchema.nullable(),
});
export type Comment = z.infer<typeof commentSchema>;

/** Comment joined with its author (returned by GET /tasks/:id/comments). */
export const commentWithAuthorSchema = commentSchema.extend({
  author: userSchema,
  /** The comment's file attachments (metadata only), oldest first. */
  files: z.array(attachmentSchema),
});
export type CommentWithAuthor = z.infer<typeof commentWithAuthorSchema>;

/** Activity meta is free-form jsonb (e.g. {from, to} for status_changed). */
export const activityMetaSchema = z.record(z.string(), z.unknown());
export type ActivityMeta = z.infer<typeof activityMetaSchema>;

export const activitySchema = z.object({
  id: uuidSchema,
  taskId: uuidSchema,
  /** Owning project; null for activities on a no-project (pool) task (§8). */
  projectId: uuidSchema.nullable(),
  actorId: uuidSchema,
  type: activityTypeSchema,
  meta: activityMetaSchema,
  createdAt: isoDateTimeSchema,
});
export type Activity = z.infer<typeof activitySchema>;

/** Activity joined with its actor (returned by GET /tasks/:id/activities). */
export const activityWithActorSchema = activitySchema.extend({
  actor: userSchema,
});
export type ActivityWithActor = z.infer<typeof activityWithActorSchema>;

// ---------------------------------------------------------------------------
// Ideas / inspiration (§7.1)
// ---------------------------------------------------------------------------

/**
 * An idea (§7.1). Either posted against a task (`taskId` set) or STANDALONE in the
 * 灵感区 (`taskId` null — no owning task/project, visible to all logged-in users).
 * `status` starts `pending`; on adoption a lead/admin writes `rewardPoints`
 * (credited to the author's contribution) and `adoptedBy`. The `author` is a
 * display summary; `body` is safe markdown.
 */
export const ideaSchema = z.object({
  id: uuidSchema,
  /** Owning task; null for a STANDALONE 灵感区 idea. */
  taskId: uuidSchema.nullable(),
  author: userSummarySchema,
  body: z.string(),
  status: ideaStatusSchema,
  /** Reward points granted on adoption; null while pending / rejected. */
  rewardPoints: z.number().int().nullable(),
  /** The lead/admin who adopted the idea; null otherwise. */
  adoptedBy: uuidSchema.nullable(),
  /** The reviewer's 驳回理由; null when pending/adopted, or rejected without one. */
  rejectReason: z.string().nullable(),
  /** The idea's file attachments (metadata only), oldest first. */
  files: z.array(attachmentSchema),
  createdAt: isoDateTimeSchema,
});
export type Idea = z.infer<typeof ideaSchema>;

/**
 * An idea enriched with its task title + owning project (§7.1), as returned by the
 * cross-project 灵感区 listing (GET /ideas). For a STANDALONE idea (no task) the
 * `taskTitle`, `projectId` and `projectName` are all null. The per-task listing
 * returns the plain {@link ideaSchema} (task/project are already in context).
 */
export const ideaWithContextSchema = ideaSchema.extend({
  /** Owning task's title; null for a STANDALONE 灵感区 idea. */
  taskTitle: z.string().nullable(),
  /** Owning project id; null for a STANDALONE 灵感区 idea. */
  projectId: uuidSchema.nullable(),
  /** Owning project name; null for a STANDALONE 灵感区 idea. */
  projectName: z.string().nullable(),
});
export type IdeaWithContext = z.infer<typeof ideaWithContextSchema>;

/** POST /tasks/:id/ideas — post an idea on a task (any project member). */
export const createIdeaInputSchema = z.object({
  body: z.string().trim().min(1, '想法不能为空').max(20000),
});
export type CreateIdeaInput = z.infer<typeof createIdeaInputSchema>;

/** POST /ideas — post a STANDALONE idea in the 灵感区 (any logged-in user). */
export const createStandaloneIdeaInputSchema = z.object({
  body: z.string().trim().min(1, '想法不能为空').max(20000),
});
export type CreateStandaloneIdeaInput = z.infer<typeof createStandaloneIdeaInputSchema>;

/** POST /ideas/:id/adopt — adopt an idea + grant reward points (lead/admin). */
export const adoptIdeaInputSchema = z.object({
  rewardPoints: z.number().int().nonnegative().max(100000),
});
export type AdoptIdeaInput = z.infer<typeof adoptIdeaInputSchema>;

/**
 * POST /ideas/:id/reject — reject an idea (lead/admin). The 驳回理由 is optional;
 * an empty/absent reason rejects without one (stored null). Trimmed, capped.
 */
export const rejectIdeaInputSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});
export type RejectIdeaInput = z.infer<typeof rejectIdeaInputSchema>;

/** GET /tasks/:id/ideas — a task's ideas (newest first). */
export const ideasResponseSchema = z.object({
  ideas: z.array(ideaSchema),
});
export type IdeasResponse = z.infer<typeof ideasResponseSchema>;

/** GET /ideas — all ideas across the caller's visible projects, with context. */
export const ideasWithContextResponseSchema = z.object({
  ideas: z.array(ideaWithContextSchema),
});
export type IdeasWithContextResponse = z.infer<typeof ideasWithContextResponseSchema>;

/** GET /ideas?status= — optional status filter for the 灵感区 listing. */
export const ideasQuerySchema = z.object({
  status: ideaStatusSchema.optional(),
});
export type IdeasQuery = z.infer<typeof ideasQuerySchema>;

/** POST /ideas/:id/adopt | /reject — single-idea response wrapper. */
export const ideaResponseSchema = z.object({
  idea: ideaSchema,
});
export type IdeaResponse = z.infer<typeof ideaResponseSchema>;

// ---------------------------------------------------------------------------
// Announcements / 信息 (admin-published notices)
// ---------------------------------------------------------------------------

/**
 * An announcement / notice published on the 信息 page. Authored by a global admin;
 * readable by every logged-in user. `body` is Markdown (rendered safely, like task
 * descriptions / comments). `updatedAt` differs from `createdAt` after an edit.
 */
export const announcementSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  body: z.string(),
  author: userSummarySchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Announcement = z.infer<typeof announcementSchema>;

/** POST /announcements — publish a notice (global admin). */
export const createAnnouncementInputSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(200),
  body: z.string().trim().min(1, '内容不能为空').max(20000),
});
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementInputSchema>;

/** PATCH /announcements/:id — edit a notice (global admin). At least one field. */
export const updateAnnouncementInputSchema = z
  .object({
    title: z.string().trim().min(1, '标题不能为空').max(200).optional(),
    body: z.string().trim().min(1, '内容不能为空').max(20000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少修改一个字段' });
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementInputSchema>;

/** GET /announcements — all notices, newest first. */
export const announcementsResponseSchema = z.object({
  announcements: z.array(announcementSchema),
});
export type AnnouncementsResponse = z.infer<typeof announcementsResponseSchema>;

/** POST/PATCH /announcements — single-announcement response wrapper. */
export const announcementResponseSchema = z.object({
  announcement: announcementSchema,
});
export type AnnouncementResponse = z.infer<typeof announcementResponseSchema>;

// ---------------------------------------------------------------------------
// Org tree / 团队架构 (division-of-labor & positions page)
//
// A flexible, editable org tree. Each node is an org unit (部门/小组) that can nest
// to any depth and carry one 负责人 (lead) plus 成员 (members). A tree is
// scoped either to the whole team (`scope: 'all'`, project_id NULL) or to a single
// project (`scope: <projectId>`). Writes are gated to a global admin (whole-team
// tree) or the project's lead / a global admin (project tree).
// ---------------------------------------------------------------------------

/** Node title — a short unit/position name. */
export const orgTitleSchema = z.string().trim().min(1, '名称不能为空').max(80);
/** Optional node description / responsibilities blurb. */
export const orgDescriptionSchema = z.string().trim().max(500);

/**
 * The tree a request targets: the literal `'all'` (whole-team tree) or a project's
 * uuid. Carried in the GET query and the create-node body; mutations on an existing
 * node derive it from the node's own `projectId`.
 */
export const orgScopeSchema = z.union([z.literal('all'), uuidSchema]);
export type OrgScope = z.infer<typeof orgScopeSchema>;

/** A person on a node — their public display summary plus their role on the node. */
export const orgNodeMemberSchema = z.object({
  userId: uuidSchema,
  displayName: displayNameSchema,
  avatarColor: avatarColorSchema,
  hasAvatar: z.boolean(),
  role: orgMemberRoleSchema,
});
export type OrgNodeMember = z.infer<typeof orgNodeMemberSchema>;

/**
 * One org-tree node (flat wire shape; the client assembles the tree by `parentId`).
 * `projectId` is null for the whole-team tree. `leads`/`members` split the node's
 * people by role, each ordered by their display rank.
 */
/** 岗位名额 (P1): 1..999, or null = 不限名额. */
export const headcountSchema = z.number().int().min(1, '名额至少为 1').max(999, '名额最多为 999');

export const orgNodeSchema = z.object({
  id: uuidSchema,
  /** Owning project; null = the whole-team (全团队) tree. */
  projectId: uuidSchema.nullable(),
  /** Parent node; null = a root node. */
  parentId: uuidSchema.nullable(),
  /** Operational Track bound to a `track` root node; null for every other kind. */
  trackId: uuidSchema.nullable(),
  kind: orgNodeKindSchema,
  title: z.string(),
  description: z.string().nullable(),
  /** 岗位名额 (P1); null = 不限. Business-meaningful only for kind='position'. */
  headcount: z.number().int().nullable(),
  /** Lexicographic ordering key among siblings. */
  rank: z.string(),
  leads: z.array(orgNodeMemberSchema),
  members: z.array(orgNodeMemberSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type OrgNode = z.infer<typeof orgNodeSchema>;

/** GET /org/tree?scope= — the whole tree for a scope (flat; client builds it). */
export const orgTreeResponseSchema = z.object({
  scope: orgScopeSchema,
  nodes: z.array(orgNodeSchema),
});
export type OrgTreeResponse = z.infer<typeof orgTreeResponseSchema>;

/** POST/PATCH/move /org/nodes — single-node response wrapper. */
export const orgNodeResponseSchema = z.object({
  node: orgNodeSchema,
});
export type OrgNodeResponse = z.infer<typeof orgNodeResponseSchema>;

/** GET /org/tree query. Defaults to the whole-team tree when omitted. */
export const orgTreeQuerySchema = z.object({
  scope: orgScopeSchema.default('all'),
});
export type OrgTreeQuery = z.infer<typeof orgTreeQuerySchema>;

/**
 * POST /org/nodes — create a node. `parentId` null/omitted creates a root node in
 * the given `scope`; a non-null `parentId` must belong to the same scope (the server
 * re-checks). The new node is appended after its parent's last child.
 */
export const createOrgNodeInputSchema = z.object({
  scope: orgScopeSchema,
  parentId: uuidSchema.nullable().optional(),
  kind: orgNodeKindSchema,
  title: orgTitleSchema,
  description: orgDescriptionSchema.nullable().optional(),
  /** 岗位名额 (P1); omit/null = 不限. */
  headcount: headcountSchema.nullable().optional(),
});
export type CreateOrgNodeInput = z.infer<typeof createOrgNodeInputSchema>;

/** PATCH /org/nodes/:id — edit a node's title / kind / description / headcount. */
export const updateOrgNodeInputSchema = z
  .object({
    title: orgTitleSchema.optional(),
    kind: orgNodeKindSchema.optional(),
    description: orgDescriptionSchema.nullable().optional(),
    /** 岗位名额 (P1); null clears it (不限). */
    headcount: headcountSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少修改一个字段' });
export type UpdateOrgNodeInput = z.infer<typeof updateOrgNodeInputSchema>;

// ---------------------------------------------------------------------------
// 岗位申报 / org applications (P1) — BOSS直聘-style position applications.
//
// A member applies to a `position` node; an approver (global admin, the project's
// lead for a project tree, or a lead on the node or any ancestor for the
// whole-team tree) approves — writing the org_node_members row — or rejects.
// ---------------------------------------------------------------------------

/** One 申报 as returned by the API, with applicant + node display context. */
export const orgApplicationSchema = z.object({
  id: uuidSchema,
  nodeId: uuidSchema,
  /** The position node's title (display context). */
  nodeTitle: z.string(),
  /** The position's owning tree: null = whole-team, else the project id. */
  projectId: uuidSchema.nullable(),
  applicant: userSummarySchema,
  /** 申报理由; empty string when the applicant left it blank. */
  note: z.string(),
  status: applicationStatusSchema,
  /** The deciding lead/admin; null while pending / after a withdraw. */
  decidedBy: uuidSchema.nullable(),
  /** 录用/驳回备注; null while pending. */
  decisionNote: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  decidedAt: isoDateTimeSchema.nullable(),
});
export type OrgApplication = z.infer<typeof orgApplicationSchema>;

/** POST /org/nodes/:id/applications — apply to a position (any member). */
export const createOrgApplicationInputSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});
export type CreateOrgApplicationInput = z.infer<typeof createOrgApplicationInputSchema>;

/** POST /org/applications/:id/approve | /reject — decide (approver). */
export const decideOrgApplicationInputSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});
export type DecideOrgApplicationInput = z.infer<typeof decideOrgApplicationInputSchema>;

/**
 * GET /org/applications?scope= — the caller's own applications (any status) plus,
 * when they are an approver somewhere in the scope, every pending application on
 * the nodes they may decide. `canDecideNodeIds` tells the client which nodes'
 * pending applications to surface with approve/reject controls.
 */
export const orgApplicationsResponseSchema = z.object({
  applications: z.array(orgApplicationSchema),
  canDecideNodeIds: z.array(uuidSchema),
});
export type OrgApplicationsResponse = z.infer<typeof orgApplicationsResponseSchema>;

/** POST apply/decide — single-application response wrapper. */
export const orgApplicationResponseSchema = z.object({
  application: orgApplicationSchema,
});
export type OrgApplicationResponse = z.infer<typeof orgApplicationResponseSchema>;

/**
 * POST /org/nodes/:id/move — reparent and/or reorder a node. `parentId` is the new
 * parent (null = a root). `beforeId` is the sibling to insert immediately before;
 * omit/null to append to the end of the new parent's children. The target parent
 * must be in the same scope and must not be the node itself or a descendant of it.
 */
export const moveOrgNodeInputSchema = z.object({
  parentId: uuidSchema.nullable(),
  beforeId: uuidSchema.nullable().optional(),
});
export type MoveOrgNodeInput = z.infer<typeof moveOrgNodeInputSchema>;

/**
 * PUT /org/nodes/:id/members — replace the node's people. `leads` and `members` are
 * user-id sets (disjoint); the node's membership becomes exactly these.
 */
export const setOrgMembersInputSchema = z
  .object({
    // Ordinary org nodes are service-limited to one lead; a Track node maps this
    // field to Track managers and may therefore carry multiple managers.
    leads: z.array(uuidSchema).max(20),
    members: z.array(uuidSchema).max(50),
  })
  .refine((v) => new Set([...v.leads, ...v.members]).size === v.leads.length + v.members.length, {
    message: '同一个人不能同时是负责人和成员',
  });
export type SetOrgMembersInput = z.infer<typeof setOrgMembersInputSchema>;

// ---------------------------------------------------------------------------
// Task files / attachments (§7.2)
// ---------------------------------------------------------------------------

/**
 * A file attached to a task (§7.2), used to deliver file content. Metadata only —
 * the raw bytes NEVER cross the wire in this shape; they are streamed separately by
 * GET /tasks/:id/files/:fileId. Single-file uploads are capped at 5MB server-side.
 */
export const taskFileSchema = z.object({
  id: uuidSchema,
  taskId: uuidSchema,
  filename: z.string(),
  mime: z.string(),
  /** Stored byte size of the file (≤ 5MB). */
  sizeBytes: z.number().int().nonnegative(),
  uploaderId: uuidSchema,
  /** The uploader (上传者) summary resolved from `uploaderId`. */
  uploader: userSummarySchema,
  createdAt: isoDateTimeSchema,
});
export type TaskFile = z.infer<typeof taskFileSchema>;

/**
 * A text deliverable attached to a task (交付内容 §7.2). Like an attachment but a
 * Markdown text body instead of a file; multiple per task, each carrying its author.
 * Used to deliver written content (notes, links, summaries).
 */
export const taskTextSchema = z.object({
  id: uuidSchema,
  taskId: uuidSchema,
  author: userSummarySchema,
  content: z.string(),
  createdAt: isoDateTimeSchema,
});
export type TaskText = z.infer<typeof taskTextSchema>;

/** POST /tasks/:id/texts — submit a text deliverable. */
export const createTaskTextInputSchema = z.object({
  content: z.string().trim().min(1, '交付内容不能为空').max(20000),
});
export type CreateTaskTextInput = z.infer<typeof createTaskTextInputSchema>;

/** GET /tasks/:id/texts (and the POST response) — a task's text deliverables. */
export const taskTextsResponseSchema = z.object({
  texts: z.array(taskTextSchema),
});
export type TaskTextsResponse = z.infer<typeof taskTextsResponseSchema>;

/** GET /tasks/:id/files (and the POST upload response) — a task's attachments. */
export const taskFilesResponseSchema = z.object({
  files: z.array(taskFileSchema),
});
export type TaskFilesResponse = z.infer<typeof taskFilesResponseSchema>;

// ---------------------------------------------------------------------------
// 资产库 / assets (P3 §1, 运营需求 §9) — 内容库/反馈库/资源库/问题清单.
//
// The durable output of the weekly retrospective loop. Created standalone on the
// 资产 page or distilled from a done task (「沉淀为资产」). Any member creates;
// the author edits their own; lead-tier (admin / 赛道经理) edits/deletes all.
// ---------------------------------------------------------------------------

export const assetTitleSchema = z.string().trim().min(1, '标题不能为空').max(200);

/** One asset as returned by the API, with track/task display context resolved. */
export const assetSchema = z.object({
  id: uuidSchema,
  kind: assetKindSchema,
  title: assetTitleSchema,
  /** Markdown body: 原话/记录/复用结构/联系方式等. Empty string when link-only. */
  body: z.string(),
  /** Optional external link (发布链接/文档链接). */
  url: z.string().nullable(),
  /** Owning 赛道; null = 通用/未归类. */
  trackId: uuidSchema.nullable(),
  /** Owning track's display name; null when trackId is null. */
  trackName: z.string().nullable(),
  /** Source task (溯源); null for standalone assets. */
  taskId: uuidSchema.nullable(),
  /** Source task's title; null when taskId is null (or the task was deleted). */
  taskTitle: z.string().nullable(),
  creator: userSummarySchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Asset = z.infer<typeof assetSchema>;

/** POST /assets — create (any member). Body or url: at least one required. */
export const createAssetInputSchema = z
  .object({
    kind: assetKindSchema,
    title: assetTitleSchema,
    body: z.string().max(20000).optional(),
    url: z.string().trim().url('链接格式不正确').max(2000).optional(),
    trackId: uuidSchema.nullable().optional(),
    taskId: uuidSchema.nullable().optional(),
  })
  .refine((v) => (v.body && v.body.trim().length > 0) || v.url, {
    message: '正文和链接至少填写一项',
    path: ['body'],
  });
export type CreateAssetInput = z.infer<typeof createAssetInputSchema>;

/** PATCH /assets/:id — author edits own; admin/赛道经理 edit all. */
export const updateAssetInputSchema = z
  .object({
    kind: assetKindSchema.optional(),
    title: assetTitleSchema.optional(),
    body: z.string().max(20000).optional(),
    url: z.string().trim().url('链接格式不正确').max(2000).nullable().optional(),
    trackId: uuidSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少修改一个字段' });
export type UpdateAssetInput = z.infer<typeof updateAssetInputSchema>;

/** GET /assets?kind&trackId — newest first. */
export const assetsQuerySchema = z.object({
  kind: assetKindSchema.optional(),
  trackId: uuidSchema.optional(),
});
export type AssetsQuery = z.infer<typeof assetsQuerySchema>;

export const assetsResponseSchema = z.object({
  assets: z.array(assetSchema),
});
export type AssetsResponse = z.infer<typeof assetsResponseSchema>;

export const assetResponseSchema = z.object({
  asset: assetSchema,
});
export type AssetResponse = z.infer<typeof assetResponseSchema>;

// ---------------------------------------------------------------------------
// Error shape (§7)
// ---------------------------------------------------------------------------

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Field-level validation errors: path -> messages. */
    fields: z.record(z.string(), z.array(z.string())).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// ---------------------------------------------------------------------------
// Auth — Synapsly ID SSO (§7)
// ---------------------------------------------------------------------------

/**
 * GET /auth/config — public, unauthenticated probe telling the login page which
 * sign-in affordances to render. `synapslyEnabled` is true when the server has a
 * Synapsly OIDC client configured; `devLogin` is true only on a non-production
 * instance that opted into the local fake-login escape hatch.
 */
export const authConfigResponseSchema = z.object({
  synapslyEnabled: z.boolean(),
  devLogin: z.boolean(),
});
export type AuthConfigResponse = z.infer<typeof authConfigResponseSchema>;

/**
 * POST /auth/synapsly/complete-join — finish first-time provisioning for a brand
 * new Synapsly user by supplying the admin-preset invite code. The pending
 * identity is carried in a short-lived signed cookie set by the OIDC callback.
 */
export const completeJoinInputSchema = z.object({
  code: z.string().min(1, '请输入邀请码').max(200),
});
export type CompleteJoinInput = z.infer<typeof completeJoinInputSchema>;

/**
 * POST /auth/dev-login — local development fake login (only served when
 * DEV_LOGIN=true and NODE_ENV!=='production'). Bypasses Synapsly and logs in (or
 * creates) the user with the given email so the app stays runnable offline.
 */
export const devLoginInputSchema = z.object({
  email: emailSchema,
  displayName: displayNameSchema.optional(),
});
export type DevLoginInput = z.infer<typeof devLoginInputSchema>;

/** Response for login / me — the authenticated user. */
export const authUserResponseSchema = z.object({
  user: userSchema,
});
export type AuthUserResponse = z.infer<typeof authUserResponseSchema>;

/** PATCH /auth/profile — update the current user's own profile (display name). */
export const updateProfileInputSchema = z.object({
  displayName: displayNameSchema,
});
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;

/**
 * POST /auth/avatar — upload a profile picture. `image` is a data URL such as
 * `data:image/jpeg;base64,<...>`. The server re-validates the mime + decoded
 * byte size; the 2 MB string cap here is a coarse upper bound on the request.
 */
export const updateAvatarInputSchema = z.object({
  image: z.string().min(1).max(2_000_000),
});
export type UpdateAvatarInput = z.infer<typeof updateAvatarInputSchema>;

// ---------------------------------------------------------------------------
// Member self-join gate (admin invite code) — reused for Synapsly SSO (§8)
//
// A brand-new Synapsly user (no matching account) must supply this admin-preset
// invite code on first login to be provisioned as a member. `registrationEnabled`
// toggles whether self-join is open at all; `registrationCode` is the secret.
// ---------------------------------------------------------------------------

/** GET /settings — admin-only join settings (includes the secret invite code). */
export const registrationSettingsSchema = z.object({
  registrationEnabled: z.boolean(),
  registrationCode: z.string().max(200),
});
export type RegistrationSettings = z.infer<typeof registrationSettingsSchema>;

/** PATCH /settings — admin updates either field (both optional). */
export const updateRegistrationSettingsInputSchema = z
  .object({
    registrationEnabled: z.boolean().optional(),
    registrationCode: z.string().max(200).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少修改一个字段',
  });
export type UpdateRegistrationSettingsInput = z.infer<typeof updateRegistrationSettingsInputSchema>;

// ---------------------------------------------------------------------------
// Users (admin) (§7)
// ---------------------------------------------------------------------------

/**
 * A user's membership in a single project, as embedded in the admin user list.
 * Lets the admin console show each account's projects (and flag orphaned users
 * who belong to none, so they can't see any board, §6.3).
 */
export const userProjectMembershipSchema = z.object({
  projectId: uuidSchema,
  projectName: z.string(),
  role: projectRoleSchema,
});
export type UserProjectMembership = z.infer<typeof userProjectMembershipSchema>;

/** User with their project memberships — the admin §7 GET /users row shape. */
export const userWithProjectsSchema = userSchema.extend({
  projects: z.array(userProjectMembershipSchema),
});
export type UserWithProjects = z.infer<typeof userWithProjectsSchema>;

export const usersListResponseSchema = z.object({
  users: z.array(userWithProjectsSchema),
});
export type UsersListResponse = z.infer<typeof usersListResponseSchema>;

/**
 * POST /users — admin pre-provisions an account by email. There is no password:
 * the person signs in with their Synapsly ID, which links to this row by email on
 * first login. Lets admins add people to projects before they ever log in.
 */
export const createUserInputSchema = z.object({
  email: emailSchema,
  displayName: displayNameSchema,
  role: userRoleSchema.default('member'),
  avatarColor: avatarColorSchema.optional(),
});
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

/** PATCH /users/:id — admin edits name/role/active state. */
export const updateUserInputSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    role: userRoleSchema.optional(),
    isActive: z.boolean().optional(),
    avatarColor: avatarColorSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少修改一个字段',
  });
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

// ---------------------------------------------------------------------------
// Projects (§7)
// ---------------------------------------------------------------------------

export const projectsListResponseSchema = z.object({
  projects: z.array(projectSchema),
});
export type ProjectsListResponse = z.infer<typeof projectsListResponseSchema>;

/**
 * A project as shown in the self-service directory (GET /projects/directory):
 * the project plus whether the current user is already a member and how many
 * members it has. Any logged-in user can browse the directory and join/leave.
 */
export const projectDirectoryItemSchema = projectSchema.extend({
  isMember: z.boolean(),
  memberCount: z.number().int().nonnegative(),
});
export type ProjectDirectoryItem = z.infer<typeof projectDirectoryItemSchema>;

export const projectDirectoryResponseSchema = z.object({
  projects: z.array(projectDirectoryItemSchema),
});
export type ProjectDirectoryResponse = z.infer<typeof projectDirectoryResponseSchema>;

/** POST /projects (admin). */
export const createProjectInputSchema = z.object({
  name: z.string().trim().min(1, '项目名称不能为空').max(120),
  key: projectKeySchema,
  description: z.string().max(2000).optional(),
  /** Optionally group the new project under a 赛道 (P0 §2). */
  trackId: uuidSchema.nullable().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

/** PATCH /projects/:id. */
export const updateProjectInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    archived: z.boolean().optional(),
    /** Reassign the project's owning 赛道; null clears it (未归类). */
    trackId: uuidSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少修改一个字段',
  });
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

export const projectMembersResponseSchema = z.object({
  members: z.array(projectMemberWithUserSchema),
});
export type ProjectMembersResponse = z.infer<typeof projectMembersResponseSchema>;

/** POST /projects/:id/members. */
export const addProjectMemberInputSchema = z.object({
  userId: uuidSchema,
  role: projectRoleSchema.default('member'),
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberInputSchema>;

// ---------------------------------------------------------------------------
// Tracks / 赛道 (P0 §2) — the top operational grouping above projects.
//
// A 赛道 groups projects(小组) and carries 赛道运营经理(manager) + members. The
// manager is lead-equivalent over every project in the track (see guards §3). Track
// CRUD + manager assignment is global-admin only; the listing is readable by all.
// ---------------------------------------------------------------------------

/** A person on a track — public display summary plus their track role. */
export const trackMemberSchema = z.object({
  userId: uuidSchema,
  displayName: displayNameSchema,
  avatarColor: avatarColorSchema,
  hasAvatar: z.boolean(),
  role: trackMemberRoleSchema,
});
export type TrackMember = z.infer<typeof trackMemberSchema>;

/**
 * A 赛道 as returned by GET /tracks — the track plus its people (split into
 * `managers`/`members` by role) and how many projects it owns. `weeklyGoal` is the
 * free-text 本周目标/最低KPI blurb.
 */
export const trackSchema = z.object({
  id: uuidSchema,
  name: trackNameSchema,
  key: trackKeySchema,
  description: z.string().nullable(),
  weeklyGoal: z.string().nullable(),
  archived: z.boolean(),
  rank: z.string(),
  /** Track managers (赛道运营经理), ordered by display rank. */
  managers: z.array(trackMemberSchema),
  /** Plain track members, ordered by display rank. */
  members: z.array(trackMemberSchema),
  /** How many projects are grouped under this track. */
  projectCount: z.number().int().nonnegative(),
  createdBy: uuidSchema,
  createdAt: isoDateTimeSchema,
});
export type Track = z.infer<typeof trackSchema>;

export const tracksResponseSchema = z.object({
  tracks: z.array(trackSchema),
});
export type TracksResponse = z.infer<typeof tracksResponseSchema>;

/** POST/PATCH /tracks — single-track response wrapper. */
export const trackResponseSchema = z.object({
  track: trackSchema,
});
export type TrackResponse = z.infer<typeof trackResponseSchema>;

/**
 * GET /tracks/:id/member-candidates — active workspace users that an administrator
 * or this track's manager may place on the track. Deliberately exposes only the
 * public display summary (never email, global role, or project memberships).
 */
export const trackMemberCandidatesResponseSchema = z.object({
  users: z.array(userSummarySchema),
});
export type TrackMemberCandidatesResponse = z.infer<typeof trackMemberCandidatesResponseSchema>;

/** POST /tracks — create a 赛道 (global admin; 409 on duplicate key). */
export const createTrackInputSchema = z.object({
  name: trackNameSchema,
  key: trackKeySchema,
  description: z.string().max(2000).optional(),
  weeklyGoal: trackWeeklyGoalSchema.optional(),
});
export type CreateTrackInput = z.infer<typeof createTrackInputSchema>;

/** PATCH /tracks/:id — edit a 赛道 (global admin). At least one field. */
export const updateTrackInputSchema = z
  .object({
    name: trackNameSchema.optional(),
    description: z.string().max(2000).nullable().optional(),
    weeklyGoal: trackWeeklyGoalSchema.nullable().optional(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少修改一个字段' });
export type UpdateTrackInput = z.infer<typeof updateTrackInputSchema>;

/**
 * PUT /tracks/:id/members — replace the track's people (global admin or one of the
 * track's current managers). `managers` and `members` are disjoint user-id sets;
 * the track's membership becomes exactly these. Managers gain lead-equivalent
 * authority over the track's projects.
 */
export const setTrackMembersInputSchema = z
  .object({
    managers: z.array(uuidSchema).max(20),
    members: z.array(uuidSchema).max(200),
  })
  .refine(
    (v) => new Set([...v.managers, ...v.members]).size === v.managers.length + v.members.length,
    { message: '同一个人不能同时是赛道经理和成员' },
  );
export type SetTrackMembersInput = z.infer<typeof setTrackMembersInputSchema>;

/** PATCH /projects/:id — assign/clear the project's owning 赛道 (lead/admin). */
export const setProjectTrackInputSchema = z.object({
  trackId: uuidSchema.nullable(),
});
export type SetProjectTrackInput = z.infer<typeof setProjectTrackInputSchema>;

// ---------------------------------------------------------------------------
// Labels (task-labels feature) — a GLOBAL custom-label catalog
// ---------------------------------------------------------------------------

/** GET /labels — the whole shared label catalog. */
export const labelsResponseSchema = z.object({
  labels: z.array(labelSchema),
});
export type LabelsResponse = z.infer<typeof labelsResponseSchema>;

/** POST | PATCH /labels — single-label response wrapper. */
export const labelResponseSchema = z.object({
  label: labelSchema,
});
export type LabelResponse = z.infer<typeof labelResponseSchema>;

/** POST /labels — create a catalog label (any logged-in user; 409 on dup name). */
export const createLabelInputSchema = z.object({
  name: labelNameSchema,
  color: labelColorSchema,
});
export type CreateLabelInput = z.infer<typeof createLabelInputSchema>;

/** PATCH /labels/:id — rename / recolor a label (global admin only). */
export const updateLabelInputSchema = z
  .object({
    name: labelNameSchema.optional(),
    color: labelColorSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少修改一个字段',
  });
export type UpdateLabelInput = z.infer<typeof updateLabelInputSchema>;

/** Optional label-id set carried on task create/patch — a REPLACE set on patch. */
export const labelIdsSchema = z.array(uuidSchema).max(20);

// ---------------------------------------------------------------------------
// Tasks (§7)
// ---------------------------------------------------------------------------

/** Board payload: tasks grouped by column. */
export const boardResponseSchema = z.object({
  tasks: z.array(taskSchema),
});
export type BoardResponse = z.infer<typeof boardResponseSchema>;

export const taskResponseSchema = z.object({
  task: taskSchema,
});
export type TaskResponse = z.infer<typeof taskResponseSchema>;

/**
 * POST /tasks (unified create) and POST /projects/:id/tasks. When `projectId` is
 * supplied the task is created in that project (caller must be a member); when it is
 * absent the task is a no-project / task-pool task (§8). The legacy per-project route
 * ignores the body `projectId` and uses its path param.
 */
/**
 * Claim-count bounds (claim-limits feature). A task needs at least `minClaimants`
 * claimants to enter 进行中; below it the task stays in 待领取 (未达下限).
 * `maxClaimants` caps how many users may claim (null = unlimited). Both are bounded
 * to a sane range so the UI/DB never see absurd values.
 */
export const MIN_CLAIMANTS_FLOOR = 1;
export const MAX_CLAIMANTS_CAP = 50;
export const claimantBoundSchema = z
  .number()
  .int()
  .min(MIN_CLAIMANTS_FLOOR, `不能小于 ${MIN_CLAIMANTS_FLOOR}`)
  .max(MAX_CLAIMANTS_CAP, `不能大于 ${MAX_CLAIMANTS_CAP}`);

export const createTaskInputSchema = z
  .object({
    title: z.string().trim().min(1, '标题不能为空').max(200),
    description: z.string().max(20000).optional(),
    /** 提交物要求 (P2 §1). */
    deliverableSpec: z.string().max(20000).optional(),
    /** 验收标准 (P2 §1). */
    acceptanceCriteria: z.string().max(20000).optional(),
    priority: prioritySchema.default('medium'),
    /** Task type A/B/C/D (§4.1); omit/null for 未分类. */
    taskType: taskTypeSchema.nullable().optional(),
    points: z.number().int().nonnegative().max(1000).nullable().optional(),
    /** Lower bound on claimants (>= 1). Defaults to 1 (current behaviour). */
    minClaimants: claimantBoundSchema.default(MIN_CLAIMANTS_FLOOR),
    /** Upper bound on claimants; omit/null to leave the task unlimited. */
    maxClaimants: claimantBoundSchema.nullable().optional(),
    dueDate: dateOnlySchema.nullable().optional(),
    /** Optionally dispatch on creation; moves task to in_progress. */
    assigneeId: uuidSchema.nullable().optional(),
    /** Owning project (§8); omit/null to create a no-project (pool) task. */
    projectId: uuidSchema.nullable().optional(),
    /** Optional label set (task-labels): the task's labels become exactly these. */
    labelIds: labelIdsSchema.optional(),
  })
  .refine(
    (v) => v.maxClaimants == null || v.maxClaimants >= (v.minClaimants ?? MIN_CLAIMANTS_FLOOR),
    {
      message: '领取人数上限不能小于下限',
      path: ['maxClaimants'],
    },
  );
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

/** PATCH /tasks/:id — edit fields / status / rank. */
export const updateTaskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(20000).nullable().optional(),
    /** 提交物要求 (P2 §1); null clears. */
    deliverableSpec: z.string().max(20000).nullable().optional(),
    /** 验收标准 (P2 §1); null clears. */
    acceptanceCriteria: z.string().max(20000).nullable().optional(),
    status: taskStatusSchema.optional(),
    priority: prioritySchema.optional(),
    /** Task type A/B/C/D (§4.1); null clears it (未分类). */
    taskType: taskTypeSchema.nullable().optional(),
    points: z.number().int().nonnegative().max(1000).nullable().optional(),
    /**
     * 改期原因 (P2 §5): when present alongside a dueDate change, the server records
     * a `due_changed` activity carrying {from, to, reason}. Not persisted on the task.
     */
    dueChangeReason: z.string().trim().max(2000).optional(),
    /** Lower bound on claimants (>= 1). */
    minClaimants: claimantBoundSchema.optional(),
    /** Upper bound on claimants; null clears it (unlimited). */
    maxClaimants: claimantBoundSchema.nullable().optional(),
    dueDate: dateOnlySchema.nullable().optional(),
    /** Lexicographic rank key for intra-column ordering. */
    rank: z.string().min(1).optional(),
    /**
     * Optional label set (task-labels). When present this is a REPLACE set: the
     * task's labels become exactly these ids (an empty array clears them).
     */
    labelIds: labelIdsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '至少修改一个字段',
  })
  .refine(
    (v) => !(v.minClaimants != null && v.maxClaimants != null) || v.maxClaimants >= v.minClaimants,
    { message: '领取人数上限不能小于下限', path: ['maxClaimants'] },
  );
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

/** POST /tasks/:id/assign — lead/admin dispatch (adds the user to claimants). */
export const assignTaskInputSchema = z.object({
  assigneeId: uuidSchema,
});
export type AssignTaskInput = z.infer<typeof assignTaskInputSchema>;

// /tasks/:id/claim takes no body.

/**
 * POST /tasks/:id/release — optional body (lifecycle v2 §3). Self-release omits the
 * body; a lead/admin may remove another claimant by passing their `userId`.
 */
export const releaseTaskInputSchema = z.object({
  userId: uuidSchema.optional(),
});
export type ReleaseTaskInput = z.infer<typeof releaseTaskInputSchema>;

/**
 * One claimant's points share within a deliver request (lifecycle v2 §3). Points
 * are non-negative integers; the allocations must cover exactly the current set of
 * claimants and their sum must equal the task points (or `totalPoints`).
 */
export const deliverAllocationSchema = z.object({
  userId: uuidSchema,
  points: z.number().int().nonnegative().max(100000),
});
export type DeliverAllocation = z.infer<typeof deliverAllocationSchema>;

/**
 * POST /tasks/:id/deliver — a claimant (or lead/admin) submits the points split
 * for review (lifecycle v2 §3). `allocations` must cover every current claimant.
 * When the task has no points yet, `totalPoints` supplies the total to split and is
 * written back onto the task. The server re-validates that the sum matches.
 */
export const deliverTaskInputSchema = z.object({
  allocations: z.array(deliverAllocationSchema).min(1, '至少需要一个认领者的分配'),
  /** Required only when the task has no points; the total to split + persist. */
  totalPoints: z.number().int().nonnegative().max(100000).optional(),
});
export type DeliverTaskInput = z.infer<typeof deliverTaskInputSchema>;

/** Review decision (lifecycle v2 §3; value list shared with the pg enum). */
export const reviewDecisionSchema = z.enum(reviewDecisions);
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

/**
 * 复核触发阈值 (P2 §3): a delivery needs a final admin review when the task is
 * A类(critical) OR its total points ≥ this. Single source for server + UI copy.
 */
export const FINAL_REVIEW_POINTS_THRESHOLD = 8;

/**
 * POST /tasks/:id/review — approve or reject a `pending_review` task (lifecycle v2
 * §3; P2 §2/§3 structured review + two-stage chain).
 * - reject → in_progress, shares cleared, first-approval cleared.
 * - approve (task NOT needing final review) → done.
 * - approve 初审 (needsFinalReview) → stays pending_review, first_approved_* set;
 *   a global admin's approve then completes it (stage=final).
 * `qualityGrade` (交付质量 A/B/C/D) may be set by either stage; the latest wins on
 * the task snapshot. `comment` is recorded on the review row (and activity).
 */
export const reviewTaskInputSchema = z.object({
  decision: reviewDecisionSchema,
  qualityGrade: qualityGradeSchema.optional(),
  comment: z.string().trim().max(2000).optional(),
});
export type ReviewTaskInput = z.infer<typeof reviewTaskInputSchema>;

/**
 * One structured review record (P2 §2) — first-class history, newest first via
 * GET /tasks/:id/reviews. `stage` distinguishes 初审 from 复核.
 */
export const taskReviewSchema = z.object({
  id: uuidSchema,
  taskId: uuidSchema,
  reviewer: userSummarySchema,
  stage: reviewStageSchema,
  decision: reviewDecisionSchema,
  qualityGrade: qualityGradeSchema.nullable(),
  comment: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type TaskReview = z.infer<typeof taskReviewSchema>;

export const taskReviewsResponseSchema = z.object({
  reviews: z.array(taskReviewSchema),
});
export type TaskReviewsResponse = z.infer<typeof taskReviewsResponseSchema>;

/**
 * POST /tasks/:id/transfer (P2 §5 异常流): a lead/赛道经理/admin moves a task from
 * one claimant to another, preserving the responsibility chain in one atomic
 * `transferred` activity {from, to, reason}.
 */
export const transferTaskInputSchema = z.object({
  fromUserId: uuidSchema,
  toUserId: uuidSchema,
  reason: z.string().trim().max(2000).optional(),
});
export type TransferTaskInput = z.infer<typeof transferTaskInputSchema>;

// ---------------------------------------------------------------------------
// Comments & activities (§7)
// ---------------------------------------------------------------------------

export const commentsResponseSchema = z.object({
  comments: z.array(commentWithAuthorSchema),
});
export type CommentsResponse = z.infer<typeof commentsResponseSchema>;

/** POST /tasks/:id/comments. */
export const createCommentInputSchema = z.object({
  body: z.string().trim().min(1, '评论不能为空').max(20000),
  mentions: z.array(uuidSchema).max(50).optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;

/** PATCH /comments/:id. */
export const updateCommentInputSchema = z.object({
  body: z.string().trim().min(1, '评论不能为空').max(20000),
  mentions: z.array(uuidSchema).max(50).optional(),
});
export type UpdateCommentInput = z.infer<typeof updateCommentInputSchema>;

export const activitiesResponseSchema = z.object({
  activities: z.array(activityWithActorSchema),
});
export type ActivitiesResponse = z.infer<typeof activitiesResponseSchema>;

// ---------------------------------------------------------------------------
// Stats (§7 / §6.4)
// ---------------------------------------------------------------------------

export const statsSortSchema = z.enum(['count', 'points']);
export type StatsSort = z.infer<typeof statsSortSchema>;

/** Query for GET /stats/leaderboard. */
export const leaderboardQuerySchema = z.object({
  projectId: uuidSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  sort: statsSortSchema.default('count'),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

export const leaderboardEntrySchema = z.object({
  user: userSchema,
  completedCount: z.number().int().nonnegative(),
  /** Total points = task-share points + adopted-idea reward points (§7.1). */
  pointsSum: z.number().int().nonnegative(),
  /** Breakdown: points from per-claimant shares of done tasks (§4). */
  taskPoints: z.number().int().nonnegative(),
  /** Breakdown: reward points from adopted ideas authored by the user (§7.1). */
  rewardPoints: z.number().int().nonnegative(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardResponseSchema = z.object({
  entries: z.array(leaderboardEntrySchema),
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;

/** Query for GET /stats/me. */
export const myStatsQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type MyStatsQuery = z.infer<typeof myStatsQuerySchema>;

export const myStatsResponseSchema = z.object({
  completedCount: z.number().int().nonnegative(),
  /** Total points = task-share points + adopted-idea reward points (§7.1). */
  pointsSum: z.number().int().nonnegative(),
  /** Breakdown: points from per-claimant shares of done tasks (§4). */
  taskPoints: z.number().int().nonnegative(),
  /** Breakdown: reward points from adopted ideas authored by the user (§7.1). */
  rewardPoints: z.number().int().nonnegative(),
});
export type MyStatsResponse = z.infer<typeof myStatsResponseSchema>;

/** Query for GET /stats/trend. */
export const trendBucketSchema = z.enum(['day', 'week']);
export type TrendBucket = z.infer<typeof trendBucketSchema>;

export const trendQuerySchema = z.object({
  userId: uuidSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  bucket: trendBucketSchema.default('day'),
});
export type TrendQuery = z.infer<typeof trendQuerySchema>;

export const trendPointSchema = z.object({
  /** Bucket start as a date string "YYYY-MM-DD". */
  date: dateOnlySchema,
  completedCount: z.number().int().nonnegative(),
  pointsSum: z.number().int().nonnegative(),
});
export type TrendPoint = z.infer<typeof trendPointSchema>;

export const trendResponseSchema = z.object({
  points: z.array(trendPointSchema),
});
export type TrendResponse = z.infer<typeof trendResponseSchema>;

/**
 * Per-赛道 contribution rollup (P0 §2 stats dimension). One entry per track the
 * caller can see, plus a synthetic `trackId: null` bucket for pool / 未归类 tasks.
 * Aggregates done-task share points (and their counts) by the task's owning
 * project's track.
 */
export const trackStatsEntrySchema = z.object({
  /** Track id; null = the pool / no-track (未归类) bucket. */
  trackId: uuidSchema.nullable(),
  /** Track display name; null for the pool / 未归类 bucket. */
  trackName: z.string().nullable(),
  completedCount: z.number().int().nonnegative(),
  pointsSum: z.number().int().nonnegative(),
});
export type TrackStatsEntry = z.infer<typeof trackStatsEntrySchema>;

export const trackStatsResponseSchema = z.object({
  entries: z.array(trackStatsEntrySchema),
});
export type TrackStatsResponse = z.infer<typeof trackStatsResponseSchema>;

// ---------------------------------------------------------------------------
// Realtime / SSE (§6.5)
// ---------------------------------------------------------------------------

/** Logical entity a realtime event concerns — drives query invalidation. */
export const realtimeEntitySchema = z.enum([
  'task',
  'comment',
  'activity',
  'project',
  'idea',
  'announcement',
  'org',
  'track',
  'asset',
]);
export type RealtimeEntity = z.infer<typeof realtimeEntitySchema>;

/**
 * SSE payload broadcast on any successful write (§6.5). `type` carries the
 * activity/event semantic; `entity` tells the client which queries to invalidate.
 *
 * `projectId` is nullable (§8): a NULL is a no-project (task-pool) event, which the
 * SSE layer broadcasts to every connected user (the global channel). Project events
 * keep per-membership filtering.
 */
export const realtimeEventSchema = z.object({
  type: z.string(),
  projectId: uuidSchema.nullable(),
  entity: realtimeEntitySchema,
  payload: z.record(z.string(), z.unknown()),
});
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

// ---------------------------------------------------------------------------
// Common path-param schemas (reused by route validation)
// ---------------------------------------------------------------------------

export const idParamSchema = z.object({ id: uuidSchema });
export type IdParam = z.infer<typeof idParamSchema>;

export const projectMemberParamsSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
});
export type ProjectMemberParams = z.infer<typeof projectMemberParamsSchema>;
