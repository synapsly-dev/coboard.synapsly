import { timingSafeEqual } from 'node:crypto';
import type { Database } from '../db/index.js';
import type { UserRow } from '../db/schema.js';
import { createSession, type CreatedSession } from '../auth/session.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { getRegistrationSettings } from './settingsService.js';
import {
  createSsoUser,
  findUserByEmail,
  findUserBySynapslySub,
  linkSynapslySub,
} from './userService.js';

/**
 * Authentication domain service. With Synapsly ID SSO, this layer no longer
 * touches passwords: it maps a verified Synapsly identity onto a local user
 * (matching by `synapsly_sub`, then verified email, else provisioning), decides
 * admin-ness from the `role` claim / email allowlist, and gates brand-new members
 * behind the admin's invite code. Cookie/session wiring lives in the routes.
 */

/** A verified identity distilled from the OIDC id_token + userinfo. */
export interface SsoIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  /** Synapsly-side role, if the provider emits it: `user|admin|super_admin`. */
  role: string | null;
  /** The raw id_token, stored on the session for RP-initiated logout. */
  idToken: string;
}

export interface AuthenticatedUser {
  user: UserRow;
  session: CreatedSession;
}

/**
 * Outcome of resolving an SSO identity: either an existing/eligible user we can
 * log in, or a brand-new person who must supply the invite code to join.
 */
export type SsoResolution =
  | { status: 'ok'; user: UserRow }
  | { status: 'needs-join'; identity: SsoIdentity };

/** A Synapsly role that should map to a coboard global admin. */
function isAdminRole(role: string | null): boolean {
  return role === 'admin' || role === 'super_admin';
}

function displayNameFor(identity: SsoIdentity): string {
  const name = identity.name?.trim();
  if (name) return name;
  const local = identity.email?.split('@')[0]?.trim();
  return local && local.length > 0 ? local : 'Synapsly 用户';
}

/**
 * Resolve a verified Synapsly identity to a local user (§2 of the design):
 *   1. match by `synapsly_sub` → returning user
 *   2. else by verified email → link the sub to that existing row (keeps role)
 *   3. else provision: admin if role-claim/allowlist says so, otherwise defer to
 *      the invite-code join flow (`needs-join`).
 * Deactivated accounts are refused.
 */
export async function resolveSsoLogin(
  db: Database,
  identity: SsoIdentity,
  adminEmails: string[],
): Promise<SsoResolution> {
  // 1. Known Synapsly subject.
  const bySub = await findUserBySynapslySub(db, identity.sub);
  if (bySub) {
    if (!bySub.isActive) throw unauthorized('账号已被停用，请联系管理员');
    return { status: 'ok', user: bySub };
  }

  const email = identity.email?.toLowerCase() ?? null;

  // 2. Existing local account with the same verified email → link.
  if (identity.emailVerified && email) {
    const byEmail = await findUserByEmail(db, email);
    if (byEmail) {
      if (byEmail.synapslySub && byEmail.synapslySub !== identity.sub) {
        throw forbidden('该邮箱已关联其他 Synapsly 账号');
      }
      if (!byEmail.isActive) throw unauthorized('账号已被停用，请联系管理员');
      const linked = byEmail.synapslySub
        ? byEmail
        : await linkSynapslySub(db, byEmail.id, identity.sub);
      return { status: 'ok', user: linked };
    }
  }

  // 3. Brand-new person. Admins skip the code; everyone else must join with it.
  const isAdmin =
    isAdminRole(identity.role) ||
    (identity.emailVerified && email !== null && adminEmails.includes(email));
  if (isAdmin) {
    if (!email) throw forbidden('缺少可用于建号的已验证邮箱');
    const user = await createSsoUser(db, {
      email,
      displayName: displayNameFor(identity),
      role: 'admin',
      synapslySub: identity.sub,
    });
    return { status: 'ok', user };
  }

  return { status: 'needs-join', identity };
}

/** Constant-time compare that never short-circuits on length. */
function codeMatches(submitted: string, expected: string): boolean {
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Provision a brand-new member from a pending SSO identity + the admin invite
 * code. Self-join must be enabled AND a non-empty code configured AND the code
 * match; a failed gate returns a single generic 403. Races (the account got
 * created meanwhile) resolve to a normal login.
 */
export async function completeSsoJoin(
  db: Database,
  identity: SsoIdentity,
  code: string,
): Promise<UserRow> {
  // If they already exist now (double-submit / race), just log them in.
  const existing = await findUserBySynapslySub(db, identity.sub);
  if (existing) {
    if (!existing.isActive) throw unauthorized('账号已被停用，请联系管理员');
    return existing;
  }

  const { registrationEnabled, registrationCode } = await getRegistrationSettings(db);
  const allowed =
    registrationEnabled &&
    registrationCode.length > 0 &&
    codeMatches(code, registrationCode);
  if (!allowed) {
    throw forbidden('邀请码无效或自助加入未开放，请联系管理员');
  }

  const email = identity.email?.toLowerCase() ?? null;
  if (!email) throw forbidden('缺少可用于建号的已验证邮箱');

  return createSsoUser(db, {
    email,
    displayName: displayNameFor(identity),
    role: 'member',
    synapslySub: identity.sub,
  });
}

/**
 * Dev fake-login (non-production only). Finds the user by email or creates one,
 * making them an admin if their email is in the allowlist. Used to keep the app
 * runnable offline; the route hard-guards on DEV_LOGIN + non-production.
 */
export async function devLogin(
  db: Database,
  input: { email: string; displayName?: string | undefined },
  adminEmails: string[],
): Promise<UserRow> {
  const email = input.email.toLowerCase();
  const existing = await findUserByEmail(db, email);
  if (existing) {
    if (!existing.isActive) throw unauthorized('账号已被停用');
    return existing;
  }
  const role = adminEmails.includes(email) ? 'admin' : 'member';
  return createSsoUser(db, {
    email,
    displayName: input.displayName?.trim() || email.split('@')[0] || '开发用户',
    role,
    synapslySub: `dev:${email}`,
  });
}

/** Create a session for a resolved user, stamping the id_token for logout. */
export async function startSession(
  db: Database,
  userId: string,
  idToken: string | null,
): Promise<CreatedSession> {
  return createSession(db, userId, idToken);
}
