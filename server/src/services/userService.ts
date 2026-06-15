import { asc, eq, sql } from 'drizzle-orm';
import type {
  CreateUserInput,
  UpdateUserInput,
  User,
  UserProjectMembership,
  UserWithProjects,
} from 'shared';
import type { Database } from '../db/index.js';
import { projectMembers, projects, users, type UserRow } from '../db/schema.js';
import { hashPassword } from '../auth/password.js';
import { deleteUserSessions } from '../auth/session.js';
import { conflict, notFound } from '../lib/errors.js';

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
  password: string;
  displayName: string;
  role: 'admin' | 'member';
  avatarColor?: string | undefined;
}

/**
 * Create a user account with a hashed initial password. Throws 409 on a
 * duplicate email. Used both by first-run setup (forces role=admin) and by the
 * admin user-management endpoint.
 */
export async function createUser(
  db: Database,
  params: CreateUserParams,
): Promise<UserRow> {
  const existing = await findUserByEmail(db, params.email);
  if (existing) {
    throw conflict('该邮箱已被注册');
  }

  const passwordHash = await hashPassword(params.password);
  const avatarColor = params.avatarColor ?? pickAvatarColor(params.email);

  const inserted = await db
    .insert(users)
    .values({
      email: params.email,
      passwordHash,
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
    password: input.password,
    displayName: input.displayName,
    role: input.role ?? 'member',
    avatarColor: input.avatarColor,
  };
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
