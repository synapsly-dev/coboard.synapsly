import { timingSafeEqual } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import type { CoreRole, LocalUserRole, MembershipTier, UserRole } from 'shared';
import type { Database } from '../db/index.js';
import { users, type UserRow } from '../db/schema.js';
import { createSession, type CreatedSession } from '../auth/session.js';
import { conflict, forbidden, unauthorized } from '../lib/errors.js';
import { getRegistrationSettings } from './settingsService.js';
import {
  createSsoUser,
  findSuperAdmin,
  findUserByEmail,
  findUserBySynapslySub,
} from './userService.js';

/** A verified, complete identity snapshot distilled from ID Token + UserInfo. */
export interface SsoIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  name: string | null;
  picture: string | null;
  coreRole: CoreRole;
  membershipTier: MembershipTier;
  membershipExpiresAt: Date | null;
  /** Raw ID token retained only for RP-initiated logout. */
  idToken: string;
}

export interface AuthenticatedUser {
  user: UserRow;
  session: CreatedSession;
}

export type SsoResolution =
  { status: 'ok'; user: UserRow } | { status: 'needs-join'; identity: SsoIdentity };

const CORE_ROLES = new Set<CoreRole>(['user', 'staff', 'admin', 'super_admin']);
const LOCAL_ROLES = new Set<LocalUserRole>(['member', 'admin']);
const MEMBERSHIP_TIERS = new Set<MembershipTier>(['none', 'plus', 'pro', 'max']);
const ROLE_RANK: Record<UserRole, number> = { member: 0, admin: 1, super_admin: 2 };
const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isValidRfc3339(value: string): boolean {
  const match = RFC3339.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second, offsetHour = 0, offsetMinute = 0] = match
    .slice(1)
    .map((part) => Number.parseInt(part ?? '0', 10));
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return false;
  }
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return (
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day
  );
}

/**
 * Resolve the Core baseline role at the OIDC trust boundary.
 *
 * Degrades to the `user` floor rather than refusing the login: the Syna App Spec
 * §2.3 defines "no `roles` scope" as ordinary user, and an unknown future role
 * value is not something Coboard can safely interpret as *more* than a user
 * either. Both cases therefore land on the least-privileged role — a demotion is
 * recoverable by fixing the client's `allowed_scopes`, whereas throwing here
 * locks every account out of the app.
 */
export function parseCoreRole(value: unknown): CoreRole {
  if (typeof value === 'string' && CORE_ROLES.has(value as CoreRole)) {
    return value as CoreRole;
  }
  return 'user';
}

/**
 * Why a `role` claim did not survive {@link parseCoreRole}, or null when it did.
 * Both outcomes are operator misconfiguration (a narrowed `allowed_scopes`, or a
 * Core role Coboard has not been taught), so they belong in the server log.
 */
export function coreRoleClaimWarning(value: unknown): string | null {
  if (value === undefined) return 'role claim 缺失（客户端可能未获授 roles scope），按 user 处理';
  if (typeof value !== 'string' || !CORE_ROLES.has(value as CoreRole)) {
    return `未知的 role claim：${String(value)}，按 user 处理`;
  }
  return null;
}

/**
 * Resolve the membership tier/expiry pair emitted by Syna ID.
 *
 * Membership is display-only data (Syna App Spec §5.2: the local tier copy takes
 * part in no hot-path decision), so an absent, unknown or already-expired pair
 * degrades to the free tier instead of failing the login. Core settles expiry
 * lazily and clocks drift; neither may cost a user their session. `warning`
 * carries the reason so the caller can log why a paid tier was not honored.
 */
export function parseMembershipClaims(
  tierRaw: unknown,
  expiresRaw: unknown,
  now = Date.now(),
): { membershipTier: MembershipTier; membershipExpiresAt: Date | null; warning?: string } {
  const free = { membershipTier: 'none' as const, membershipExpiresAt: null };
  if (tierRaw === undefined && expiresRaw === undefined) {
    // The whole claim family is absent — the `membership` scope was not granted.
    return free;
  }
  if (typeof tierRaw !== 'string' || !MEMBERSHIP_TIERS.has(tierRaw as MembershipTier)) {
    return { ...free, warning: `未知的 membership_tier：${String(tierRaw)}` };
  }
  const tier = tierRaw as MembershipTier;
  if (tier === 'none') {
    return expiresRaw === null || expiresRaw === undefined
      ? free
      : { ...free, warning: 'none 会员携带了非空 membership_expires_at' };
  }
  if (typeof expiresRaw !== 'string' || !isValidRfc3339(expiresRaw)) {
    return { ...free, warning: `${tier} 会员缺少合法的 membership_expires_at` };
  }
  const membershipExpiresAt = new Date(expiresRaw);
  if (!Number.isFinite(membershipExpiresAt.getTime())) {
    return { ...free, warning: 'membership_expires_at 格式非法' };
  }
  if (membershipExpiresAt.getTime() <= now) {
    return { ...free, warning: `${tier} 会员已于 ${expiresRaw} 到期` };
  }
  return { membershipTier: tier, membershipExpiresAt };
}

