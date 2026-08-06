import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { users, type UserRow } from '../src/db/schema.js';
import {
  completeSsoJoin,
  coreRoleClaimWarning,
  effectiveMembership,
  elevateRole,
  mapCoreRole,
  parseCoreRole,
  parseMembershipClaims,
  resolveSsoLogin,
  type SsoIdentity,
} from '../src/services/authService.js';
import { updateRegistrationSettings } from '../src/services/settingsService.js';

function identity(overrides: Partial<SsoIdentity> & { sub: string }): SsoIdentity {
  return {
    email: `${overrides.sub}@example.com`,
    emailVerified: true,
    phoneNumber: null,
    phoneNumberVerified: false,
    name: 'Syna 用户',
    picture: null,
    coreRole: 'user',
    membershipTier: 'none',
    membershipExpiresAt: null,
    idToken: 'test-id-token',
    ...overrides,
  };
}

describe('Syna ID claims never block the login', () => {
  it('accepts the four Core roles and floors anything else at user', () => {
    expect(parseCoreRole('user')).toBe('user');
    expect(parseCoreRole('staff')).toBe('staff');
    expect(parseCoreRole('admin')).toBe('admin');
    expect(parseCoreRole('super_admin')).toBe('super_admin');
    // A missing `roles` scope is ordinary-user per spec §2.3; an unknown value
    // cannot mean "more than user" either. Neither may cost the user a login.
    expect(parseCoreRole(undefined)).toBe('user');
    expect(parseCoreRole('root')).toBe('user');
    expect(coreRoleClaimWarning('admin')).toBeNull();
    expect(coreRoleClaimWarning(undefined)).toMatch(/roles scope/);
    expect(coreRoleClaimWarning('root')).toMatch(/未知的 role claim/);
  });

  it('accepts every contract tier including max', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(parseMembershipClaims('none', null)).toEqual({
      membershipTier: 'none',
      membershipExpiresAt: null,
    });
    expect(parseMembershipClaims('plus', future).membershipTier).toBe('plus');
    expect(parseMembershipClaims('pro', future).membershipTier).toBe('pro');
    expect(parseMembershipClaims('max', future).membershipTier).toBe('max');
  });

  it('degrades an absent, unusable or expired tier to free instead of throwing', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    // Scope not granted at all.
    expect(parseMembershipClaims(undefined, undefined)).toEqual({
      membershipTier: 'none',
      membershipExpiresAt: null,
    });
    for (const [tier, expires] of [
      ['ultra', future],
      ['none', future],
      ['pro', null],
      ['pro', '2099-02-30T00:00:00Z'],
      ['pro', new Date(Date.now() - 1).toISOString()],
    ] as const) {
      const parsed = parseMembershipClaims(tier, expires);
      expect(parsed.membershipTier).toBe('none');
      expect(parsed.membershipExpiresAt).toBeNull();
      expect(parsed.warning).toBeTruthy();
    }
  });

  it('invalidates a paid tier immediately when its persisted expiry passes', () => {
    expect(effectiveMembership('pro', new Date(Date.now() + 1_000))).toBe('pro');
    expect(effectiveMembership('pro', new Date(Date.now() - 1))).toBe('none');
    expect(effectiveMembership('none', null)).toBe('none');
  });
});

describe('Core/local higher-wins role mapping', () => {
  it('maps Core admin automatically and treats staff as a member', () => {
    expect(mapCoreRole('user')).toBe('member');
    expect(mapCoreRole('staff')).toBe('member');
    expect(mapCoreRole('admin')).toBe('admin');
    expect(mapCoreRole('super_admin')).toBe('super_admin');
  });

  it('preserves local admin elevation but never accepts local super_admin', () => {
    expect(elevateRole('admin', 'user')).toBe('admin');
    expect(elevateRole('member', 'admin')).toBe('admin');
    expect(elevateRole('super_admin', 'user')).toBe('member');
    expect(elevateRole('admin', 'super_admin')).toBe('super_admin');
  });
});

