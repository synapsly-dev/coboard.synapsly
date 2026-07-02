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
 * The Synapsly `role` claim is a BASELINE FLOOR: mapped into coboard's local
 * vocabulary (user→member, admin→admin, super_admin→admin — coboard has no tier
 * above admin) and folded into the local role only ever *upward*. A locally
 * elevated admin must never be downgraded by a later login carrying a lower/absent
 * core role; a missing claim is a no-op floor. Users are keyed by the OIDC `sub`;
 * an existing account links only by VERIFIED email and never when already bound to
 * a different sub.
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
  it('maps the core vocabulary onto local roles', () => {
    expect(mapCoreRole('user')).toBe('member');
    expect(mapCoreRole('admin')).toBe('admin');
    // coboard has no tier above admin, so super_admin also lands on admin.
    expect(mapCoreRole('super_admin')).toBe('admin');
  });

  it('maps a missing/unknown/blank claim to the member baseline', () => {
    expect(mapCoreRole(null)).toBe('member');
    expect(mapCoreRole(undefined)).toBe('member');
    expect(mapCoreRole('')).toBe('member');
    expect(mapCoreRole('  ')).toBe('member');
    expect(mapCoreRole('root')).toBe('member');
  });

  it('trims surrounding whitespace before mapping', () => {
    expect(mapCoreRole('  admin ')).toBe('admin');
  });
});

describe('elevateRole (the floor)', () => {
  it('elevates a member when the core role is higher', () => {
    expect(elevateRole('member', 'admin')).toBe('admin');
    expect(elevateRole('member', 'super_admin')).toBe('admin');
  });

  it('never downgrades a locally-granted admin', () => {
    expect(elevateRole('admin', 'user')).toBe('admin');
    expect(elevateRole('admin', null)).toBe('admin');
    expect(elevateRole('admin', 'admin')).toBe('admin');
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

  it('provisions a brand-new core admin straight as a coboard admin', async () => {
    const res = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-a', email: 'a@x.io', emailVerified: true, role: 'admin' }),
    );
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('unreachable');
    expect(res.user.role).toBe('admin');
    expect(res.user.synapslySub).toBe('sub-a');
  });

  it('provisions a brand-new super_admin as a coboard admin (highest local)', async () => {
    const res = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-s', email: 's@x.io', emailVerified: true, role: 'super_admin' }),
    );
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') throw new Error('unreachable');
    expect(res.user.role).toBe('admin');
  });

  it('sends a brand-new plain user through the invite-code join gate', async () => {
    const res = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-u', email: 'u@x.io', emailVerified: true, role: 'user' }),
    );
    expect(res.status).toBe('needs-join');
  });

  it('returns the same user on a second login, keyed by sub (upsert, no dupes)', async () => {
    const id = identity({ sub: 'sub-a', email: 'a@x.io', emailVerified: true, role: 'admin' });
    const first = await resolveSsoLogin(ctx.db, id);
    const second = await resolveSsoLogin(ctx.db, id);
    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('unreachable');
    expect(second.user.id).toBe(first.user.id);
    const all = await ctx.db.select().from(users);
    expect(all).toHaveLength(1);
  });

  it('elevates a returning member when core promoted them to admin', async () => {
    const seeded = await seed({ email: 'm@x.io', role: 'member', synapslySub: 'sub-m' });
    const res = await resolveSsoLogin(
      ctx.db,
      identity({ sub: 'sub-m', email: 'm@x.io', emailVerified: true, role: 'admin' }),
    );
    if (res.status !== 'ok') throw new Error('unreachable');
    expect(res.user.id).toBe(seeded.id);
    expect(res.user.role).toBe('admin');
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
      identity({ sub: 'sub-link', email: 'link@x.io', emailVerified: true, role: 'admin' }),
    );
    if (res.status !== 'ok') throw new Error('unreachable');
    expect(res.user.id).toBe(seeded.id);
    expect(res.user.synapslySub).toBe('sub-link');
    expect(res.user.role).toBe('admin'); // floor applied on link
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
