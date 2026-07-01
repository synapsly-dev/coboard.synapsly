import { asc, eq, sql } from 'drizzle-orm';
import type {
  CreateUserInput,
  UpdateUserInput,
  User,
  UserProjectMembership,
  UserWithProjects,
} from 'shared';
import type { Database } from '../db/index.js';
import {
  projectMembers,
  projects,
  userAvatars,
  users,
  type UserRow,
} from '../db/schema.js';
import { deleteUserSessions } from '../auth/session.js';
import { conflict, notFound, validationError } from '../lib/errors.js';

/**
 * User domain service (§7 users-admin, §8). Owns account creation, listing, and
 * updates plus the row→wire serialization that strips `password_hash`. Routes
 * call these after the auth/admin guards have run.
 */

/** Palette used to assign a stable-ish avatar background when none is given. */
const AVATAR_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
] as const;

/** Pick a deterministic-but-spread avatar color for a new account. */
function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index]!;
}

/**
 * Serialize a database user row into the public §5 wire shape. Drops
 * `password_hash` and converts the timestamptz Date into an ISO-8601 string.
 */
export function serializeUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    avatarColor: row.avatarColor,
    role: row.role,
    isActive: row.isActive,
    hasAvatar: row.avatarMime != null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Count all users — used by the first-run setup gate (§8). */
export async function countUsers(db: Database): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  return rows[0]?.count ?? 0;
}

/** Look up a user by (case-sensitive, already-normalized) email, or null. */
export async function findUserByEmail(
  db: Database,
  email: string,
): Promise<UserRow | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0] ?? null;
}

/** Look up a user by id, or null. */
export async function findUserById(
  db: Database,
  id: string,
): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** List all users ordered by creation time (admin view §7). */
export async function listUsers(db: Database): Promise<UserRow[]> {
  return db.select().from(users).orderBy(asc(users.createdAt));
}

/**
 * List all users (admin §7) each joined with their project memberships
 * `{ projectId, projectName, role }`. Uses a single grouped query over
 * project_members ⋈ projects (no per-user N+1); users in no project come back
 * with an empty `projects` array so the UI can flag them as orphaned (§6.3).
 */
export async function listUsersWithProjects(
  db: Database,
): Promise<UserWithProjects[]> {
  const rows = await listUsers(db);

  const memberships = await db
    .select({
      userId: projectMembers.userId,
      projectId: projects.id,
      projectName: projects.name,
      role: projectMembers.role,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .orderBy(asc(projects.createdAt));

  const byUser = new Map<string, UserProjectMembership[]>();
  for (const m of memberships) {
    const list = byUser.get(m.userId) ?? [];
    list.push({ projectId: m.projectId, projectName: m.projectName, role: m.role });
    byUser.set(m.userId, list);
  }

  return rows.map((row) => ({
    ...serializeUser(row),
    projects: byUser.get(row.id) ?? [],
  }));
}

export interface CreateUserParams {
  email: string;
  displayName: string;
  role: 'admin' | 'member';
  avatarColor?: string | undefined;
  /** Optional Synapsly subject to link at creation (SSO provisioning). */
  synapslySub?: string | undefined;
}

/**
 * Create a passwordless user account. Throws 409 on a duplicate email. Used by
 * the admin "add by email" flow (pre-provision before first SSO login) and, via
 * {@link createSsoUser}, by SSO provisioning. Identity is Synapsly ID, not a
 * password, so `password_hash` is always null.
 */
export async function createUser(
  db: Database,
  params: CreateUserParams,
): Promise<UserRow> {
  const existing = await findUserByEmail(db, params.email);
  if (existing) {
    throw conflict('该邮箱已被注册');
  }

  const avatarColor = params.avatarColor ?? pickAvatarColor(params.email);

  const inserted = await db
    .insert(users)
    .values({
      email: params.email,
      passwordHash: null,
      synapslySub: params.synapslySub ?? null,
      displayName: params.displayName,
      avatarColor,
      role: params.role,
      isActive: true,
    })
    .returning();

  const row = inserted[0];
  if (!row) {
    throw new Error('创建用户失败：未返回插入行');
  }
  return row;
}

/**
 * Build the create-user params from the validated admin input (§7). The `role`
 * field carries a zod `.default('member')`, so after parsing it is always
 * present at runtime; the parameter is typed with `role` optional only because
 * the schema's inferred *input* type marks it so. We coalesce defensively.
 */
export function createUserParamsFromInput(
  input: Omit<CreateUserInput, 'role'> & { role?: CreateUserInput['role'] },
): CreateUserParams {
  return {
    email: input.email,
    displayName: input.displayName,
    role: input.role ?? 'member',
    avatarColor: input.avatarColor,
  };
}

/** Look up a user by their Synapsly subject (OIDC `sub`), or null. */
export async function findUserBySynapslySub(
  db: Database,
  sub: string,
): Promise<UserRow | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.synapslySub, sub))
    .limit(1);
  return rows[0] ?? null;
}

export interface CreateSsoUserParams {
  email: string;
  displayName: string;
  role: 'admin' | 'member';
  synapslySub: string;
  avatarColor?: string | undefined;
}

/** Provision a new user from a verified Synapsly identity (link the sub). */
export async function createSsoUser(
  db: Database,
  params: CreateSsoUserParams,
): Promise<UserRow> {
  return createUser(db, {
    email: params.email,
    displayName: params.displayName,
    role: params.role,
    avatarColor: params.avatarColor,
    synapslySub: params.synapslySub,
  });
}

