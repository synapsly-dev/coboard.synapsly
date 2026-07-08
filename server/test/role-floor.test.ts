import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { users, type UserRow } from '../src/db/schema.js';
import {
  completeSsoJoin,
  elevateRole,
  mapCoreRole,
  resolveSsoLogin,
  type SsoIdentity,
} from '../src/services/authService.js';
import { updateRegistrationSettings } from '../src/services/settingsService.js';

/**
 * Role-floor + sub-upsert tests for the Synapsly SSO login (AUTHZ model).
 *
 * The Syna ID `role` claim is a BASELINE FLOOR, per the role-tier contract
 * (app-authz-protocol.md §3.0): ONLY `super_admin` maps to coboard's unique
 * highest role (`super_admin`). Core `admin` is merely an "admin candidate" — it does NOT
 * auto-grant local admin (a super_admin assigns that in-app), so it maps to
 * `member`; the reserved `staff` and plain `user` also map to `member`. The
 * mapped baseline is folded in only ever *upward*: a locally-granted admin is
 * never downgraded by a later login carrying a lower/absent core role, and a
 * missing claim is a no-op floor. Users are keyed by the OIDC `sub`; an existing
 * account links only by VERIFIED email and never when already bound to a
 * different sub.
 */

function identity(overrides: Partial<SsoIdentity> & { sub: string }): SsoIdentity {
  return {
    email: null,
    emailVerified: false,
    name: null,
    picture: null,
    role: null,
    idToken: 'test-id-token',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure floor logic
// ---------------------------------------------------------------------------

describe('mapCoreRole', () => {
  it('maps the core vocabulary onto local roles (§3.0)', () => {
    expect(mapCoreRole('user')).toBe('member');
    // core `admin` is only a candidate — no auto-privilege; maps to member.
    expect(mapCoreRole('admin')).toBe('member');
    // reserved tier — treated as a normal user until core defines it.
    expect(mapCoreRole('staff')).toBe('member');
    // super_admin is the only tier that maps to coboard's highest local role.
    expect(mapCoreRole('super_admin')).toBe('super_admin');
  });

  it('maps a missing/unknown/blank claim to the member baseline', () => {
    expect(mapCoreRole(null)).toBe('member');
    expect(mapCoreRole(undefined)).toBe('member');
    expect(mapCoreRole('')).toBe('member');
    expect(mapCoreRole('  ')).toBe('member');
    expect(mapCoreRole('root')).toBe('member');
  });

  it('trims surrounding whitespace before mapping', () => {
    expect(mapCoreRole('  super_admin ')).toBe('super_admin');
    expect(mapCoreRole('  admin ')).toBe('member'); // still just a candidate
  });
});

describe('elevateRole (the floor)', () => {
  it('elevates a member only for super_admin (admin is a candidate, §3.0)', () => {
    expect(elevateRole('member', 'admin')).toBe('member'); // candidate → no elevation
    expect(elevateRole('member', 'super_admin')).toBe('super_admin');
  });

  it('never downgrades a locally-granted admin', () => {
    expect(elevateRole('admin', 'user')).toBe('admin');
    expect(elevateRole('admin', null)).toBe('admin');
    expect(elevateRole('admin', 'admin')).toBe('admin');
    expect(elevateRole('super_admin', 'user')).toBe('super_admin');
  });

  it('is a no-op when the core role is absent or equal', () => {
    expect(elevateRole('member', null)).toBe('member');
    expect(elevateRole('member', 'user')).toBe('member');
    expect(elevateRole(null, null)).toBe('member');
  });
});

// ---------------------------------------------------------------------------
// resolveSsoLogin — sub-upsert + floor applied against a real DB
// ---------------------------------------------------------------------------

describe('resolveSsoLogin — sub-upsert + role floor', () => {
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
        isActive: values.isActive ?? true,
        synapslySub: values.synapslySub ?? null,
        ...values,
      })
      .returning();
    if (!row) throw new Error('seed failed');
    return row;
  }

  it('sends a brand-new core admin through the join gate (candidate, no auto-privilege)', async () => {
    // §3.0: core `admin` does NOT auto-grant local admin, so a fresh core admin
    // is treated like any other new user and must pass the invite-code gate.
    const res = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-a', email: 'a@x.io', emailVerified: true, role: 'admin' }),
    );
    expect(res.status).toBe('needs-join');
  });

  it('provisions a brand-new super_admin as the unique highest local role', async () => {
    const res = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-s', email: 's@x.io', emailVerified: true, role: 'super_admin' }),
    );
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('unreachable');
    expect(res.user.role).toBe('super_admin');
  });

  it('sends a brand-new plain user through the invite-code join gate', async () => {
    const res = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-u', email: 'u@x.io', emailVerified: true, role: 'user' }),
    );
    expect(res.status).toBe('needs-join');
  });

  it('returns the same user on a second login, keyed by sub (upsert, no dupes)', async () => {
    // super_admin provisions straight to 'ok' (no join gate), so it exercises
    // the by-sub upsert path cleanly.
    const id = identity({
      sub: 'sub-s',
      email: 's@x.io',
      emailVerified: true,
      role: 'super_admin',
    });
    const first = await resolveSsoLogin(ctx.db, id);
    const second = await resolveSsoLogin(ctx.db, id);
    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('unreachable');
    expect(second.user.id).toBe(first.user.id);
    const all = await ctx.db.select().from(users);
    expect(all).toHaveLength(1);
  });

  it('refuses to provision a second local super_admin', async () => {
    await seed({ email: 'root@x.io', role: 'super_admin', synapslySub: 'sub-root' });
    await expect(
      resolveSsoLogin(
        ctx.db,
        identity({
          sub: 'sub-second',
          email: 'second@x.io',
          emailVerified: true,
          role: 'super_admin',
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('elevates a returning member when core promoted them to super_admin', async () => {
    const seeded = await seed({ email: 'm@x.io', role: 'member', synapslySub: 'sub-m' });
    const res = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-m', email: 'm@x.io', emailVerified: true, role: 'super_admin' }),
    );
    if (res.status !== 'ok') throw new Error('unreachable');
    expect(res.user.id).toBe(seeded.id);
    expect(res.user.role).toBe('super_admin');
  });

  it('does NOT elevate a returning member on a core admin (candidate) login', async () => {
    const seeded = await seed({ email: 'c@x.io', role: 'member', synapslySub: 'sub-c' });
    const res = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-c', email: 'c@x.io', emailVerified: true, role: 'admin' }),
    );
    if (res.status !== 'ok') throw new Error('unreachable');
    expect(res.user.id).toBe(seeded.id);
    expect(res.user.role).toBe('member'); // §3.0: admin is a candidate, no auto-grant
  });

  it('never downgrades a locally-elevated admin on a lower/absent core role', async () => {
    await seed({ email: 'boss@x.io', role: 'admin', synapslySub: 'sub-b' });
    // Core now reports only `user` (or omits the claim entirely).
    const lower = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-b', email: 'boss@x.io', emailVerified: true, role: 'user' }),
    );
    if (lower.status !== 'ok') throw new Error('unreachable');
    expect(lower.user.role).toBe('admin');

    const absent = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-b', email: 'boss@x.io', emailVerified: true, role: null }),
    );
    if (absent.status !== 'ok') throw new Error('unreachable');
    expect(absent.user.role).toBe('admin');
  });

  it('links an existing account by VERIFIED email and applies the floor', async () => {
    const seeded = await seed({ email: 'link@x.io', role: 'member', synapslySub: null });
    const res = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-link', email: 'link@x.io', emailVerified: true, role: 'super_admin' }),
    );
    if (res.status !== 'ok') throw new Error('unreachable');
    expect(res.user.id).toBe(seeded.id);
    expect(res.user.synapslySub).toBe('sub-link');
    expect(res.user.role).toBe('super_admin'); // super_admin floor applied on link
  });

  it('does NOT link an existing account on an UNVERIFIED email', async () => {
    await seed({ email: 'noverify@x.io', role: 'admin', synapslySub: null });
    const res = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-nv', email: 'noverify@x.io', emailVerified: false, role: 'user' }),
    );
    // Falls through to the join gate rather than hijacking the existing row.
    expect(res.status).toBe('needs-join');
  });

  it('never takes over an account already bound to a different sub', async () => {
    await seed({ email: 'taken@x.io', role: 'member', synapslySub: 'sub-original' });
    await expect(
      resolveSsoLogin(
        ctx.db,
        identity({ sub: 'sub-attacker', email: 'taken@x.io', emailVerified: true, role: 'admin' }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('refuses a deactivated account', async () => {
    await seed({ email: 'off@x.io', role: 'member', synapslySub: 'sub-off', isActive: false });
    await expect(
      resolveSsoLogin(
        ctx.db,
        identity({ sub: 'sub-off', email: 'off@x.io', emailVerified: true, role: 'user' }),
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

// ---------------------------------------------------------------------------
// completeSsoJoin — brand-new member provisioning seeds the floor
// ---------------------------------------------------------------------------

describe('completeSsoJoin — floor on first provisioning', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('provisions a plain user as a member with the correct sub', async () => {
    await updateRegistrationSettings(ctx.db, {
      registrationEnabled: true,
      registrationCode: 'team-secret-2026',
    });
    const user = await completeSsoJoin(
      ctx.db,
      identity({ sub: 'sub-j', email: 'j@x.io', emailVerified: true, role: 'user' }),
      'team-secret-2026',
    );
    expect(user.role).toBe('member');
    expect(user.synapslySub).toBe('sub-j');
  });
});
