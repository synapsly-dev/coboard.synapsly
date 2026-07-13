import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  activityTypes,
  applicationStatuses,
  assetKinds,
  ideaStatuses,
  orgMemberRoles,
  orgNodeKinds,
  priorities,
  projectRoles,
  qualityGrades,
  reviewDecisions,
  reviewStages,
  taskStatuses,
  taskTypes,
  trackMemberRoles,
  userRoles,
} from 'shared';

/**
 * Drizzle pg-core schema (§5). Every table has a uuid `id` defaulting to
 * `gen_random_uuid()` and a `created_at`; tables that mutate also carry
 * `updated_at`. Enum value lists are imported from the shared contract so the DB
 * and the wire types never drift.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum('user_role', userRoles);
export const projectRoleEnum = pgEnum('project_role', projectRoles);
export const taskStatusEnum = pgEnum('task_status', taskStatuses);
export const taskTypeEnum = pgEnum('task_type', taskTypes);
export const trackMemberRoleEnum = pgEnum('track_member_role', trackMemberRoles);
export const priorityEnum = pgEnum('priority', priorities);
export const activityTypeEnum = pgEnum('activity_type', activityTypes);
export const ideaStatusEnum = pgEnum('idea_status', ideaStatuses);
export const orgNodeKindEnum = pgEnum('org_node_kind', orgNodeKinds);
export const orgMemberRoleEnum = pgEnum('org_member_role', orgMemberRoles);
export const applicationStatusEnum = pgEnum('application_status', applicationStatuses);
export const qualityGradeEnum = pgEnum('quality_grade', qualityGrades);
export const reviewStageEnum = pgEnum('review_stage', reviewStages);
export const reviewDecisionEnum = pgEnum('review_decision', reviewDecisions);
export const assetKindEnum = pgEnum('asset_kind', assetKinds);

const primaryId = uuid('id')
  .primaryKey()
  .default(sql`gen_random_uuid()`);

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Postgres `bytea` column carrying raw binary data as a Node `Buffer` (§7.2). Used
 * for task-file attachment bytes stored directly in the database (so files are
 * captured in DB backups). Drizzle has no built-in bytea type, so we define one;
 * the driver round-trips a Buffer to/from the bytea on the wire.
 */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

// ---------------------------------------------------------------------------
// users (§5)
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: primaryId,
    email: text('email').notNull(),
    // Nullable: local password auth was replaced by Synapsly ID SSO. Retained so
    // historical rows migrate cleanly; never written going forward.
    passwordHash: text('password_hash'),
    // Stable Synapsly ID subject (OIDC `sub`) — the identity foreign key. Set on
    // first SSO login, unique across users. Null for rows an admin pre-provisioned
    // by email that have not logged in yet.
    synapslySub: text('synapsly_sub'),
    displayName: text('display_name').notNull(),
    avatarColor: text('avatar_color').notNull(),
    // Mime of the uploaded avatar (e.g. 'image/jpeg') when one exists; null
    // otherwise. Kept on the user row (vs the bytes) so list selects can derive
    // `hasAvatar` cheaply without ever fetching the image data.
    avatarMime: text('avatar_mime'),
    role: userRoleEnum('role').notNull().default('member'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt,
  },
  (table) => [
    uniqueIndex('users_email_uniq').on(table.email),
    // Unique when present; Postgres allows many NULLs so un-linked rows coexist.
    uniqueIndex('users_synapsly_sub_uniq').on(table.synapslySub),
    uniqueIndex('users_super_admin_uniq')
      .on(table.role)
      .where(sql`role = 'super_admin'`),
  ],
);

// ---------------------------------------------------------------------------
// user_avatars — uploaded profile-picture bytes, split off the users row so
// user-list queries never pull big base64 blobs (Change 1).
// ---------------------------------------------------------------------------

