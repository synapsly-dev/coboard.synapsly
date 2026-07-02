/**
 * Auth runtime configuration (Synapsly ID SSO). Resolves the OIDC client config,
 * the admin-email allowlist, and the dev fake-login toggle from the environment.
 * Read once at boot and decorated onto the Fastify instance so routes stay pure.
 */

/** Resolved Synapsly OIDC client config. Present only when fully configured. */
export interface SynapslyConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Space-delimited OIDC scopes. Includes `roles` so core emits the `role` claim. */
  scopes: string;
  /** When true, logout also ends the Synapsly session (RP-initiated). */
  singleLogout: boolean;
}

export interface AuthRuntime {
  /** OIDC client config, or null when SSO is not configured (e.g. tests). */
  synapsly: SynapslyConfig | null;
  /** Local fake-login escape hatch — only ever true outside production. */
  devLogin: boolean;
  /** App base URL (for post-logout redirect + returnTo defaults). */
  publicUrl: string;
}

const DEFAULT_ISSUER = 'https://auth.synapsly.org';
/** `roles` is required so core emits the `role` claim the role-floor consumes. */
const DEFAULT_SCOPES = 'openid profile email roles';

/** First non-empty trimmed value among the given env keys, else undefined. */
function pickEnv(env: NodeJS.ProcessEnv, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = env[key]?.trim();
    if (v) return v;
  }
  return undefined;
}

/**
 * Build the auth runtime from environment variables.
 *
 * Config keys follow the OIDC spec (`OIDC_ISSUER` / `OIDC_CLIENT_ID` /
 * `OIDC_CLIENT_SECRET` / `OIDC_SCOPES`); the older `SYNAPSLY_*` names are still
 * accepted as backward-compatible aliases so existing deployments keep working.
 *
 * - SSO is enabled only when BOTH a client id AND secret are set (a confidential
 *   client needs its secret).
 * - The redirect URI defaults to `${publicUrl}/api/auth/synapsly/callback`.
 * - Scopes default to `openid profile email roles` (the `roles` scope is what
 *   makes core emit the baseline `role` claim).
 * - `DEV_LOGIN` is honored only when NOT in production, so a prod misconfig can
 *   never open the fake-login door.
 */
export function loadAuthRuntime(opts: {
  env?: NodeJS.ProcessEnv;
  production: boolean;
  publicUrl: string;
}): AuthRuntime {
  const env = opts.env ?? process.env;

  const clientId = pickEnv(env, 'OIDC_CLIENT_ID', 'SYNAPSLY_CLIENT_ID');
  const clientSecret = pickEnv(env, 'OIDC_CLIENT_SECRET', 'SYNAPSLY_CLIENT_SECRET');

  let synapsly: SynapslyConfig | null = null;
  if (clientId && clientSecret) {
    const issuer = (pickEnv(env, 'OIDC_ISSUER', 'SYNAPSLY_ISSUER') || DEFAULT_ISSUER).replace(
      /\/+$/,
      '',
    );
    const redirectUri =
      pickEnv(env, 'OIDC_REDIRECT_URI', 'SYNAPSLY_REDIRECT_URI') ||
      `${opts.publicUrl.replace(/\/+$/, '')}/api/auth/synapsly/callback`;
    const scopes = pickEnv(env, 'OIDC_SCOPES', 'SYNAPSLY_SCOPES') || DEFAULT_SCOPES;
    synapsly = {
      issuer,
      clientId,
      clientSecret,
      redirectUri,
      scopes,
      // Default ON; opt out with SYNAPSLY_SINGLE_LOGOUT=false.
      singleLogout: pickEnv(env, 'SYNAPSLY_SINGLE_LOGOUT')?.toLowerCase() !== 'false',
    };
  }

  return {
    synapsly,
    devLogin: !opts.production && env.DEV_LOGIN?.trim().toLowerCase() === 'true',
    publicUrl: opts.publicUrl.replace(/\/+$/, ''),
  };
}
