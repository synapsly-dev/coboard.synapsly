import { eq } from 'drizzle-orm';
import type { ChangePasswordInput, LoginInput, SetupInput } from 'shared';
import type { Database } from '../db/index.js';
import { users, type UserRow } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  createSession,
  deleteUserSessions,
  type CreatedSession,
} from '../auth/session.js';
import { conflict, unauthorized, validationError } from '../lib/errors.js';
import { countUsers, createUser, findUserByEmail, findUserById } from './userService.js';

/**
 * Authentication domain service (§7 setup/auth, §8). Verifies credentials with
 * argon2, mints server-side sessions, performs first-run admin bootstrap, and
 * lets a user rotate their own password. Cookie wiring lives in the routes; this
 * layer never touches Fastify.
 */

export interface AuthenticatedUser {
  user: UserRow;
  session: CreatedSession;
}

/**
 * First-run setup (§8): create the very first account as a global admin. Only
 * permitted while the users table is empty; otherwise throws 409. Issues a
 * session for the freshly created admin so the browser is logged in immediately.
 */
export async function setupFirstAdmin(
  db: Database,
  input: SetupInput,
): Promise<AuthenticatedUser> {
  const total = await countUsers(db);
  if (total > 0) {
    throw conflict('系统已初始化，无法重复创建首个管理员');
  }

  const user = await createUser(db, {
    email: input.email,
    password: input.password,
    displayName: input.displayName,
    role: 'admin',
  });
  const session = await createSession(db, user.id);
  return { user, session };
}

/**
 * Verify email + password and mint a session (§8). Returns a generic 401 on any
 * failure (missing user, wrong password, deactivated account) so the endpoint
 * never reveals which emails exist.
 */
export async function login(
  db: Database,
  input: LoginInput,
): Promise<AuthenticatedUser> {
  const user = await findUserByEmail(db, input.email);
  if (!user) {
    throw unauthorized('邮箱或密码错误');
  }

  const ok = await verifyPassword(user.passwordHash, input.password);
  if (!ok) {
    throw unauthorized('邮箱或密码错误');
  }

  if (!user.isActive) {
    throw unauthorized('账号已被停用，请联系管理员');
  }

  const session = await createSession(db, user.id);
  return { user, session };
}

/**
 * Change the current user's password (§7 POST /auth/password). Verifies the
 * current password, stores a new argon2 hash, and revokes all other sessions so
 * a compromised password cannot keep an old session alive.
 */
export async function changeOwnPassword(
  db: Database,
  currentUser: UserRow,
  input: ChangePasswordInput,
): Promise<void> {
  const ok = await verifyPassword(currentUser.passwordHash, input.currentPassword);
  if (!ok) {
    throw validationError('当前密码不正确', {
      currentPassword: ['当前密码不正确'],
    });
  }

  const newHash = await hashPassword(input.newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash })
    .where(eq(users.id, currentUser.id));

  // Invalidate every existing session; the route re-issues a fresh one so the
  // user stays logged in on the device that initiated the change.
  await deleteUserSessions(db, currentUser.id);
}

/** Re-read a user row after a mutation (used to return fresh state). */
export async function reloadUser(
  db: Database,
  id: string,
): Promise<UserRow | null> {
  return findUserById(db, id);
}