/** Expired/invalid persisted paid membership is never effective in an open session. */
export function effectiveMembership(
  tier: MembershipTier | string | null | undefined,
  expiresAt: Date | null | undefined,
  now = Date.now(),
): MembershipTier {
  if (typeof tier !== 'string' || !MEMBERSHIP_TIERS.has(tier as MembershipTier)) return 'none';
  const known = tier as MembershipTier;
  if (known === 'none') return 'none';
  if (!expiresAt || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now) {
    return 'none';
  }
  return known;
}

/** Map Syna ID's baseline vocabulary onto Coboard's effective-role vocabulary. */
export function mapCoreRole(coreRole: string | null | undefined): UserRole {
  if (coreRole === 'super_admin') return 'super_admin';
  if (coreRole === 'admin') return 'admin';
  return 'member'; // staff intentionally has ordinary-member permissions here.
}

export function normalizeLocalRole(value: string | null | undefined): LocalUserRole | null {
  return LOCAL_ROLES.has(value as LocalUserRole) ? (value as LocalUserRole) : null;
}

/** Effective RBAC is the higher of the fresh Core baseline and local elevation. */
export function elevateRole(
  localRole: UserRole | null | undefined,
  coreRole: string | null | undefined,
): UserRole {
  const baseline = mapCoreRole(coreRole);
  // Never accept a local super_admin value, including from legacy/corrupt data.
  const local: UserRole = normalizeLocalRole(localRole) ?? 'member';
  return ROLE_RANK[baseline] >= ROLE_RANK[local] ? baseline : local;
}

function displayNameFor(identity: SsoIdentity): string {
  const name = identity.name?.trim();
  if (name) return Array.from(name).slice(0, 80).join('');
  const local = identity.email.split('@')[0]?.trim();
  return local || 'Syna ID 用户';
}

/**
 * Demote any stale/legacy highest-role holder before installing the one current
 * verified Core SA. This preserves both unique indexes and ensures no app-local
 * value can manufacture super_admin authority.
 */
async function clearOtherSuperAdmins(tx: Database, currentUserId: string | null): Promise<void> {
  const holders = await tx
    .select()
    .from(users)
    .where(or(eq(users.coreRole, 'super_admin'), eq(users.role, 'super_admin')));
  for (const holder of holders) {
    if (holder.id === currentUserId) continue;
    const localRole = normalizeLocalRole(holder.localRole);
    await tx
      .update(users)
      .set({ coreRole: 'user', localRole, role: elevateRole(localRole, 'user') })
      .where(eq(users.id, holder.id));
  }
}

/**
 * Seed the Syna picture on the row's FIRST identity sync, and only then.
 *
 * Spec §2.4 cuts both ways: later logins must not overwrite a local avatar, but
 * the first login must actually land one. Rows that predate SSO (legacy accounts,
 * and accounts an admin pre-provisioned by email) reach their first Syna login
 * through {@link syncExistingIdentity} rather than through provisioning, so
 * without this they would never inherit the Syna ID avatar at all — which is
 * exactly what happened to every account created before the identity-v2 rollout.
 * `identity_synced_at` is null on precisely those never-synced rows, which makes
 * it the honest marker for "this is the first login"; a user who later deletes
 * their avatar keeps it deleted.
 */
function firstLoginPictureSeed(current: UserRow, identity: SsoIdentity): string | null {
  if (current.identitySyncedAt !== null) return null;
  if (current.avatarMime !== null || current.synaPictureUrl !== null) return null;
  return identity.picture;
}

