import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SynapslyConfig } from '../src/auth/config.js';
import { resolvePictureUrl } from '../src/auth/synapsly.js';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';

/**
 * SSO callback failure surface. Every branch here used to end in the same
 * "登录失败，请稍后重试" / "登录会话已失效" sentence, which is why intermittent
 * login problems were impossible for a user (or an admin reading a screenshot)
 * to diagnose. Spec §2.5 requires the concrete reason, so these assert that the
 * redirect carries one.
 *
 * The issuer points at a closed local port: everything up to the token exchange
 * runs for real, and the exchange itself fails deterministically offline.
 */

/** An issuer that is guaranteed to refuse connections. */
const DEAD_ISSUER = 'http://127.0.0.1:1';

const TEST_SSO: SynapslyConfig = {
  issuer: DEAD_ISSUER,
  clientId: 'coboard-test',
  clientSecret: 'shhh',
  redirectUri: 'http://localhost/api/auth/synapsly/callback',
  scopes: 'openid profile email phone roles membership',
  singleLogout: false,
};

interface Flow {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

function flow(state: string): Flow {
  return { state, nonce: `nonce-${state}`, verifier: `verifier-${state}`, returnTo: '/' };
}

describe('SSO callback reports why a login failed', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext({ authRuntime: { synapsly: TEST_SSO } });
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  /** The signed pending-login cookie the /start handler would have written. */
  function flowCookie(...flows: Flow[]): string {
    return `coboard_oidc=${ctx.app.signCookie(JSON.stringify({ flows }))}`;
  }

  /** The message the callback redirected the user to /login with. */
  async function callbackError(
    query: string,
    cookie?: string,
  ): Promise<{ status: number; message: string }> {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/auth/synapsly/callback?${query}`,
      ...(cookie ? { headers: { cookie } } : {}),
    });
    const location = res.headers.location as string;
    const message = new URL(location, 'http://localhost').searchParams.get('sso_error') ?? '';
    return { status: res.statusCode, message };
  }

  it('says the login timed out or the cookie was blocked when no flow is pending', async () => {
    const { message } = await callbackError('code=abc&state=xyz');
    expect(message).toContain('登录状态已丢失');
    expect(message).toContain('Cookie');
  });

  it('distinguishes a replayed callback from a lost cookie', async () => {
    const { message } = await callbackError('code=abc&state=other', flowCookie(flow('mine')));
    expect(message).toContain('state');
    expect(message).not.toContain('登录状态已丢失');
  });

  it('names the missing parameter when Syna ID returns no code', async () => {
    const { message } = await callbackError('state=mine', flowCookie(flow('mine')));
    expect(message).toContain('code');
  });

  it('passes the provider error description straight through', async () => {
    const { message } = await callbackError(
      'error=access_denied&error_description=' + encodeURIComponent('用户取消了授权'),
      flowCookie(flow('mine')),
    );
    expect(message).toBe('用户取消了授权');
  });

  it('says Syna ID is unreachable instead of "请稍后重试"', async () => {
    const { message } = await callbackError('code=abc&state=mine', flowCookie(flow('mine')));
    expect(message).toContain('无法连接 Syna ID');
  });

  it('matches any pending flow, so a second login tab does not break the first', async () => {
    // Both tabs are live; the older tab's callback must be recognized rather
    // than rejected as a state mismatch (it gets as far as the token exchange).
    const { message } = await callbackError(
      'code=abc&state=older',
      flowCookie(flow('newer'), flow('older')),
    );
    expect(message).toContain('无法连接 Syna ID');
  });

  it('keeps the other tabs pending and drops only the consumed flow', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/synapsly/callback?code=abc&state=older',
      headers: { cookie: flowCookie(flow('newer'), flow('older')) },
    });
    const setCookie = [res.headers['set-cookie'] ?? []].flat().join('\n');
    expect(setCookie).toContain('coboard_oidc=');
    const value = decodeURIComponent(/coboard_oidc=([^;]*)/.exec(setCookie)?.[1] ?? '');
    expect(value).toContain('newer');
    expect(value).not.toContain('older');
  });
});

describe('picture claim resolution', () => {
  it('absolutizes a Syna ID preset path against the issuer', () => {
    expect(resolvePictureUrl('https://accounts.synapsly.org', '/avatars/3.svg')).toBe(
      'https://accounts.synapsly.org/avatars/3.svg',
    );
  });

  it('passes an already-absolute (object storage) URL through', () => {
    const cos = 'https://cdn.example.com/avatars/u1/abc.png';
    expect(resolvePictureUrl('https://accounts.synapsly.org', cos)).toBe(cos);
  });

  it('returns null — never throws — for absent or unusable values', () => {
    for (const raw of [undefined, null, '', '   ', 42, 'javascript:alert(1)']) {
      expect(resolvePictureUrl('https://accounts.synapsly.org', raw)).toBeNull();
    }
  });
});
