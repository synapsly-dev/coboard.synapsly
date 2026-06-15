import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';

/**
 * Smoke test (§10): the server boots against an in-memory PGlite db and the
 * implemented setup-status endpoint responds correctly on a fresh database.
 */
describe('smoke', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it('boots and reports needsSetup=true on a fresh database', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/setup/status',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ needsSetup: true });
  });

  it('returns the §7 error shape for unknown API routes', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/does-not-exist',
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('not_found');
    expect(typeof body.error.message).toBe('string');
  });

  it('rejects unsafe API requests missing the CSRF header', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'a@b.com', password: 'whatever' },
    });
    expect(res.statusCode).toBe(403);
  });
});