/** Overwrite every Core-authoritative field while preserving local name/picture customizations. */
async function syncExistingIdentity(
  tx: Database,
  current: UserRow,
  identity: SsoIdentity,
): Promise<UserRow> {
  if (!current.isActive && identity.coreRole !== 'super_admin') {
    throw unauthorized('账号已被停用，请联系管理员');
  }

  const emailOwner = await findUserByEmail(tx, identity.email);
  if (emailOwner && emailOwner.id !== current.id) {
    throw conflict('Syna ID 邮箱与另一 Coboard 账号冲突，请联系管理员处理');
  }

  if (identity.coreRole === 'super_admin') {
    await clearOtherSuperAdmins(tx, current.id);
  }
  const localRole =
    identity.coreRole === 'super_admin' ? null : normalizeLocalRole(current.localRole);
  const pictureSeed = firstLoginPictureSeed(current, identity);
  const updated = await tx
    .update(users)
    .set({
      synapslySub: identity.sub,
      ...(pictureSeed === null ? {} : { synaPictureUrl: pictureSeed }),
      email: identity.email,
      emailVerified: identity.emailVerified,
      phoneNumber: identity.phoneNumber,
      phoneNumberVerified: identity.phoneNumberVerified,
      coreRole: identity.coreRole,
      localRole,
      role: elevateRole(localRole, identity.coreRole),
      membershipTier: identity.membershipTier,
      membershipExpiresAt: identity.membershipTier === 'none' ? null : identity.membershipExpiresAt,
      identitySyncedAt: new Date(),
      // The Core SA is deployment-controlled and cannot remain locally disabled.
      isActive: identity.coreRole === 'super_admin' ? true : current.isActive,
    })
    .where(eq(users.id, current.id))
    .returning();
  if (!updated[0]) throw new Error('同步 Syna ID 身份失败');
  return updated[0];
}

async function provisionIdentity(db: Database, identity: SsoIdentity): Promise<UserRow> {
  if (!identity.emailVerified) {
    throw forbidden('需要已验证的 Syna ID 邮箱才能加入 Coboard');
  }
  return db.transaction(async (tx) => {
    if (identity.coreRole === 'super_admin') await clearOtherSuperAdmins(tx, null);
    return createSsoUser(tx, {
      email: identity.email,
      emailVerified: identity.emailVerified,
      phoneNumber: identity.phoneNumber,
      phoneNumberVerified: identity.phoneNumberVerified,
      displayName: displayNameFor(identity),
      synaPictureUrl: identity.picture,
      synapslySub: identity.sub,
      coreRole: identity.coreRole,
      membershipTier: identity.membershipTier,
      membershipExpiresAt: identity.membershipExpiresAt,
    });
  });
}

/**
 * Resolve by permanent sub first. Verified email is only a one-time bridge for
 * an unlinked legacy/pre-provisioned row. Every returning path force-syncs the
 * Core identity, role and membership snapshot.
 */
export async function resolveSsoLogin(db: Database, identity: SsoIdentity): Promise<SsoResolution> {
  const bySub = await findUserBySynapslySub(db, identity.sub);
  if (bySub) {
    const user = await db.transaction((tx) => syncExistingIdentity(tx, bySub, identity));
    return { status: 'ok', user };
  }

  const byEmail = await findUserByEmail(db, identity.email);
  if (identity.emailVerified && byEmail) {
    if (byEmail.synapslySub && byEmail.synapslySub !== identity.sub) {
      throw forbidden('该邮箱已关联其他 Syna ID 账号');
    }
    const user = await db.transaction((tx) => syncExistingIdentity(tx, byEmail, identity));
    return { status: 'ok', user };
  }

  // Core admins do not need an app-local grant or invite. Staff/user still pass
  // through Coboard's workspace membership gate.
  if (identity.coreRole === 'admin' || identity.coreRole === 'super_admin') {
    return { status: 'ok', user: await provisionIdentity(db, identity) };
  }
  return { status: 'needs-join', identity };
}

function codeMatches(submitted: string, expected: string): boolean {
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function completeSsoJoin(
  db: Database,
  identity: SsoIdentity,
  code: string,
): Promise<UserRow> {
  const existing = await findUserBySynapslySub(db, identity.sub);
  if (existing) {
    return db.transaction((tx) => syncExistingIdentity(tx, existing, identity));
  }

  const { registrationEnabled, registrationCode } = await getRegistrationSettings(db);
  const allowed =
    registrationEnabled && registrationCode.length > 0 && codeMatches(code, registrationCode);
  if (!allowed) throw forbidden('邀请码无效或自助加入未开放，请联系管理员');
  return provisionIdentity(db, identity);
}

/** Non-production fake identity. It mirrors the Core role source in local tests only. */
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
  const isFirst = (await findSuperAdmin(db)) === null;
  return createSsoUser(db, {
    email,
    emailVerified: false,
    phoneNumber: null,
    phoneNumberVerified: false,
    displayName: input.displayName?.trim() || email.split('@')[0] || '开发用户',
    synaPictureUrl: null,
    synapslySub: `dev:${email}`,
    coreRole: isFirst ? 'super_admin' : 'user',
    membershipTier: 'none',
    membershipExpiresAt: null,
  });
}

export async function startSession(
  db: Database,
  userId: string,
  idToken: string | null,
): Promise<CreatedSession> {
  return createSession(db, userId, idToken);
}