export const userAvatars = pgTable('user_avatars', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Base64-encoded image bytes (no `data:` prefix).
  data: text('data').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// sessions (§5)
// ---------------------------------------------------------------------------

export const sessions = pgTable(
  'sessions',
  {
    // session token (random string) doubles as primary key.
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt,
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    // Synapsly ID token captured at login; used as `id_token_hint` for
    // RP-initiated single logout (/end_session). Null for dev-login sessions.
    oidcIdToken: text('oidc_id_token'),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
);

// ---------------------------------------------------------------------------
// tracks — 赛道 (P0 §2). The top operational grouping above projects. Each track
// groups projects(小组) and carries 赛道运营经理(manager) + members via
// track_members. `weekly_goal` is the free-text 本周目标/最低KPI blurb. `rank`
// orders tracks (lexicographic, like tasks.rank).
// ---------------------------------------------------------------------------

export const tracks = pgTable(
  'tracks',
  {
    id: primaryId,
    name: text('name').notNull(),
    key: text('key').notNull(),
    description: text('description'),
    weeklyGoal: text('weekly_goal'),
    archived: boolean('archived').notNull().default(false),
    rank: text('rank').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('tracks_key_uniq').on(table.key)],
);

// ---------------------------------------------------------------------------
// track_members — the people on a 赛道. A track may carry multiple `manager`
// (赛道运营经理 — lead-equivalent over the track's projects, see guards §3) and
// multiple `member` rows. One row per (track, user). `rank` orders the avatars.
// Both sides cascade so rows detach when a track or a user is deleted.
// ---------------------------------------------------------------------------

export const trackMembers = pgTable(
  'track_members',
  {
    trackId: uuid('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: trackMemberRoleEnum('role').notNull(),
    rank: text('rank').notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.trackId, table.userId] }),
    index('track_members_user_id_idx').on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// projects (§5)
// ---------------------------------------------------------------------------

export const projects = pgTable(
  'projects',
  {
    id: primaryId,
    name: text('name').notNull(),
    key: text('key').notNull(),
    description: text('description'),
    archived: boolean('archived').notNull().default(false),
    // Owning 赛道 (P0 §2). NULL = not yet grouped under a track (未归类). A track is
    // never hard-deleted while it owns projects (service guards); set null on delete
    // is the DB-level safety net.
    trackId: uuid('track_id').references(() => tracks.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt,
  },
  (table) => [
    uniqueIndex('projects_key_uniq').on(table.key),
    index('projects_track_id_idx').on(table.trackId),
  ],
);

// ---------------------------------------------------------------------------
// project_members (§5)
// ---------------------------------------------------------------------------

export const projectMembers = pgTable(
  'project_members',
  {
    id: primaryId,
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRoleEnum('role').notNull().default('member'),
    createdAt,
  },
  (table) => [
    uniqueIndex('project_members_project_user_uniq').on(table.projectId, table.userId),
    index('project_members_user_id_idx').on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// tasks (§5)
// ---------------------------------------------------------------------------

export const tasks = pgTable(
  'tasks',
  {
    id: primaryId,
    // Nullable (§8): a NULL project_id is a "no-project" / task-pool task, shared
    // with every logged-in user. Project tasks reference their owning project and
    // are visible only to its members.
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('open'),
    // Task type A/B/C/D (运营需求 §4.1); NULL = 未分类. Orthogonal to `priority`.
    taskType: taskTypeEnum('task_type'),
    // 提交物要求 / 验收标准 (P2 §1, 运营需求 §5.1).
    deliverableSpec: text('deliverable_spec'),
    acceptanceCriteria: text('acceptance_criteria'),
    // 交付质量 A/B/C/D snapshot from the latest review (P2 §2); history in task_reviews.
    qualityGrade: qualityGradeEnum('quality_grade'),
    // 两级复核 (P2 §3): set at deliver time (A类 or points ≥ 8); first approve keeps
    // the task pending_review until a global admin's final approve.
    needsFinalReview: boolean('needs_final_review').notNull().default(false),
    firstApprovedBy: uuid('first_approved_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    firstApprovedAt: timestamp('first_approved_at', { withTimezone: true }),
    // DEPRECATED (lifecycle v2 §2.2): single-assignee model replaced by the
    // `task_claimants` set. Column kept (not dropped) to de-risk the migration;
    // no code reads/writes it going forward.
    assigneeId: uuid('assignee_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    points: integer('points'),
    priority: priorityEnum('priority').notNull().default('medium'),
    // Claim-count limits (claim-limits feature). `min_claimants` (>= 1, default 1)
    // is how many claimants are needed before the task leaves 待认领 for 进行中;
    // below it the task stays open and is flagged 未达下限. `max_claimants` caps how
    // many may claim (NULL = unlimited). Defaults preserve the pre-feature behaviour.
    minClaimants: integer('min_claimants').notNull().default(1),
    maxClaimants: integer('max_claimants'),
    dueDate: date('due_date'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // lexicographic ordering key used for intra-column drag ordering.
    rank: text('rank').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // DEPRECATED (lifecycle v2 §2.2): contribution attribution now lives on
    // `task_claimants`. Kept for migration safety; unused by the code.
    completedBy: uuid('completed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Lifecycle v2 (§2/§3): set on deliver, cleared on reject.
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    deliveredBy: uuid('delivered_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Set by the reviewer on approve/reject (§3).
    reviewedBy: uuid('reviewed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt,
  },
  (table) => [
    index('tasks_project_status_idx').on(table.projectId, table.status),
    index('tasks_assignee_idx').on(table.assigneeId),
    index('tasks_completed_at_idx').on(table.completedAt),
  ],
);

// ---------------------------------------------------------------------------
// task_claimants (lifecycle v2 §2) — the set of users who have claimed a task.
// Replaces the single-assignee model. `points` is the per-claimant share written
// at deliver time (NULL until then / after a reject). PK is (task_id, user_id).
// ---------------------------------------------------------------------------

export const taskClaimants = pgTable(
  'task_claimants',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Per-claimant points share; null until delivered, cleared again on reject.
    points: integer('points'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.userId] }),
    index('task_claimants_user_id_idx').on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// task_reviews — structured review history (P2 §2, 运营需求 §7). One row per
// review action (初审/复核 × 通过/驳回), preserving who decided what, the 交付质量
// grade and the comment — first-class instead of buried in activities.meta.
// Cascades with the task; reviewer restricted (reviews outlive nothing silently).
// ---------------------------------------------------------------------------

export const taskReviews = pgTable(
  'task_reviews',
  {
    id: primaryId,
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    stage: reviewStageEnum('stage').notNull(),
    decision: reviewDecisionEnum('decision').notNull(),
    qualityGrade: qualityGradeEnum('quality_grade'),
    comment: text('comment'),
    createdAt,
  },
  (table) => [index('task_reviews_task_created_idx').on(table.taskId, table.createdAt)],
);

// ---------------------------------------------------------------------------
// labels — a GLOBAL catalog of custom { name, color } labels shared across every
// project/task (task-labels feature). A label is many-to-many with tasks via
// `task_labels`. `name` is unique (a single shared catalog); `color` is a #RRGGBB
// hex. `created_by` is the user who created it (nullable so deleting a user keeps
// the label). Customizable: any logged-in user may create; only a global admin may
// rename/recolor/delete.
// ---------------------------------------------------------------------------

export const labels = pgTable(
  'labels',
  {
    id: primaryId,
    name: text('name').notNull(),
    // Hex color like #ef4444.
    color: text('color').notNull(),
    createdBy: uuid('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt,
  },
  (table) => [uniqueIndex('labels_name_uniq').on(table.name)],
);

// ---------------------------------------------------------------------------
// task_labels — many-to-many join between tasks and the global label catalog.
// PK is (task_id, label_id); both sides cascade so labels detach when a task or a
// label is deleted.
// ---------------------------------------------------------------------------

export const taskLabels = pgTable(
  'task_labels',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.labelId] }),
    index('task_labels_label_id_idx').on(table.labelId),
  ],
);

// ---------------------------------------------------------------------------
// comments (§5)
// ---------------------------------------------------------------------------

export const comments = pgTable(
  'comments',
  {
    id: primaryId,
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    // mentioned user ids; uuid[] column.
    mentions: uuid('mentions')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt,
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (table) => [index('comments_task_id_idx').on(table.taskId)],
);

// ---------------------------------------------------------------------------
// activities (§5)
// ---------------------------------------------------------------------------

export const activities = pgTable(
  'activities',
  {
    id: primaryId,
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    // Nullable (§8): mirrors tasks.project_id — a no-project task's activities
    // carry a NULL project_id and fan out on the global (null-project) channel.
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: activityTypeEnum('type').notNull(),
    meta: jsonb('meta')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt,
  },
  (table) => [
    index('activities_task_created_idx').on(table.taskId, table.createdAt),
    index('activities_project_created_idx').on(table.projectId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// ideas (§7.1) — inspiration / suggestions. Either posted against a task (the
// task's 想法 section) or STANDALONE in the 灵感区 (task_id NULL — no owning
// project, visible to every logged-in user). A lead/admin may adopt one (writing
// reward_points credited to the author's contribution) or reject it. Task ideas
// cascade with their owning task.
// ---------------------------------------------------------------------------

export const ideas = pgTable(
  'ideas',
  {
    id: primaryId,
    // Nullable: a NULL task_id is a STANDALONE 灵感区 idea (no task / project),
    // visible to all logged-in users. Task ideas reference their owning task and
    // cascade with it.
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    status: ideaStatusEnum('status').notNull().default('pending'),
    // Reward points written on adoption; null until then / after a reject.
    rewardPoints: integer('reward_points'),
    // The lead/admin who adopted the idea; null otherwise.
    adoptedBy: uuid('adopted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ideas_task_id_idx').on(table.taskId),
    index('ideas_author_id_idx').on(table.authorId),
  ],
);

// ---------------------------------------------------------------------------
// task_files (§7.2) — file attachments uploaded against a task (used to deliver
// file content). The raw bytes live in `data` (bytea) so files ride along with DB
// backups; single-file uploads are capped at 5MB server-side. Cascades with the
// owning task.
// ---------------------------------------------------------------------------

export const taskFiles = pgTable(
  'task_files',
  {
    id: primaryId,
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    // Raw file bytes; never selected into list/metadata queries.
    data: bytea('data').notNull(),
    createdAt,
  },
  (table) => [index('task_files_task_id_idx').on(table.taskId)],
);

// ---------------------------------------------------------------------------
// idea_files / comment_files — file attachments on ideas (§7.1) and comments.
// Same storage recipe as task_files (bytea in-DB, ≤5MB, rides along with DB
// backups); each cascades with its owning row, so deleting an idea/comment (or
// the task above it) removes the bytes too.
// ---------------------------------------------------------------------------

export const ideaFiles = pgTable(
  'idea_files',
  {
    id: primaryId,
    ideaId: uuid('idea_id')
      .notNull()
      .references(() => ideas.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    // Raw file bytes; never selected into list/metadata queries.
    data: bytea('data').notNull(),
    createdAt,
  },
  (table) => [index('idea_files_idea_id_idx').on(table.ideaId)],
);

export const commentFiles = pgTable(
  'comment_files',
  {
    id: primaryId,
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    filename: text('filename').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    // Raw file bytes; never selected into list/metadata queries.
    data: bytea('data').notNull(),
    createdAt,
  },
  (table) => [index('comment_files_comment_id_idx').on(table.commentId)],
);

// ---------------------------------------------------------------------------
// announcements — admin-published notices shown on the 信息 page. Authored by a
// global admin; readable by every logged-in user. `body` is Markdown. `author_id`
// uses restrict so a user with notices can't be hard-deleted without reassigning.
// ---------------------------------------------------------------------------

export const announcements = pgTable(
  'announcements',
  {
    id: primaryId,
    title: text('title').notNull(),
    body: text('body').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('announcements_created_at_idx').on(table.createdAt)],
);

// ---------------------------------------------------------------------------
// task_texts — text deliverables attached to a task (交付内容 §7.2). Like an
// attachment but a Markdown text body; multiple per task. Cascades with the task.
// `author_id` uses restrict (mirrors comments) so authorship is preserved.
// ---------------------------------------------------------------------------

export const taskTexts = pgTable(
  'task_texts',
  {
    id: primaryId,
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    content: text('content').notNull(),
    createdAt,
  },
  (table) => [index('task_texts_task_id_idx').on(table.taskId)],
);

// ---------------------------------------------------------------------------
// org_nodes — a flexible, editable team org tree (团队架构 / division-of-labor page).
// Self-referential (`parent_id`) so nodes nest to any depth; `project_id` NULL is the
// whole-team tree, non-null scopes the tree to a project. Deleting a node cascades to
// its whole subtree (self-FK cascade) and to its member rows. `rank` orders siblings
// (lexicographic, like tasks.rank). A node's `project_id` always equals its parent's.
// ---------------------------------------------------------------------------

export const orgNodes = pgTable(
  'org_nodes',
  {
    id: primaryId,
    // NULL = whole-team (全团队) tree; non-null scopes the tree to a project.
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'cascade',
    }),
    // Self-FK; NULL = a root node. Cascade so deleting a node removes its subtree.
    parentId: uuid('parent_id').references((): AnyPgColumn => orgNodes.id, {
      onDelete: 'cascade',
    }),
    // Whole-team root nodes of kind `track` bind the visual organization tree to
    // the operational Track entity. The linked track owns its roster; deleting the
    // track removes its visual branch and descendants as one organizational unit.
    trackId: uuid('track_id').references(() => tracks.id, { onDelete: 'cascade' }),
    kind: orgNodeKindEnum('kind').notNull().default('group'),
    title: text('title').notNull(),
    description: text('description'),
    // 岗位名额 (P1); NULL = 不限. Business-meaningful only for kind='position'.
    headcount: integer('headcount'),
    // Lexicographic ordering key among siblings (mirrors tasks.rank).
    rank: text('rank').notNull(),
    createdAt,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('org_nodes_project_parent_idx').on(table.projectId, table.parentId),
    index('org_nodes_parent_idx').on(table.parentId),
    uniqueIndex('org_nodes_track_id_uniq').on(table.trackId),
  ],
);

// ---------------------------------------------------------------------------
// org_node_members — the people on an org node. A node may carry multiple `lead`
// (负责人) and multiple `member` (成员) rows. `user_id` reuses the existing users
// (avatar/name); one row per (node, user). `rank` orders the avatars. Both sides
// cascade so members detach when a node or a user is deleted.
// ---------------------------------------------------------------------------

export const orgNodeMembers = pgTable(
  'org_node_members',
  {
    nodeId: uuid('node_id')
      .notNull()
      .references(() => orgNodes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgMemberRoleEnum('role').notNull(),
    rank: text('rank').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.nodeId, table.userId] }),
    index('org_node_members_user_id_idx').on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// assets — 资产库 (P3, 运营需求 §9): 内容库/反馈库/资源库/问题清单. The durable
// output of the weekly retrospective loop. Standalone or distilled from a done
// task (溯源 via task_id, set-null so assets outlive their source task). Track
// association is set-null too — an asset survives its 赛道's deletion as 通用.
// ---------------------------------------------------------------------------

export const assets = pgTable(
  'assets',
  {
    id: primaryId,
    kind: assetKindEnum('kind').notNull(),
    title: text('title').notNull(),
    // Markdown body; empty string for link-only assets.
    body: text('body').notNull().default(''),
    url: text('url'),
    trackId: uuid('track_id').references(() => tracks.id, { onDelete: 'set null' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('assets_kind_created_idx').on(table.kind, table.createdAt),
    index('assets_track_idx').on(table.trackId),
  ],
);

// ---------------------------------------------------------------------------
// org_applications — 岗位申报 (P1). A member's application to join a `position`
// org node. `pending` rows are unique per (node, user) via a partial index; an
// approver decides (approved/rejected, writing decided_by/decision_note) or the
// applicant withdraws. Approval also inserts the org_node_members row. Cascades
// with the node and the user; decided_by survives user deletion as NULL.
// ---------------------------------------------------------------------------

export const orgApplications = pgTable(
  'org_applications',
  {
    id: primaryId,
    nodeId: uuid('node_id')
      .notNull()
      .references(() => orgNodes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 申报理由 (may be empty).
    note: text('note').notNull().default(''),
    status: applicationStatusEnum('status').notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    decisionNote: text('decision_note'),
    createdAt,
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => [
    index('org_applications_node_idx').on(table.nodeId),
    index('org_applications_user_idx').on(table.userId),
    // One live application per (node, user) at a time.
    uniqueIndex('org_applications_pending_uniq')
      .on(table.nodeId, table.userId)
      .where(sql`status = 'pending'`),
  ],
);

// ---------------------------------------------------------------------------
// settings — key/value store for admin-settable instance config (§8)
// ---------------------------------------------------------------------------

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Inferred row types (server-internal; wire types live in `shared`)
// ---------------------------------------------------------------------------

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserAvatarRow = typeof userAvatars.$inferSelect;
export type NewUserAvatarRow = typeof userAvatars.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type TrackRow = typeof tracks.$inferSelect;
export type NewTrackRow = typeof tracks.$inferInsert;
export type TrackMemberRow = typeof trackMembers.$inferSelect;
export type NewTrackMemberRow = typeof trackMembers.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;
export type NewProjectMemberRow = typeof projectMembers.$inferInsert;
export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type TaskClaimantRow = typeof taskClaimants.$inferSelect;
export type NewTaskClaimantRow = typeof taskClaimants.$inferInsert;
export type TaskReviewRow = typeof taskReviews.$inferSelect;
export type NewTaskReviewRow = typeof taskReviews.$inferInsert;
export type LabelRow = typeof labels.$inferSelect;
export type NewLabelRow = typeof labels.$inferInsert;
export type TaskLabelRow = typeof taskLabels.$inferSelect;
export type NewTaskLabelRow = typeof taskLabels.$inferInsert;
export type CommentRow = typeof comments.$inferSelect;
export type NewCommentRow = typeof comments.$inferInsert;
export type ActivityRow = typeof activities.$inferSelect;
export type NewActivityRow = typeof activities.$inferInsert;
export type IdeaRow = typeof ideas.$inferSelect;
export type NewIdeaRow = typeof ideas.$inferInsert;
export type TaskFileRow = typeof taskFiles.$inferSelect;
export type NewTaskFileRow = typeof taskFiles.$inferInsert;
export type IdeaFileRow = typeof ideaFiles.$inferSelect;
export type NewIdeaFileRow = typeof ideaFiles.$inferInsert;
export type CommentFileRow = typeof commentFiles.$inferSelect;
export type NewCommentFileRow = typeof commentFiles.$inferInsert;
export type SettingRow = typeof settings.$inferSelect;
export type NewSettingRow = typeof settings.$inferInsert;
export type AnnouncementRow = typeof announcements.$inferSelect;
export type NewAnnouncementRow = typeof announcements.$inferInsert;
export type TaskTextRow = typeof taskTexts.$inferSelect;
export type NewTaskTextRow = typeof taskTexts.$inferInsert;
export type OrgNodeRow = typeof orgNodes.$inferSelect;
export type NewOrgNodeRow = typeof orgNodes.$inferInsert;
export type OrgNodeMemberRow = typeof orgNodeMembers.$inferSelect;
export type NewOrgNodeMemberRow = typeof orgNodeMembers.$inferInsert;
export type OrgApplicationRow = typeof orgApplications.$inferSelect;
export type NewOrgApplicationRow = typeof orgApplications.$inferInsert;
export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;

/** Convenience bundle so tests / db factory can pass the whole schema. */
export const schema = {
  users,
  userAvatars,
  sessions,
  tracks,
  trackMembers,
  projects,
  projectMembers,
  tasks,
  taskClaimants,
  taskReviews,
  labels,
  taskLabels,
  comments,
  activities,
  ideas,
  taskFiles,
  settings,
  announcements,
  taskTexts,
  orgNodes,
  orgNodeMembers,
  orgApplications,
  assets,
  userRoleEnum,
  projectRoleEnum,
  taskStatusEnum,
  taskTypeEnum,
  trackMemberRoleEnum,
  priorityEnum,
  activityTypeEnum,
  ideaStatusEnum,
  orgNodeKindEnum,
  orgMemberRoleEnum,
  applicationStatusEnum,
  qualityGradeEnum,
  reviewStageEnum,
  reviewDecisionEnum,
  assetKindEnum,
};