describe('resolveSsoLogin — permanent sub + authoritative sync', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  async function seed(values: Partial<UserRow> & { email: string }): Promise<UserRow> {
    const [row] = await ctx.db
      .insert(users)
      .values({
        passwordHash: null,
        displayName: values.displayName ?? values.email,
        avatarColor: '#0b0b0c',
        role: values.role ?? 'member',
        coreRole: values.coreRole ?? 'user',
        localRole: values.localRole ?? null,
        isActive: values.isActive ?? true,
        synapslySub: values.synapslySub ?? null,
        ...values,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  it('provisions a brand-new Core admin directly as an effective admin', async () => {
    const res = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-a', email: 'a@x.io', coreRole: 'admin' }),
    );
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('unreachable');
    expect(res.user).toMatchObject({ coreRole: 'admin', localRole: null, role: 'admin' });
  });

  it('keeps exactly one SA and replaces a stale Core holder atomically', async () => {
    const first = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-old-sa', email: 'old@x.io', coreRole: 'super_admin' }),
    );
    const second = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-new-sa', email: 'new@x.io', coreRole: 'super_admin' }),
    );
    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('unreachable');
    const all = await ctx.db.select().from(users);
    expect(all.filter((user) => user.role === 'super_admin')).toHaveLength(1);
    expect(all.find((user) => user.id === first.user.id)).toMatchObject({
      coreRole: 'user',
      role: 'member',
    });
    expect(all.find((user) => user.id === second.user.id)).toMatchObject({
      coreRole: 'super_admin',
      localRole: null,
      role: 'super_admin',
    });
  });

  it('sends a brand-new user/staff identity through the workspace join gate', async () => {
    expect(await resolveSsoLogin(ctx.db, identity({ sub: 'sub-u' }))).toMatchObject({
      status: 'needs-join',
    });
    expect(
      await resolveSsoLogin(ctx.db, identity({ sub: 'sub-staff', coreRole: 'staff' })),
    ).toMatchObject({ status: 'needs-join' });
  });

  it('force-syncs identity, role and membership while preserving local display fields', async () => {
    const original = await seed({
      email: 'old@x.io',
      emailVerified: false,
      synapslySub: 'sub-sync',
      displayName: '本地昵称',
      synaPictureUrl: 'https://accounts.synapsly.org/old-picture',
      coreRole: 'user',
      role: 'member',
    });
    const expiry = new Date(Date.now() + 86_400_000);
    const res = await resolveSsoLogin(
      ctx.db,
      identity({
        sub: 'sub-sync',
        email: 'new@x.io',
        emailVerified: true,
        phoneNumber: '+12025550123',
        phoneNumberVerified: true,
        name: 'Core 新昵称',
        picture: 'https://accounts.synapsly.org/new-picture',
        coreRole: 'admin',
        membershipTier: 'pro',
        membershipExpiresAt: expiry,
      }),
    );
    if (res.status !== 'ok') throw new Error('unreachable');
    expect(res.user).toMatchObject({
      id: original.id,
      email: 'new@x.io',
      emailVerified: true,
      phoneNumber: '+12025550123',
      phoneNumberVerified: true,
      displayName: '本地昵称',
      synaPictureUrl: 'https://accounts.synapsly.org/old-picture',
      coreRole: 'admin',
      role: 'admin',
      membershipTier: 'pro',
    });
    expect(res.user.membershipExpiresAt?.toISOString()).toBe(expiry.toISOString());
    expect(res.user.identitySyncedAt).toBeInstanceOf(Date);
  });

  it('seeds the Syna avatar on a legacy row at its first sync, then never again', async () => {
    // Legacy/pre-provisioned rows (identity_synced_at null, no avatar of any
    // kind) reach their first Syna login through the sync path, not through
    // provisioning — they must still inherit the Syna ID picture (§2.4).
    await seed({
      email: 'legacy@x.io',
      synapslySub: 'sub-legacy',
      displayName: '老账号',
      identitySyncedAt: null,
    });
    const first = await resolveSsoLogin(
      ctx.db,
      identity({
        sub: 'sub-legacy',
        email: 'legacy@x.io',
        picture: 'https://accounts.synapsly.org/avatars/3.svg',
      }),
    );
    if (first.status !== 'ok') throw new Error('unreachable');
    expect(first.user.synaPictureUrl).toBe('https://accounts.synapsly.org/avatars/3.svg');
    expect(first.user.identitySyncedAt).toBeInstanceOf(Date);

    const second = await resolveSsoLogin(
      ctx.db,
      identity({
        sub: 'sub-legacy',
        email: 'legacy@x.io',
        picture: 'https://accounts.synapsly.org/avatars/9.svg',
      }),
    );
    if (second.status !== 'ok') throw new Error('unreachable');
    expect(second.user.synaPictureUrl).toBe('https://accounts.synapsly.org/avatars/3.svg');
  });

  it('leaves an uploaded Coboard avatar alone even on a first sync', async () => {
    await seed({
      email: 'uploaded@x.io',
      synapslySub: 'sub-uploaded',
      avatarMime: 'image/png',
      identitySyncedAt: null,
    });
    const res = await resolveSsoLogin(
      ctx.db,
      identity({
        sub: 'sub-uploaded',
        email: 'uploaded@x.io',
        picture: 'https://accounts.synapsly.org/avatars/3.svg',
      }),
    );
    if (res.status !== 'ok') throw new Error('unreachable');
    expect(res.user.synaPictureUrl).toBeNull();
  });

  it('applies higher-wins without retaining a former Core-only admin baseline', async () => {
    await seed({
      email: 'local@x.io',
      synapslySub: 'sub-local',
      localRole: 'admin',
      coreRole: 'user',
      role: 'admin',
    });
    const local = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-local', email: 'local@x.io' }),
    );
    if (local.status !== 'ok') throw new Error('unreachable');
    expect(local.user.role).toBe('admin');

    await seed({
      email: 'core@x.io',
      synapslySub: 'sub-core',
      localRole: null,
      coreRole: 'admin',
      role: 'admin',
    });
    const demoted = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-core', email: 'core@x.io' }),
    );
    if (demoted.status !== 'ok') throw new Error('unreachable');
    expect(demoted.user).toMatchObject({ coreRole: 'user', localRole: null, role: 'member' });
  });

  it('links by verified email once, never by an unverified or already-bound email', async () => {
    const linkedTarget = await seed({ email: 'link@x.io' });
    const linked = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-link', email: 'link@x.io', coreRole: 'admin' }),
    );
    if (linked.status !== 'ok') throw new Error('unreachable');
    expect(linked.user.id).toBe(linkedTarget.id);
    expect(linked.user.synapslySub).toBe('sub-link');

    await seed({ email: 'unverified@x.io' });
    expect(
      await resolveSsoLogin(
        ctx.db,
        identity({ sub: 'sub-unverified', email: 'unverified@x.io', emailVerified: false }),
      ),
    ).toMatchObject({ status: 'needs-join' });

    await seed({ email: 'bound@x.io', synapslySub: 'sub-owner' });
    await expect(
      resolveSsoLogin(
        ctx.db,
        identity({ sub: 'sub-attacker', email: 'bound@x.io', coreRole: 'admin' }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses an inactive ordinary user but reactivates the verified Core SA', async () => {
    await seed({ email: 'off@x.io', synapslySub: 'sub-off', isActive: false });
    await expect(
      resolveSsoLogin(ctx.db, identity({ sub: 'sub-off', email: 'off@x.io' })),
    ).rejects.toMatchObject({ statusCode: 401 });

    await seed({ email: 'sa@x.io', synapslySub: 'sub-sa', isActive: false });
    const sa = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-sa', email: 'sa@x.io', coreRole: 'super_admin' }),
    );
    if (sa.status !== 'ok') throw new Error('unreachable');
    expect(sa.user).toMatchObject({ role: 'super_admin', isActive: true });
  });
});

describe('completeSsoJoin', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
    await updateRegistrationSettings(ctx.db, {
      registrationEnabled: true,
      registrationCode: 'team-secret-2026',
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('provisions a verified member and is idempotent by sub', async () => {
    const id = identity({ sub: 'sub-join', email: 'join@x.io' });
    const first = await completeSsoJoin(ctx.db, id, 'team-secret-2026');
    const second = await completeSsoJoin(ctx.db, id, 'wrong-after-success');
    expect(first).toMatchObject({ coreRole: 'user', localRole: null, role: 'member' });
    expect(second.id).toBe(first.id);
  });

  it('rejects unverified email provisioning', async () => {
    await expect(
      completeSsoJoin(
        ctx.db,
        identity({ sub: 'sub-noverify', emailVerified: false }),
        'team-secret-2026',
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
