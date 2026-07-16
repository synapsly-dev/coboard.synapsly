import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MiniappAuthExchangeResponse } from 'shared';
import { SESSION_COOKIE } from '../src/auth/session.js';
import { createTestContext, type TestContext } from './helpers.js';

const CSRF_HEADERS = { 'x-requested-with': 'XMLHttpRequest' } as const;

describe('Mini Program authentication', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({ authRuntime: { devLogin: true } });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('issues a native Bearer session for the development login', async () => {
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/miniapp/dev-login',
      headers: CSRF_HEADERS,
      payload: { email: 'native@example.com', displayName: 'Native User' },
    });
    expect(login.statusCode).toBe(200);
    const body = login.json() as MiniappAuthExchangeResponse;
    expect(body.token.length).toBeGreaterThanOrEqual(40);
    expect(body.user.email).toBe('native@example.com');

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(body.user.id);
  });

  it('moves a cookie session through the bridge and consumes its code once', async () => {
    const browserLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      headers: CSRF_HEADERS,
      payload: { email: 'bridge@example.com' },
    });
    const cookie = browserLogin.cookies.find((value) => value.name === SESSION_COOKIE);
    expect(cookie).toBeDefined();

    const bridge = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/miniapp/bridge',
      headers: { cookie: `${SESSION_COOKIE}=${cookie!.value}` },
    });
    expect(bridge.statusCode).toBe(200);
    expect(bridge.headers['cache-control']).toBe('no-store');
    const code = /auth-callback\/index\?code=([A-Za-z0-9_-]+)/.exec(bridge.body)?.[1];
    expect(code).toBeDefined();

    const exchange = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/miniapp/exchange',
      headers: CSRF_HEADERS,
      payload: { code },
    });
    expect(exchange.statusCode).toBe(200);
    const native = exchange.json() as MiniappAuthExchangeResponse;
    expect(native.user.email).toBe('bridge@example.com');

    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/miniapp/exchange',
      headers: CSRF_HEADERS,
      payload: { code },
    });
    expect(replay.statusCode).toBe(401);
  });
});
