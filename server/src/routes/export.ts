import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { and, asc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  isAdminRole,
  isoDateTimeSchema,
  uuidSchema,
  type Priority,
  type QualityGrade,
  type TaskStatus,
  type TaskType,
} from 'shared';
import type { Database } from '../db/index.js';
import {
  ideas,
  projects,
  taskClaimants,
  tasks,
  trackMembers,
  tracks,
  users,
  type UserRow,
} from '../db/schema.js';
import { forbidden } from '../lib/errors.js';
import { requireAuth } from '../lib/guards.js';
import { parseQuery } from '../lib/validate.js';

/**
 * CSV export routes (P3 §2, 运营需求 §11 导出备份). No third-party deps — the CSV
 * is assembled server-side (UTF-8 BOM + CRLF + RFC4180 quoting, Excel-compatible)
 * and sent as `content-disposition: attachment`.
 *
 * - GET /export/scores.csv?from&to        — 成员分数表: one row per (claimant ×
 *   done task) with completed_at in the optional window, plus (admin only) the
 *   adopted-idea reward rows (来源=灵感采纳).
 * - GET /export/tasks.csv?from&to&trackId — 任务明细: full task fields + 审核链 +
 *   认领人 list, windowed on created_at, optionally filtered to one 赛道.
 *
 * Permission (both endpoints): global admin → full data; 赛道经理 (manager of ≥1
 * track) → rows limited to projects whose track is among their managed tracks
 * (pool / 未归类 rows and idea rows are admin-only); plain member → 403.
 */

// ---------------------------------------------------------------------------
// CSV mechanics (RFC4180 + Excel compatibility)
// ---------------------------------------------------------------------------

/** UTF-8 BOM so Excel detects the encoding (Chinese headers stay intact). */
const BOM = '\ufeff';

type CsvValue = string | number | null | undefined;

/** RFC4180: quote fields containing comma/quote/newline; double inner quotes. */
function escapeCsv(value: CsvValue): string {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsvRow(fields: CsvValue[]): string {
  return fields.map(escapeCsv).join(',');
}

/** Assemble a full CSV document: BOM prefix + CRLF line endings. */
function toCsvDocument(rows: CsvValue[][]): string {
  return BOM + rows.map(toCsvRow).join('\r\n') + '\r\n';
}

/** Send a CSV attachment named `<basename>-YYYYMMDD.csv` (from today's date). */
function sendCsv(reply: FastifyReply, basename: string, rows: CsvValue[][]): FastifyReply {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${basename}-${stamp}.csv"`)
    .send(toCsvDocument(rows));
}

// ---------------------------------------------------------------------------
// Display labels (code identifiers are English; export copy is Chinese, §12)
// ---------------------------------------------------------------------------

const TASK_TYPE_LABELS: Record<TaskType, string> = {
  critical: 'A · 关键任务',
  baseline: 'B · 底线任务',
  claimable: 'C · 认领任务',
  collab: 'D · 协作任务',
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  open: '待认领',
  in_progress: '进行中',
  pending_review: '待审阅',
  done: '已完成',
};

const PRIORITY_LABELS: Record<Priority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
};

/** 交付质量 renders as the uppercase letter (the enum value is lowercase). */
const QUALITY_LETTERS: Record<QualityGrade, string> = { a: 'A', b: 'B', c: 'C', d: 'D' };

/** 赛道/项目 display for a row: pool tasks have no project (§8). */
function trackLabel(projectId: string | null, trackName: string | null): string {
  return projectId === null ? '未归类' : trackName ?? '未归类';
}

function projectLabel(projectId: string | null, projectName: string | null): string {
  return projectId === null ? '任务池' : projectName ?? '';
}

// ---------------------------------------------------------------------------
// Query validation + scope
// ---------------------------------------------------------------------------

/** from/to: optional ISO datetime window bounds (reuses the shared primitive). */
const exportWindowSchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

const tasksExportQuerySchema = exportWindowSchema.extend({
  trackId: uuidSchema.optional(),
});

/** Parse an optional ISO datetime query field into a Date (undefined if absent). */
function toDate(value: string | undefined): Date | undefined {
  return value === undefined ? undefined : new Date(value);
}

/** The caller's export scope: full data, or limited to their managed 赛道s. */
type ExportScope = { admin: true } | { admin: false; trackIds: string[] };

