import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RegistrationSettings } from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { SESSION_COOKIE, createSession } from '../src/auth/session.js';
import { users, type UserRow } from '../src/db/schema.js';
import { updateRegistrationSettings } from '../src/services/settingsService.js';
import {
  completeSsoJoin,
  type SsoIdentity,
} from '../src/services/authService.js';

/**
 * Member self-join gate (§8). With Synapsly SSO, a brand-new identity can only be
 * provisioned as a member by supplying the admin-preset invite code. Tests cover
 * the admin-only /settings guard and the `completeSsoJoin` gate directly (disabled
 * by default, wrong code rejected, correct code provisions a linked member).
 */

const CSRF_HEADERS = { 'x-requested-with': 'XMLHttpRequest' } as const;
const CODE = 'team-secret-2026';

function identity(sub: string, email: string): SsoIdentity {
  return {
    sub,
    email,
    emailVerified: true,
    name: '新成员',
    picture: null,
    role: null,
    idToken: 'test-id-token',
  };
}

describe('member self-join gate', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  async function seedUser(
    role: 'admin' | 'member',
  ): Promise<{ user: UserRow; cookie: string }> {
    const [user] = await ctx.db
      .insert(users)
      .values({
        email: `${role}@coboard.local`,
        passwordHash: null,
        synapslySub: `sub:${role}`,
        displayName: role,
        avatarColor: '#0b0b0c',
        role,
        isActive: true,
      })
      .returning();
    if (!user) throw new Error('seed failed');
    const { token } = await createSession(ctx.db, user.id);
    return { user, cookie: `${SESSION_COOKIE}=${ctx.app.signCookie(token)}` };
  }

  it('blocks non-admins from reading or writing /settings', async () => {
    const { cookie: memberCookie } = await seedUser('member');
    const get = await ctx.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { cookie: memberCookie },
    });
    expect(get.statusCode).toBe(403);
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { ...CSRF_HEADERS, cookie: memberCookie },
      payload: { registrationCode: CODE },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('admin can read + set the invite-code settings', async () => {
    const { cookie: adminCookie } = await seedUser('admin');
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { ...CSRF_HEADERS, cookie: adminCookie },
      payload: { registrationEnabled: true, registrationCode: CODE },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as RegistrationSettings).registrationCode).toBe(CODE);
  });

  it('rejects a join when self-join is disabled (the default)', async () => {
    await expect(
      completeSsoJoin(ctx.db, identity('sub:a', 'a@coboard.local'), CODE),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects a wrong code with 403 even when enabled', async () => {
    await updateRegistrationSettings(ctx.db, {
      registrationEnabled: true,
      registrationCode: CODE,
    });
    await expect(
      completeSsoJoin(ctx.db, identity('sub:a', 'a@coboard.local'), 'wrong'),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('provisions a linked member with the correct code', async () => {
    await updateRegistrationSettings(ctx.db, {
      registrationEnabled: true,
      registrationCode: CODE,
    });
    const user = await completeSsoJoin(
      ctx.db,
      identity('sub:new', 'new@coboard.local'),
      CODE,
    );
    expect(user.role).toBe('member');
    expect(user.email).toBe('new@coboard.local');
    expect(user.synapslySub).toBe('sub:new');
    expect(user.passwordHash).toBeNull();
  });

  it('is idempotent for an already-linked identity (race/double-submit)', async () => {
    await updateRegistrationSettings(ctx.db, {
      registrationEnabled: true,
      registrationCode: CODE,
    });
    const id = identity('sub:dup', 'dup@coboard.local');
    const first = await completeSsoJoin(ctx.db, id, CODE);
    // Second call with a WRONG code still returns the existing user (no re-gate).
    const second = await completeSsoJoin(ctx.db, id, 'wrong-code');
    expect(second.id).toBe(first.id);
  });
});
