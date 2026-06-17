import { desc, eq } from 'drizzle-orm';
import type {
  Announcement,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
  UserSummary,
} from 'shared';
import type { Database } from '../db/index.js';
import {
  announcements,
  users,
  type AnnouncementRow,
  type UserRow,
} from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { publishChange } from './activityService.js';
import type { RealtimeBus } from '../realtime/bus.js';

/**
 * Announcement / 信息 service. Admin-published notices readable by every logged-in
 * user; the routes gate writes to a global admin. Each mutation publishes a global
 * `announcement` realtime event (projectId null → fans out to all connected users)
 * so open 信息 pages refresh (§6.5). `body` is Markdown, rendered safely client-side.
 */

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

/** Serialize an announcement row + its author to the shared wire shape. */
function toAnnouncement(row: AnnouncementRow, author: UserRow): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    author: toUserSummary(author),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Publish a global `announcement` realtime event for list invalidation (§6.5). */
function publishAnnouncementChange(bus: RealtimeBus, type: string, id: string): void {
  publishChange(
    { type, projectId: null, entity: 'announcement', payload: { announcementId: id } },
    bus,
  );
}

/** Load + serialize a single announcement by id (joined with its author). */
async function serializeById(db: Database, id: string): Promise<Announcement> {
  const rows = await db
    .select({ row: announcements, author: users })
    .from(announcements)
    .innerJoin(users, eq(announcements.authorId, users.id))
    .where(eq(announcements.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) throw notFound('信息不存在');
  return toAnnouncement(r.row, r.author);
}

/** All announcements, newest first. */
export async function listAnnouncements(db: Database): Promise<Announcement[]> {
  const rows = await db
    .select({ row: announcements, author: users })
    .from(announcements)
    .innerJoin(users, eq(announcements.authorId, users.id))
    .orderBy(desc(announcements.createdAt));
  return rows.map((r) => toAnnouncement(r.row, r.author));
}

/** Load a raw announcement row or throw 404. */
export async function loadAnnouncementOrThrow(
  db: Database,
  id: string,
): Promise<AnnouncementRow> {
  const rows = await db.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw notFound('信息不存在');
  return row;
}

/** Publish a new announcement (global admin). */
export async function createAnnouncement(
  db: Database,
  bus: RealtimeBus,
  authorId: string,
  input: CreateAnnouncementInput,
): Promise<Announcement> {
  const [created] = await db
    .insert(announcements)
    .values({ title: input.title, body: input.body, authorId })
    .returning();
  if (!created) {
    throw new Error('创建信息失败：未返回插入行');
  }
  publishAnnouncementChange(bus, 'created', created.id);
  return serializeById(db, created.id);
}

/** Edit an announcement's title/body (global admin); bumps `updatedAt`. */
export async function updateAnnouncement(
  db: Database,
  bus: RealtimeBus,
  id: string,
  input: UpdateAnnouncementInput,
): Promise<Announcement> {
  await loadAnnouncementOrThrow(db, id);
  const patch: Partial<AnnouncementRow> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;

  const [updated] = await db
    .update(announcements)
    .set(patch)
    .where(eq(announcements.id, id))
    .returning();
  if (!updated) throw notFound('信息不存在');

  publishAnnouncementChange(bus, 'updated', id);
  return serializeById(db, id);
}

/** Delete an announcement (global admin). */
export async function deleteAnnouncement(
  db: Database,
  bus: RealtimeBus,
  id: string,
): Promise<void> {
  await loadAnnouncementOrThrow(db, id);
  await db.delete(announcements).where(eq(announcements.id, id));
  publishAnnouncementChange(bus, 'deleted', id);
}