/**
 * Resolve who may export (P3 §2): a global admin exports everything; a 赛道经理
 * (manager of at least one track) exports rows scoped to their managed tracks;
 * everyone else is forbidden.
 */
async function resolveExportScope(db: Database, user: UserRow): Promise<ExportScope> {
  if (isAdminRole(user.role)) return { admin: true };
  const rows = await db
    .select({ trackId: trackMembers.trackId })
    .from(trackMembers)
    .where(and(eq(trackMembers.userId, user.id), eq(trackMembers.role, 'manager')));
  if (rows.length === 0) {
    throw forbidden('需要管理员或赛道运营经理权限');
  }
  return { admin: false, trackIds: rows.map((r) => r.trackId) };
}

/** Batch-load `{ userId → displayName }` for the referenced people, deduped. */
async function loadDisplayNames(
  db: Database,
  ids: Array<string | null>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, unique));
  for (const r of rows) map.set(r.id, r.displayName);
  return map;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const SCORES_HEADER: CsvValue[] = [
  '成员',
  '邮箱',
  '赛道',
  '项目',
  '任务',
  '任务类型',
  '最终点数',
  '交付质量',
  '审核人',
  '复核状态',
  '完成时间',
];

const TASKS_HEADER: CsvValue[] = [
  '任务',
  '任务类型',
  '状态',
  '赛道',
  '项目',
  '优先级',
  '基础点数',
  '交付质量',
  '提交物要求',
  '验收标准',
  'DDL',
  '需复核',
  '初审人',
  '复核人',
  '认领人',
  '创建时间',
  '完成时间',
];

