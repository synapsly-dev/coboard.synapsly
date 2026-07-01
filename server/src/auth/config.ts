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

/**
 * Build the auth runtime from environment variables.
 *
 * - SSO is enabled only when BOTH `SYNAPSLY_CLIENT_ID` and
 *   `SYNAPSLY_CLIENT_SECRET` are set (a confidential client needs its secret).
 * - `SYNAPSLY_REDIRECT_URI` defaults to `${publicUrl}/api/auth/synapsly/callback`.
 * - `DEV_LOGIN` is honored only when NOT in production, so a prod misconfig can
 *   never open the fake-login door.
 */
export function loadAuthRuntime(opts: {
  env?: NodeJS.ProcessEnv;
  production: boolean;
  publicUrl: string;
}): AuthRuntime {
  const env = opts.env ?? process.env;

  const clientId = env.SYNAPSLY_CLIENT_ID?.trim();
  const clientSecret = env.SYNAPSLY_CLIENT_SECRET?.trim();

  let synapsly: SynapslyConfig | null = null;
  if (clientId && clientSecret) {
    const issuer = (env.SYNAPSLY_ISSUER?.trim() || DEFAULT_ISSUER).replace(/\/+$/, '');
    const redirectUri =
      env.SYNAPSLY_REDIRECT_URI?.trim() ||
      `${opts.publicUrl.replace(/\/+$/, '')}/api/auth/synapsly/callback`;
    synapsly = {
      issuer,
      clientId,
      clientSecret,
      redirectUri,
      // Default ON; opt out with SYNAPSLY_SINGLE_LOGOUT=false.
      singleLogout: env.SYNAPSLY_SINGLE_LOGOUT?.trim().toLowerCase() !== 'false',
    };
  }

  return {
    synapsly,
    devLogin: !opts.production && env.DEV_LOGIN?.trim().toLowerCase() === 'true',
    publicUrl: opts.publicUrl.replace(/\/+$/, ''),
  };
}
