import { and, desc, eq, inArray } from 'drizzle-orm';
import { isAdminRole } from 'shared';
import type {
  Asset,
  AssetsQuery,
  CreateAssetInput,
  UpdateAssetInput,
  UserSummary,
} from 'shared';
import type { Database } from '../db/index.js';
import {
  assets,
  tasks,
  trackMembers,
  tracks,
  users,
  type AssetRow,
  type UserRow,
} from '../db/schema.js';
import { forbidden, notFound } from '../lib/errors.js';
import { publishChange } from './activityService.js';
import { bus, type RealtimeBus } from '../realtime/bus.js';

/**
 * 资产库 (Asset) service (P3 §1, 运营需求 §9): 内容库/反馈库/资源库/问题清单. The
 * durable output of the weekly retrospective loop — created standalone on the 资产
 * page or distilled from a done task (「沉淀为资产」, 溯源 via task_id). Reads are
 * team-wide (any logged-in user); any member creates; the author edits/deletes their
 * own; a global admin or a 赛道经理 (manager of ANY track) edits/deletes all. Every
 * mutation publishes a global `asset` realtime event (projectId null → fans out to
 * all connected users) so open 资产 pages refresh (§6.5).
 */

// ---------------------------------------------------------------------------
// Row → wire mapping
// ---------------------------------------------------------------------------

/** Resolved display context for one asset (batch-loaded, no N+1). */
interface AssetContext {
  trackName: string | null;
  taskTitle: string | null;
  creator: UserSummary;
}

function toUserSummary(
  row: Pick<UserRow, 'id' | 'displayName' | 'avatarColor' | 'avatarMime'>,
): UserSummary {
  return {
    id: row.id,
    displayName: row.displayName,
    avatarColor: row.avatarColor,
    hasAvatar: row.avatarMime != null,
  };
}

