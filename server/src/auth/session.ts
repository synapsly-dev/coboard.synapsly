import { randomBytes } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { sessions, users, type UserRow } from '../db/schema.js';

/**
 * Server-side session management (§8). A session is a random token row in the
 * `sessions` table; the token is delivered to the browser as a signed, httpOnly,
 * SameSite=Lax cookie that holds only the token. Logout deletes the row.
 */

/** Cookie name carrying the (signed) session token. */
export const SESSION_COOKIE = 'coboard_session';

/** Session lifetime: 30 days. Touch on use to implement sliding expiry. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Generate a high-entropy opaque session token. */
function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

/** Create a new session row for a user and return its token + expiry. */
export async function createSession(
  db: Database,
  userId: string,
): Promise<CreatedSession> {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    id: token,
    userId,
    expiresAt,
    lastSeenAt: now,
  });
  return { token, expiresAt };
}

export interface SessionLookup {
  user: UserRow;
  sessionId: string;
  expiresAt: Date;
}

/**
 * Look up a session by token, returning the associated active user. Returns null
 * if the session is missing, expired, or the user is deactivated.
 */
export async function lookupSession(
  db: Database,
  token: string,
): Promise<SessionLookup | null> {
  const now = new Date();
  const rows = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, now)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (!row.user.isActive) return null;

  return {
    user: row.user,
    sessionId: row.session.id,
    expiresAt: row.session.expiresAt,
  };
}

/** Update `last_seen_at` (sliding-window bookkeeping). Best-effort. */
export async function touchSession(db: Database, token: string): Promise<void> {
  await db
    .update(sessions)
    .set({ lastSeenAt: new Date() })
    .where(eq(sessions.id, token));
}

/** Delete a session row (logout). */
export async function deleteSession(db: Database, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, token));
}

/** Delete all sessions for a user (e.g. on deactivation or password change). */
export async function deleteUserSessions(
  db: Database,
  userId: string,
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Cookie options for the session cookie. `Secure` is enabled in production so the
 * cookie is only sent over HTTPS; SameSite=Lax + httpOnly mitigate CSRF/XSS (§8).
 */
export function sessionCookieOptions(opts: {
  expiresAt: Date;
  production: boolean;
}): {
  path: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  signed: true;
  expires: Date;
} {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.production,
    signed: true,
    expires: opts.expiresAt,
  };
}

/** Options used when clearing the cookie on logout. */
export function clearSessionCookieOptions(production: boolean): {
  path: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  signed: true;
} {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: production,
    signed: true,
  };
}
