import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  CreateTrackInput,
  SetTrackMembersInput,
  Track,
  TrackMember,
  UpdateTrackInput,
} from 'shared';
import type { Database } from '../db/index.js';
import {
  projects,
  trackMembers,
  tracks,
  users,
  type TrackRow,
  type UserRow,
} from '../db/schema.js';
import { conflict, notFound, validationError } from '../lib/errors.js';
import { publishChange } from './activityService.js';
import { bus, type RealtimeBus } from '../realtime/bus.js';
import { rankBetween } from './taskService.js';

/**
 * 赛道 (Track) service — the top operational grouping above projects (P0 §2). Owns
 * track CRUD, the manager/member roster (`track_members`), and the project-count
 * rollup shown in the listing. A track `manager` (赛道运营经理) is lead-equivalent
 * over every project in the track; that authority lives in `guards.isTrackManager`
 * so it can be reused without importing this service. Track CRUD + roster changes
 * are global-admin only (enforced in the route); reads are open to all members.
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
// Row -> wire mapping
// ---------------------------------------------------------------------------

function toTrackMember(user: UserRow, role: 'manager' | 'member'): TrackMember {
  return {
    userId: user.id,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    hasAvatar: user.avatarMime != null,
    role,
  };
}

function toTrack(
  row: TrackRow,
  managers: TrackMember[],
  members: TrackMember[],
  projectCount: number,
): Track {
  return {
    id: row.id,
    name: row.name,
    key: row.key,
    description: row.description,
    weeklyGoal: row.weeklyGoal,
    archived: row.archived,
    rank: row.rank,
    managers,
    members,
    projectCount,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Loaders / queries
// ---------------------------------------------------------------------------

/** Load a track by id or throw 404. */
export async function loadTrackOrThrow(db: Database, id: string): Promise<TrackRow> {
  const rows = await db.select().from(tracks).where(eq(tracks.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    throw notFound('赛道不存在');
  }
  return row;
}

/**
 * All tracks (rank-ordered), each with its people split into managers/members and its
 * owning-project count. Assembled from three flat queries (tracks, members+users,
 * grouped project counts) to avoid an N+1.
 */
export async function listTracks(db: Database): Promise<Track[]> {
  const trackRows = await db
    .select()
    .from(tracks)
    .orderBy(asc(tracks.rank), asc(tracks.createdAt));
  if (trackRows.length === 0) {
    return [];
  }

  const trackIds = trackRows.map((t) => t.id);

  const memberRows = await db
    .select({ member: trackMembers, user: users })
    .from(trackMembers)
    .innerJoin(users, eq(trackMembers.userId, users.id))
    .where(inArray(trackMembers.trackId, trackIds))
    .orderBy(asc(trackMembers.rank));

  const managersByTrack = new Map<string, TrackMember[]>();
  const membersByTrack = new Map<string, TrackMember[]>();
  for (const { member, user } of memberRows) {
    const bucket = member.role === 'manager' ? managersByTrack : membersByTrack;
    const list = bucket.get(member.trackId) ?? [];
    list.push(toTrackMember(user, member.role));
    bucket.set(member.trackId, list);
  }

  const counts = await db
    .select({ trackId: projects.trackId, count: sql<number>`count(*)::int` })
    .from(projects)
    .where(inArray(projects.trackId, trackIds))
    .groupBy(projects.trackId);
  const countByTrack = new Map(counts.map((c) => [c.trackId, c.count]));

  return trackRows.map((row) =>
    toTrack(
      row,
      managersByTrack.get(row.id) ?? [],
      membersByTrack.get(row.id) ?? [],
      countByTrack.get(row.id) ?? 0,
    ),
  );
}

/** Serialize one track (with people + project count) — used by mutation responses. */
async function serializeTrack(db: Database, id: string): Promise<Track> {
  const row = await loadTrackOrThrow(db, id);
  const memberRows = await db
    .select({ member: trackMembers, user: users })
    .from(trackMembers)
    .innerJoin(users, eq(trackMembers.userId, users.id))
    .where(eq(trackMembers.trackId, id))
    .orderBy(asc(trackMembers.rank));

  const managers: TrackMember[] = [];
  const members: TrackMember[] = [];
  for (const { member, user } of memberRows) {
    (member.role === 'manager' ? managers : members).push(
      toTrackMember(user, member.role),
    );
  }

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.trackId, id));

  return toTrack(row, managers, members, count);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function publishTrackChange(
  realtimeBus: RealtimeBus,
  type: string,
  trackId: string,
): void {
  // Track events fan out on the global (null-project) channel so every member's
  // project/track listings refresh (reads are open to all).
  publishChange(
    { type, projectId: null, entity: 'track', payload: { trackId } },
    realtimeBus,
  );
}

