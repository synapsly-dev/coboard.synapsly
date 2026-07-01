import { createHash, randomBytes } from 'node:crypto';
import type { SynapslyConfig } from './config.js';

/**
 * Minimal, dependency-free OpenID Connect client for the Synapsly ID provider
 * (syna-core). Implements exactly the confidential Authorization-Code + PKCE flow
 * coboard needs, using Node's built-in `fetch`, WebCrypto (RS256 JWKS signature
 * verification), and `node:crypto` (PKCE / random state). We deliberately avoid a
 * third-party OIDC library: the environment's npm registry is unreliable and the
 * surface we use is small and stable.
 *
 * Endpoints are always taken from the discovery document (never hardcoded); JWKS
 * are fetched dynamically and re-fetched on an unknown `kid` so key rotation is
 * transparent.
 */

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64url');
}

function b64urlToBuffer(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

function b64urlToString(s: string): string {
  return b64urlToBuffer(s).toString('utf8');
}

// ---------------------------------------------------------------------------
// PKCE + random values
// ---------------------------------------------------------------------------

export function randomToken(bytes = 32): string {
  return b64urlEncode(randomBytes(bytes));
}

/** Generate a PKCE code_verifier (43–128 chars, URL-safe). */
export function generateCodeVerifier(): string {
  return randomToken(32);
}

/** Derive the S256 code_challenge from a verifier. */
export function codeChallengeS256(verifier: string): string {
  return b64urlEncode(createHash('sha256').update(verifier).digest());
}

// ---------------------------------------------------------------------------
// Discovery + JWKS caches (per-issuer, module-level)
// ---------------------------------------------------------------------------

interface DiscoveryDoc {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
}

interface Jwk {
  kid?: string;
  kty: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

const DISCOVERY_TTL_MS = 10 * 60_000;
const discoveryCache = new Map<string, { doc: DiscoveryDoc; at: number }>();
const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OIDC 请求失败 ${res.status} ${url}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function discover(cfg: SynapslyConfig): Promise<DiscoveryDoc> {
  const cached = discoveryCache.get(cfg.issuer);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) {
    return cached.doc;
  }
  const doc = (await fetchJson(
    `${cfg.issuer}/.well-known/openid-configuration`,
  )) as DiscoveryDoc;
  if (doc.issuer !== cfg.issuer) {
    throw new Error(`OIDC issuer 不匹配：期望 ${cfg.issuer}，实际 ${doc.issuer}`);
  }
  discoveryCache.set(cfg.issuer, { doc, at: Date.now() });
  return doc;
}

async function getJwks(cfg: SynapslyConfig, force = false): Promise<Jwk[]> {
  const cached = jwksCache.get(cfg.issuer);
  if (!force && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) {
    return cached.keys;
  }
  const doc = await discover(cfg);
  const jwks = (await fetchJson(doc.jwks_uri)) as { keys?: Jwk[] };
  const keys = jwks.keys ?? [];
  jwksCache.set(cfg.issuer, { keys, at: Date.now() });
  return keys;
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

export async function buildAuthorizationUrl(
  cfg: SynapslyConfig,
  params: { state: string; nonce: string; codeChallenge: string },
): Promise<string> {
  const doc = await discover(cfg);
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', cfg.redirectUri);
  url.searchParams.set('scope', 'openid profile email');
  url.searchParams.set('state', params.state);
  url.searchParams.set('nonce', params.nonce);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export interface TokenSet {
  access_token: string;
  id_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
}

export async function exchangeCode(
  cfg: SynapslyConfig,
  params: { code: string; codeVerifier: string },
): Promise<TokenSet> {
  const doc = await discover(cfg);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: cfg.redirectUri,
    code_verifier: params.codeVerifier,
  });
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const tokens = (await fetchJson(doc.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
    },
    body: body.toString(),
  })) as TokenSet;
  if (!tokens.id_token || !tokens.access_token) {
    throw new Error('OIDC token 响应缺少 id_token/access_token');
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// ID token verification (RS256 via JWKS)
// ---------------------------------------------------------------------------

export interface IdTokenClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  role?: string;
  [k: string]: unknown;
}

function importRsaKey(jwk: Jwk) {
  return crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
}

/** Verify an RS256 JWT's signature against the issuer JWKS; return its claims. */
export async function verifyIdToken(
  cfg: SynapslyConfig,
  idToken: string,
  opts: { nonce?: string } = {},
): Promise<IdTokenClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('id_token 格式非法');
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const header = JSON.parse(b64urlToString(headerB64)) as { alg?: string; kid?: string };
  if (header.alg !== 'RS256') {
    throw new Error(`不支持的 id_token 签名算法：${header.alg}`);
  }

  const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = b64urlToBuffer(sigB64);

  const verifyWith = async (keys: Jwk[]): Promise<boolean> => {
    const candidates = header.kid
      ? keys.filter((k) => k.kid === header.kid)
      : keys;
    for (const jwk of candidates) {
      if (jwk.kty !== 'RSA' || !jwk.n || !jwk.e) continue;
      const key = await importRsaKey(jwk);
      const ok = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        key,
        signature,
        signed,
      );
      if (ok) return true;
    }
    return false;
  };

  // Try cached JWKS, then force a refresh once (handles key rotation).
  let ok = await verifyWith(await getJwks(cfg));
  if (!ok) ok = await verifyWith(await getJwks(cfg, true));
  if (!ok) throw new Error('id_token 签名校验失败');

  const claims = JSON.parse(b64urlToString(payloadB64)) as IdTokenClaims;

  if (claims.iss !== cfg.issuer) {
    throw new Error('id_token issuer 不匹配');
  }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(cfg.clientId)) {
    throw new Error('id_token aud 不匹配');
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && now > claims.exp + 60) {
    throw new Error('id_token 已过期');
  }
  if (opts.nonce && claims.nonce !== opts.nonce) {
    throw new Error('id_token nonce 不匹配');
  }
  return claims;
}

// ---------------------------------------------------------------------------
// UserInfo + end session
// ---------------------------------------------------------------------------

export interface UserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  role?: string;
  [k: string]: unknown;
}

/** Fetch the freshest user-level claims (and `role`, if the provider emits it). */
export async function fetchUserInfo(
  cfg: SynapslyConfig,
  accessToken: string,
): Promise<UserInfo> {
  const doc = await discover(cfg);
  return (await fetchJson(doc.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })) as UserInfo;
}

/** Build the RP-initiated logout URL, or null if the provider has no endpoint. */
export async function buildEndSessionUrl(
  cfg: SynapslyConfig,
  params: { idToken?: string | null; postLogoutRedirectUri: string },
): Promise<string | null> {
  const doc = await discover(cfg);
  if (!doc.end_session_endpoint) return null;
  const url = new URL(doc.end_session_endpoint);
  if (params.idToken) url.searchParams.set('id_token_hint', params.idToken);
  url.searchParams.set('post_logout_redirect_uri', params.postLogoutRedirectUri);
  url.searchParams.set('client_id', cfg.clientId);
  return url.toString();
}
