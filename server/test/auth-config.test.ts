import { describe, expect, it } from 'vitest';
import { loadAuthRuntime, REQUIRED_OIDC_SCOPES } from '../src/auth/config.js';

const BASE_ENV = {
  OIDC_CLIENT_ID: 'coboard',
  OIDC_CLIENT_SECRET: 'secret',
} satisfies NodeJS.ProcessEnv;

describe('Syna ID auth configuration', () => {
  it('uses the canonical issuer and complete identity scope set', () => {
    const runtime = loadAuthRuntime({
      env: BASE_ENV,
      production: true,
      publicUrl: 'https://coboard.synapsly.org',
    });
    expect(runtime.synapsly?.issuer).toBe('https://accounts.synapsly.org');
    expect(new Set(runtime.synapsly?.scopes.split(/\s+/))).toEqual(new Set(REQUIRED_OIDC_SCOPES));
  });

  it('fails closed when a configured client omits an authoritative scope', () => {
    expect(() =>
      loadAuthRuntime({
        env: { ...BASE_ENV, OIDC_SCOPES: 'openid profile email roles membership' },
        production: true,
        publicUrl: 'https://coboard.synapsly.org',
      }),
    ).toThrow(/phone/);
  });

  it('requires a confidential Syna ID client in production', () => {
    expect(() =>
      loadAuthRuntime({
        env: {},
        production: true,
        publicUrl: 'https://coboard.synapsly.org',
      }),
    ).toThrow(/OIDC_CLIENT_ID/);
  });

  it('still allows an unconfigured local test runtime outside production', () => {
    expect(
      loadAuthRuntime({ env: {}, production: false, publicUrl: 'http://localhost:3000' }).synapsly,
    ).toBeNull();
  });
});