/** Attach a Synapsly subject to an existing (email-matched) user row. */
export async function linkSynapslySub(
  db: Database,
  userId: string,
  sub: string,
): Promise<UserRow> {
  const updated = await db
    .update(users)
    .set({ synapslySub: sub })
    .where(eq(users.id, userId))
    .returning();
  const row = updated[0];
  if (!row) throw notFound('用户不存在');
  return row;
}

/**
 * Apply an admin update to a user (displayName / role / isActive / avatarColor).
 * Deactivating a user also revokes their sessions so the change is immediate.
 * Throws 404 if the target does not exist.
 */
export async function updateUser(
  db: Database,
  id: string,
  input: UpdateUserInput,
): Promise<UserRow> {
  const target = await findUserById(db, id);
  if (!target) {
    throw notFound('用户不存在');
  }

  const patch: Partial<UserRow> = {};
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.role !== undefined) patch.role = input.role;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.avatarColor !== undefined) patch.avatarColor = input.avatarColor;

  const updated = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, id))
    .returning();

  const row = updated[0];
  if (!row) {
    throw notFound('用户不存在');
  }

  // Revoke sessions when an account is deactivated so access ends immediately.
  if (input.isActive === false) {
    await deleteUserSessions(db, id);
  }

  return row;
}

// ---------------------------------------------------------------------------
// Avatar upload (Change 1) — self-service profile pictures. The big base64 bytes
// live in `user_avatars`; the users row only carries `avatar_mime` so list
// selects stay light.
// ---------------------------------------------------------------------------

/** Allowed avatar mime types. */
const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type AvatarMime = (typeof AVATAR_MIME_TYPES)[number];

/** Max decoded avatar size in bytes (a 256px JPEG is well under this). */
const MAX_AVATAR_BYTES = 700_000;

const DATA_URL_RE = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/;

export interface ParsedAvatar {
  mime: AvatarMime;
  /** Base64 body, no `data:` prefix and no whitespace. */
  base64: string;
  bytes: number;
}

/**
 * Parse + validate an avatar data URL. Throws a 400 AppError when the format,
 * mime, or decoded size is unacceptable. Returns the clean base64 body to store.
 */
export function parseAvatarDataUrl(image: string): ParsedAvatar {
  const match = DATA_URL_RE.exec(image.trim());
  if (!match) {
    throw validationError('图片格式不正确，仅支持 PNG / JPEG / WebP');
  }
  const mime = match[1] as AvatarMime;
  if (!AVATAR_MIME_TYPES.includes(mime)) {
    throw validationError('不支持的图片类型');
  }
  const base64 = match[2]!.replace(/\s+/g, '');
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw validationError('图片数据无法解析');
  }
  if (buffer.length === 0) {
    throw validationError('图片数据为空');
  }
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw validationError('图片过大，请上传更小的头像');
  }
  return { mime, base64, bytes: buffer.length };
}

/**
 * Store (or replace) a user's avatar: set `users.avatar_mime` and upsert the
 * base64 bytes into `user_avatars`. Returns the refreshed user row. Throws 404
 * if the user no longer exists.
 */
export async function setUserAvatar(
  db: Database,
  userId: string,
  image: string,
): Promise<UserRow> {
  const parsed = parseAvatarDataUrl(image);

  const updated = await db
    .update(users)
    .set({ avatarMime: parsed.mime })
    .where(eq(users.id, userId))
    .returning();
  const row = updated[0];
  if (!row) {
    throw notFound('用户不存在');
  }

  await db
    .insert(userAvatars)
    .values({ userId, data: parsed.base64, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userAvatars.userId,
      set: { data: parsed.base64, updatedAt: new Date() },
    });

  return row;
}

/**
 * Remove a user's avatar: clear `users.avatar_mime` and delete the bytes row.
 * Returns the refreshed user row. Throws 404 if the user no longer exists.
 */
export async function clearUserAvatar(
  db: Database,
  userId: string,
): Promise<UserRow> {
  const updated = await db
    .update(users)
    .set({ avatarMime: null })
    .where(eq(users.id, userId))
    .returning();
  const row = updated[0];
  if (!row) {
    throw notFound('用户不存在');
  }

  await db.delete(userAvatars).where(eq(userAvatars.userId, userId));
  return row;
}

export interface AvatarData {
  mime: string;
  /** Raw decoded image bytes. */
  bytes: Buffer;
  /** A weak ETag value derived from the row's updated_at. */
  etag: string;
}

/**
 * Load a user's avatar bytes for the GET /users/:id/avatar endpoint. Joins the
 * mime off `users` with the base64 body in `user_avatars`. Returns null when the
 * user has no avatar so the route can 404. The base64 never leaks into any other
 * response — it is only ever read here and decoded to raw bytes.
 */
export async function getUserAvatar(
  db: Database,
  userId: string,
): Promise<AvatarData | null> {
  const rows = await db
    .select({
      mime: users.avatarMime,
      data: userAvatars.data,
      updatedAt: userAvatars.updatedAt,
    })
    .from(users)
    .innerJoin(userAvatars, eq(userAvatars.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row || !row.mime) {
    return null;
  }

  const bytes = Buffer.from(row.data, 'base64');
  const etag = `"${userId}-${row.updatedAt.getTime()}"`;
  return { mime: row.mime, bytes, etag };
}
