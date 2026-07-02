import { timingSafeEqual } from 'node:crypto';
import type { UserRole } from 'shared';
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
  setUserRole,
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
  { status: 'ok'; user: UserRow } | { status: 'needs-join'; identity: SsoIdentity };

/**
 * Map Synapsly's baseline platform role (the `role` claim carried by the `roles`
 * scope — `user | admin | super_admin`) onto coboard's local role vocabulary
 * (`member | admin`). coboard has no tier above `admin`, so both `admin` and
 * `super_admin` land on `admin`; a missing/unknown claim maps to `member` — the
 * no-op floor that keeps things correct before core emits the `role` claim.
 */
const CORE_ROLE_TO_LOCAL: Record<string, UserRole> = {
  user: 'member',
  admin: 'admin',
  super_admin: 'admin',
};

/** Local role ordering used by the floor. Higher wins. */
const ROLE_RANK: Record<UserRole, number> = { member: 0, admin: 1 };

/** Map a raw Synapsly `role` claim to a local role (baseline `member`). */
export function mapCoreRole(coreRole: string | null | undefined): UserRole {
  return CORE_ROLE_TO_LOCAL[(coreRole ?? '').trim()] ?? 'member';
}

/**
 * Fold Synapsly's baseline role into the local role as a *floor*.
 *
 * The core role is only a baseline: a coboard admin may locally elevate a
 * specific user beyond it, so we take the HIGHER of the existing local role and
 * the mapped core baseline — never downgrading a locally-granted admin. A
 * missing/unknown core role maps to `member` (a no-op floor), which also keeps
 * things correct before the `roles` scope is live on core.
 */
export function elevateRole(
  current: UserRole | null | undefined,
  coreRole: string | null | undefined,
): UserRole {
  const baseline = mapCoreRole(coreRole);
  const cur = current ?? 'member';
  return ROLE_RANK[baseline] > ROLE_RANK[cur] ? baseline : cur;
}

/**
 * Apply the role floor to an existing user on login and persist it if it changed.
 * Idempotent: returns the same row untouched when the floor is a no-op.
 */
async function applyRoleFloor(
  db: Database,
  user: UserRow,
  coreRole: string | null,
): Promise<UserRow> {
  const next = elevateRole(user.role, coreRole);
  if (next === user.role) return user;
  return setUserRole(db, user.id, next);
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
 *   2. else by verified email → link the sub to that existing row
 *   3. else provision: admin if the Synapsly `role` claim maps to admin,
 *      otherwise defer to the invite-code join flow (`needs-join`).
 *
 * On every existing-user path the Synapsly `role` claim is folded into the local
 * role as a floor (see {@link elevateRole}): a core promotion elevates the user,
 * a lower/absent core role never downgrades a locally-granted admin. Deactivated
 * accounts are refused.
 */
export async function resolveSsoLogin(db: Database, identity: SsoIdentity): Promise<SsoResolution> {
  // 1. Known Synapsly subject.
  const bySub = await findUserBySynapslySub(db, identity.sub);
  if (bySub) {
    if (!bySub.isActive) throw unauthorized('账号已被停用，请联系管理员');
    return { status: 'ok', user: await applyRoleFloor(db, bySub, identity.role) };
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
      return { status: 'ok', user: await applyRoleFloor(db, linked, identity.role) };
    }
  }

  // 3. Brand-new person. The core role's floor seeds the local role: a Synapsly
  // admin/super_admin is provisioned straight as a coboard admin (skipping the
  // code); a plain `user` (or an absent role claim) defers to the invite-code
  // join flow.
  if (mapCoreRole(identity.role) === 'admin') {
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
    registrationEnabled && registrationCode.length > 0 && codeMatches(code, registrationCode);
  if (!allowed) {
    throw forbidden('邀请码无效或自助加入未开放，请联系管理员');
  }

  const email = identity.email?.toLowerCase() ?? null;
  if (!email) throw forbidden('缺少可用于建号的已验证邮箱');

  return createSsoUser(db, {
    email,
    displayName: displayNameFor(identity),
    // Seed from the core floor (a plain `user`/absent claim → `member`).
    role: mapCoreRole(identity.role),
    synapslySub: identity.sub,
  });
}

/**
 * Dev fake-login (non-production only). Finds the user by email or creates one as
 * an admin so local testing has full access. Keeps the app runnable offline; the
 * route hard-guards on DEV_LOGIN + non-production.
 */
export async function devLogin(
  db: Database,
  input: { email: string; displayName?: string | undefined },
): Promise<UserRow> {
  const email = input.email.toLowerCase();
  const existing = await findUserByEmail(db, email);
  if (existing) {
    if (!existing.isActive) throw unauthorized('账号已被停用');
    return existing;
  }
  return createSsoUser(db, {
    email,
    displayName: input.displayName?.trim() || email.split('@')[0] || '开发用户',
    role: 'admin',
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