/** Serialize an asset row + its resolved context to the shared wire shape. */
function toAsset(row: AssetRow, ctx: AssetContext): Asset {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    url: row.url,
    trackId: row.trackId,
    trackName: ctx.trackName,
    taskId: row.taskId,
    taskTitle: ctx.taskTitle,
    creator: ctx.creator,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Batch-serialize asset rows (joined with their creators): one query each for the
 * distinct track names and source-task titles. A deleted track/task leaves the id
 * NULL (FK set-null), so the display fields simply serialize to null.
 */
async function serializeAssetRows(
  db: Database,
  rows: Array<{ row: AssetRow; creator: UserRow }>,
): Promise<Asset[]> {
  const trackIds = [
    ...new Set(rows.map((r) => r.row.trackId).filter((id): id is string => id !== null)),
  ];
  const trackNameById = new Map<string, string>();
  if (trackIds.length > 0) {
    const trackRows = await db
      .select({ id: tracks.id, name: tracks.name })
      .from(tracks)
      .where(inArray(tracks.id, trackIds));
    for (const t of trackRows) trackNameById.set(t.id, t.name);
  }

  const taskIds = [
    ...new Set(rows.map((r) => r.row.taskId).filter((id): id is string => id !== null)),
  ];
  const taskTitleById = new Map<string, string>();
  if (taskIds.length > 0) {
    const taskRows = await db
      .select({ id: tasks.id, title: tasks.title })
      .from(tasks)
      .where(inArray(tasks.id, taskIds));
    for (const t of taskRows) taskTitleById.set(t.id, t.title);
  }

  return rows.map(({ row, creator }) =>
    toAsset(row, {
      trackName: row.trackId ? trackNameById.get(row.trackId) ?? null : null,
      taskTitle: row.taskId ? taskTitleById.get(row.taskId) ?? null : null,
      creator: toUserSummary(creator),
    }),
  );
}

/** Load + serialize a single asset by id (joined with its creator). */
async function serializeById(db: Database, id: string): Promise<Asset> {
  const rows = await db
    .select({ row: assets, creator: users })
    .from(assets)
    .innerJoin(users, eq(assets.createdBy, users.id))
    .where(eq(assets.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) throw notFound('资产不存在');
  const [asset] = await serializeAssetRows(db, [r]);
  if (!asset) throw notFound('资产不存在');
  return asset;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Load a raw asset row or throw 404. */
export async function loadAssetOrThrow(db: Database, id: string): Promise<AssetRow> {
  const rows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw notFound('资产不存在');
  return row;
}

/** Validate that a referenced 赛道 exists (404 otherwise). */
async function ensureTrackExists(db: Database, trackId: string): Promise<void> {
  const rows = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(eq(tracks.id, trackId))
    .limit(1);
  if (rows.length === 0) throw notFound('赛道不存在');
}

/** Validate that a referenced source task exists (404 otherwise). */
async function ensureTaskExists(db: Database, taskId: string): Promise<void> {
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (rows.length === 0) throw notFound('任务不存在');
}

/**
 * Whether `userId` manages ANY 赛道 (a track_members role='manager' row exists).
 * Assets are team-wide, not track-scoped, so any 赛道经理 is asset-curator tier
 * (P3 §1) regardless of which track an asset is filed under.
 */
async function isAnyTrackManager(db: Database, userId: string): Promise<boolean> {
  const rows = await db
    .select({ trackId: trackMembers.trackId })
    .from(trackMembers)
    .where(and(eq(trackMembers.userId, userId), eq(trackMembers.role, 'manager')))
    .limit(1);
  return rows.length > 0;
}

/**
 * Whether `user` may edit/delete `asset` (P3 §1): the author, a global admin, or a
 * 赛道经理 (manager of any track).
 */
async function canManageAsset(
  db: Database,
  user: UserRow,
  asset: AssetRow,
): Promise<boolean> {
  if (asset.createdBy === user.id) return true;
  if (isAdminRole(user.role)) return true;
  return isAnyTrackManager(db, user.id);
}

/** Publish a global `asset` realtime event for list invalidation (§6.5). */
function publishAssetChange(
  realtimeBus: RealtimeBus,
  type: string,
  assetId: string,
): void {
  publishChange(
    { type, projectId: null, entity: 'asset', payload: { assetId } },
    realtimeBus,
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** All assets, newest first, optionally filtered by kind and/or 赛道. */
export async function listAssets(db: Database, query: AssetsQuery): Promise<Asset[]> {
  const conditions = [];
  if (query.kind !== undefined) conditions.push(eq(assets.kind, query.kind));
  if (query.trackId !== undefined) conditions.push(eq(assets.trackId, query.trackId));

  const rows = await db
    .select({ row: assets, creator: users })
    .from(assets)
    .innerJoin(users, eq(assets.createdBy, users.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(assets.createdAt));

  return serializeAssetRows(db, rows);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Create an asset (any member). Validates the optional track/task references. */
export async function createAsset(
  db: Database,
  creator: UserRow,
  input: CreateAssetInput,
  realtimeBus: RealtimeBus = bus,
): Promise<Asset> {
  const trackId = input.trackId ?? null;
  const taskId = input.taskId ?? null;
  if (trackId !== null) await ensureTrackExists(db, trackId);
  if (taskId !== null) await ensureTaskExists(db, taskId);

  const [created] = await db
    .insert(assets)
    .values({
      kind: input.kind,
      title: input.title,
      // Link-only assets carry an empty body (schema refine: body or url required).
      body: input.body ?? '',
      url: input.url ?? null,
      trackId,
      taskId,
      createdBy: creator.id,
    })
    .returning();
  if (!created) {
    throw new Error('创建资产失败：未返回插入行');
  }

  publishAssetChange(realtimeBus, 'created', created.id);
  return serializeById(db, created.id);
}

/**
 * Edit an asset (author; admin / 赛道经理 for all). Re-validates a changed track
 * reference (null clears it) and bumps `updatedAt`.
 */
export async function updateAsset(
  db: Database,
  user: UserRow,
  id: string,
  input: UpdateAssetInput,
  realtimeBus: RealtimeBus = bus,
): Promise<Asset> {
  const asset = await loadAssetOrThrow(db, id);
  if (!(await canManageAsset(db, user, asset))) {
    throw forbidden('只能编辑自己创建的资产');
  }
  if (input.trackId != null) await ensureTrackExists(db, input.trackId);

  const patch: Partial<AssetRow> = { updatedAt: new Date() };
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  if (input.url !== undefined) patch.url = input.url;
  if (input.trackId !== undefined) patch.trackId = input.trackId;

  const [updated] = await db
    .update(assets)
    .set(patch)
    .where(eq(assets.id, id))
    .returning();
  if (!updated) throw notFound('资产不存在');

  publishAssetChange(realtimeBus, 'updated', id);
  return serializeById(db, id);
}

/** Delete an asset (author; admin / 赛道经理 for all). */
export async function deleteAsset(
  db: Database,
  user: UserRow,
  id: string,
  realtimeBus: RealtimeBus = bus,
): Promise<void> {
  const asset = await loadAssetOrThrow(db, id);
  if (!(await canManageAsset(db, user, asset))) {
    throw forbidden('只能删除自己创建的资产');
  }

  await db.delete(assets).where(eq(assets.id, id));
  publishAssetChange(realtimeBus, 'deleted', id);
}