/** Create a 赛道 (global admin). Appended after the last track. 409 on duplicate key. */
export async function createTrack(
  db: Database,
  creator: UserRow,
  input: CreateTrackInput,
  realtimeBus: RealtimeBus = bus,
): Promise<Track> {
  const [last] = await db
    .select({ rank: tracks.rank })
    .from(tracks)
    .orderBy(desc(tracks.rank))
    .limit(1);
  const rank = rankBetween(last?.rank ?? null, null);

  let row: TrackRow | undefined;
  try {
    [row] = await db
      .insert(tracks)
      .values({
        name: input.name,
        key: input.key,
        description: input.description ?? null,
        weeklyGoal: input.weeklyGoal ?? null,
        rank,
        createdBy: creator.id,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('赛道标识已被占用');
    }
    throw error;
  }
  if (!row) {
    throw new Error('创建赛道失败：未返回插入行');
  }

  publishTrackChange(realtimeBus, 'track_created', row.id);
  return serializeTrack(db, row.id);
}

/** Edit a 赛道's name/description/weeklyGoal/archived flag (global admin). */
export async function updateTrack(
  db: Database,
  trackId: string,
  input: UpdateTrackInput,
  realtimeBus: RealtimeBus = bus,
): Promise<Track> {
  const patch: Partial<TrackRow> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.weeklyGoal !== undefined) patch.weeklyGoal = input.weeklyGoal;
  if (input.archived !== undefined) patch.archived = input.archived;

  const [row] = await db
    .update(tracks)
    .set(patch)
    .where(eq(tracks.id, trackId))
    .returning();
  if (!row) {
    throw notFound('赛道不存在');
  }

  publishTrackChange(realtimeBus, 'track_updated', trackId);
  return serializeTrack(db, trackId);
}

/**
 * Delete a 赛道 (global admin). Refuses while the track still owns projects (409):
 * reassign or archive first, so a project is never silently orphaned to 未归类. The
 * track's member rows cascade away.
 */
export async function deleteTrack(
  db: Database,
  trackId: string,
  realtimeBus: RealtimeBus = bus,
): Promise<void> {
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.trackId, trackId));
  if (count > 0) {
    throw conflict('该赛道下仍有项目，请先移出项目或改为归档');
  }

  const [row] = await db.delete(tracks).where(eq(tracks.id, trackId)).returning();
  if (!row) {
    throw notFound('赛道不存在');
  }
  publishTrackChange(realtimeBus, 'track_deleted', trackId);
}

/**
 * Replace a 赛道's people with exactly `managers` (赛道运营经理) + `members` (global
 * admin). Managers gain lead-equivalent authority over the track's projects. Validates
 * every id refers to an existing user and that the two sets are disjoint.
 */
export async function setTrackMembers(
  db: Database,
  trackId: string,
  input: SetTrackMembersInput,
  realtimeBus: RealtimeBus = bus,
): Promise<Track> {
  await loadTrackOrThrow(db, trackId);

  const allIds = [...input.managers, ...input.members];
  if (new Set(allIds).size !== allIds.length) {
    throw validationError('同一个人不能同时是赛道经理和成员');
  }
  if (allIds.length > 0) {
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, allIds));
    if (found.length !== new Set(allIds).size) {
      throw validationError('存在无效的用户');
    }
  }

  const rows = [
    ...input.managers.map((userId, i) => ({
      trackId,
      userId,
      role: 'manager' as const,
      rank: String(i).padStart(6, '0'),
    })),
    ...input.members.map((userId, i) => ({
      trackId,
      userId,
      role: 'member' as const,
      rank: String(i).padStart(6, '0'),
    })),
  ];

  // Replace the whole roster (mirrors orgService.setMembers): clear then re-insert,
  // back-to-back on a single request (matches the codebase's data-access conventions).
  await db.delete(trackMembers).where(eq(trackMembers.trackId, trackId));
  if (rows.length > 0) {
    await db.insert(trackMembers).values(rows);
  }

  publishTrackChange(realtimeBus, 'track_members_set', trackId);
  return serializeTrack(db, trackId);
}