const exportRoutes: FastifyPluginAsync = async (fastify) => {
  const { db } = fastify;

  // 成员分数表 (P3 §2): one row per (claimant × done task), windowed on completed_at.
  fastify.get('/export/scores.csv', async (request, reply) => {
    const user = requireAuth(request);
    const query = parseQuery(exportWindowSchema, request.query);
    const scope = await resolveExportScope(db, user);
    const from = toDate(query.from);
    const to = toDate(query.to);

    const conditions: SQL[] = [eq(tasks.status, 'done')];
    if (from) conditions.push(gte(tasks.completedAt, from));
    if (to) conditions.push(lte(tasks.completedAt, to));
    // 赛道经理 scope: only projects owned by a managed track. Pool / 未归类 rows
    // fall out naturally (their track id is NULL).
    if (!scope.admin) conditions.push(inArray(projects.trackId, scope.trackIds));

    const rows = await db
      .select({
        task: tasks,
        memberName: users.displayName,
        memberEmail: users.email,
        points: taskClaimants.points,
        projectName: projects.name,
        trackName: tracks.name,
      })
      .from(tasks)
      .innerJoin(taskClaimants, eq(taskClaimants.taskId, tasks.id))
      .innerJoin(users, eq(users.id, taskClaimants.userId))
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(tracks, eq(tracks.id, projects.trackId))
      .where(and(...conditions))
      .orderBy(asc(tasks.completedAt), asc(tasks.createdAt));

    const reviewerNames = await loadDisplayNames(
      db,
      rows.map((r) => r.task.reviewedBy),
    );

    const csvRows: CsvValue[][] = [SCORES_HEADER];
    for (const r of rows) {
      csvRows.push([
        r.memberName,
        r.memberEmail,
        trackLabel(r.task.projectId, r.trackName),
        projectLabel(r.task.projectId, r.projectName),
        r.task.title,
        r.task.taskType ? TASK_TYPE_LABELS[r.task.taskType] : '',
        r.points,
        r.task.qualityGrade ? QUALITY_LETTERS[r.task.qualityGrade] : '',
        r.task.reviewedBy ? reviewerNames.get(r.task.reviewedBy) ?? '' : '',
        r.task.needsFinalReview ? '已复核' : '无需复核',
        r.task.completedAt ? r.task.completedAt.toISOString() : '',
      ]);
    }

    // 灵感采纳 reward rows (ADMIN only — ideas are not track-scoped, so a 赛道经理's
    // export cannot contain them). Windowed on updatedAt (the adoption decision time).
    if (scope.admin) {
      const ideaConditions: SQL[] = [eq(ideas.status, 'adopted')];
      if (from) ideaConditions.push(gte(ideas.updatedAt, from));
      if (to) ideaConditions.push(lte(ideas.updatedAt, to));

      const ideaRows = await db
        .select({
          idea: ideas,
          authorName: users.displayName,
          authorEmail: users.email,
        })
        .from(ideas)
        .innerJoin(users, eq(users.id, ideas.authorId))
        .where(and(...ideaConditions))
        .orderBy(asc(ideas.updatedAt));

      const adopterNames = await loadDisplayNames(
        db,
        ideaRows.map((r) => r.idea.adoptedBy),
      );

      for (const r of ideaRows) {
        csvRows.push([
          r.authorName,
          r.authorEmail,
          '',
          '灵感采纳',
          r.idea.body.slice(0, 50),
          '',
          r.idea.rewardPoints,
          '',
          r.idea.adoptedBy ? adopterNames.get(r.idea.adoptedBy) ?? '' : '',
          '',
          r.idea.updatedAt.toISOString(),
        ]);
      }
    }

    return sendCsv(reply, 'scores', csvRows);
  });

  // 任务明细 (P3 §2): every task field + 审核链 + 认领人, windowed on created_at.
  fastify.get('/export/tasks.csv', async (request, reply) => {
    const user = requireAuth(request);
    const query = parseQuery(tasksExportQuerySchema, request.query);
    const scope = await resolveExportScope(db, user);
    const from = toDate(query.from);
    const to = toDate(query.to);

    // A 赛道经理 may only narrow to a track they manage.
    if (query.trackId && !scope.admin && !scope.trackIds.includes(query.trackId)) {
      throw forbidden('没有权限导出该赛道');
    }

    const conditions: SQL[] = [];
    if (from) conditions.push(gte(tasks.createdAt, from));
    if (to) conditions.push(lte(tasks.createdAt, to));
    if (query.trackId) {
      conditions.push(eq(projects.trackId, query.trackId));
    } else if (!scope.admin) {
      conditions.push(inArray(projects.trackId, scope.trackIds));
    }

    const rows = await db
      .select({ task: tasks, projectName: projects.name, trackName: tracks.name })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .leftJoin(tracks, eq(tracks.id, projects.trackId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(tasks.createdAt));

    // Batch-resolve the 认领人 lists and the 审核链 people (no N+1).
    const taskIds = rows.map((r) => r.task.id);
    const claimantsByTask = new Map<string, string[]>();
    if (taskIds.length > 0) {
      const claimantRows = await db
        .select({ taskId: taskClaimants.taskId, name: users.displayName })
        .from(taskClaimants)
        .innerJoin(users, eq(users.id, taskClaimants.userId))
        .where(inArray(taskClaimants.taskId, taskIds))
        .orderBy(asc(taskClaimants.claimedAt));
      for (const c of claimantRows) {
        const list = claimantsByTask.get(c.taskId) ?? [];
        list.push(c.name);
        claimantsByTask.set(c.taskId, list);
      }
    }
    const peopleNames = await loadDisplayNames(db, [
      ...rows.map((r) => r.task.firstApprovedBy),
      ...rows.map((r) => r.task.reviewedBy),
    ]);

    const csvRows: CsvValue[][] = [TASKS_HEADER];
    for (const r of rows) {
      csvRows.push([
        r.task.title,
        r.task.taskType ? TASK_TYPE_LABELS[r.task.taskType] : '',
        STATUS_LABELS[r.task.status],
        trackLabel(r.task.projectId, r.trackName),
        projectLabel(r.task.projectId, r.projectName),
        PRIORITY_LABELS[r.task.priority],
        r.task.points,
        r.task.qualityGrade ? QUALITY_LETTERS[r.task.qualityGrade] : '',
        r.task.deliverableSpec ?? '',
        r.task.acceptanceCriteria ?? '',
        r.task.dueDate ?? '',
        r.task.needsFinalReview ? '是' : '否',
        r.task.firstApprovedBy ? peopleNames.get(r.task.firstApprovedBy) ?? '' : '',
        r.task.reviewedBy ? peopleNames.get(r.task.reviewedBy) ?? '' : '',
        (claimantsByTask.get(r.task.id) ?? []).join('、'),
        r.task.createdAt.toISOString(),
        r.task.completedAt ? r.task.completedAt.toISOString() : '',
      ]);
    }

    return sendCsv(reply, 'tasks', csvRows);
  });
};

export default exportRoutes;
