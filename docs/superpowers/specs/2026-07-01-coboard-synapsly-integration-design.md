# Coboard × Synapsly — Brand + syna-core Integration (Design)

**Date:** 2026-07-01
**Status:** Approved
**Author:** yzl (with Claude)

## Summary

Fold coboard into the Synapsly ecosystem:

1. **Auth** — replace coboard's local email/password auth with **Synapsly ID SSO**
   (syna-core OIDC). SSO becomes the only way in.
2. **Brand** — re-skin coboard under the Synapsly "quiet-luxe monochrome" brand,
   keeping the **Coboard** name ("Coboard, by Synapsly").
3. **Moderate optimizations** — dark mode, single logout, dev fake-login, remove
   the now-dead local-auth surface, refresh deploy docs.

Deployment path: `ssh dev → ssh hk-01`, push to `origin/main`, redeploy.
Live at `https://coboard.synapsly.org`; core at `https://auth.synapsly.org`;
cookie domain `.synapsly.org` is shared.

## Context

- **coboard today**: Node 22 + Fastify + Drizzle/Postgres backend; React 18 +
  Vite + Tailwind v3 frontend. Auth = email + argon2, server-side `sessions`
  rows, signed httpOnly `coboard_session` cookie, admin-created accounts +
  invite-code self-registration. Global roles `admin` / `member` + project roles.
- **syna-core**: standard OIDC provider. Discovery
  `https://auth.synapsly.org/.well-known/openid-configuration`. Auth Code + PKCE
  (S256), RS256 JWTs, JWKS rotation, `/end_session`. **Identity-only kernel** —
  claims are user-level (`sub`, `email`, `email_verified`, `name`, `picture`,
  `phone_number`) and, by a tested invariant, **never** org/role/tenant. Roles
  live in the consuming app.
- Core is being extended (in parallel, by the user) to emit a top-level `role`
  claim (`user|admin|super_admin`) for the first-party coboard client. coboard
  will trust it if present, with an env allowlist fallback.

## 1. Auth — SSO-only, confidential, server-side

coboard has a backend, so it is a **confidential OIDC client** and runs the
Authorization Code + PKCE flow **entirely server-side**. After verifying the
identity, it mints coboard's **existing** session (the `sessions` table +
`coboard_session` signed httpOnly cookie). The whole current session model — the
`preHandler` cookie→user resolver, CSRF header check, sliding expiry — is
unchanged; only *how a user proves who they are* changes. No OIDC tokens are ever
exposed to the browser.

**Config** (`server/src/auth/synapsly.ts`):
- `SYNAPSLY_ISSUER` (default `https://auth.synapsly.org`)
- `SYNAPSLY_CLIENT_ID`, `SYNAPSLY_CLIENT_SECRET`
- `SYNAPSLY_REDIRECT_URI` (default `${PUBLIC_URL}/api/auth/synapsly/callback`)
- Discovery + JWKS fetched at runtime via `openid-client` (paths not hardcoded;
  JWKS rotation handled by the library). Lazily initialized + cached.

**Routes** (`server/src/routes/auth.ts`, replacing password login):
- `GET /api/auth/synapsly/start`
  - Generate `state`, `nonce`, PKCE `code_verifier`/`code_challenge` (S256).
  - Persist `{state, nonce, verifier, returnTo}` in a short-lived signed,
    httpOnly cookie (`coboard_oidc`, ~10 min, SameSite=Lax).
  - 302 to the authorization endpoint (`scope=openid profile email`).
- `GET /api/auth/synapsly/callback`
  - Read + clear the `coboard_oidc` cookie; verify `state`.
  - Exchange `code` at `/token` (PKCE verifier + client secret).
  - Verify `id_token` (RS256 via JWKS, `iss`/`aud`/`exp`/`nonce`).
  - Resolve the local user (§2). On the "new user, no invite code yet" path,
    stash a pending-join token and redirect to a coboard join screen instead of
    logging in.
  - On success: `createSession`, set `coboard_session` cookie, 302 to `returnTo`
    (or `/`).
- `POST /api/auth/synapsly/complete-join`
  - Body `{ code }`. Validates the pending-join token (from a signed cookie) +
    the invite code, provisions a `member`, mints a session.
- `POST /api/auth/logout`
  - Delete the local session + clear cookie (unchanged). If
    `SYNAPSLY_SINGLE_LOGOUT=true`, respond with the `/end_session` URL
    (`id_token_hint` + `post_logout_redirect_uri=${PUBLIC_URL}/`) for the client
    to redirect to. `id_token` is stored (server-side, in the session row) at
    login for this purpose.

**Dev fake-login** (`DEV_LOGIN=true`, non-production only):
- `POST /api/auth/dev-login` `{ email }` → find-or-create that user (admin if in
  `ADMIN_EMAILS`, else member) and mint a session, bypassing Synapsly. Hard
  guarded: returns 404 unless `DEV_LOGIN==='true' && NODE_ENV!=='production'`.
- The login page shows a dev-login box only when a `GET /api/auth/config`
  response reports `devLogin: true`.

## 2. User resolution & access control

Schema change (`users`):
- add `synapsly_sub TEXT UNIQUE` (nullable — links on first SSO login).
- `password_hash` becomes **nullable** (no longer written; retained so existing
  rows migrate cleanly; local-auth code that reads it is removed).

Resolution order in the callback:
1. **By `synapsly_sub`** → returning user. Refresh `displayName`/`email`/avatar
   from claims (display only — never a trust boundary). Log in.
2. **Else by verified `email`** (`email_verified === true`) → link
   `synapsly_sub` onto that existing row, keep its role. This is how the current
   admin (`y2609984873@gmail.com`) and all existing members migrate with **zero
   data migration**.
3. **Else new user** → provision:
   - **admin** if the `role` claim ∈ `{admin, super_admin}` **OR** the verified
     email ∈ `ADMIN_EMAILS` (comma-separated env). No invite code needed.
   - **otherwise** require the admin-preset **invite code**: reuse the existing
     `settings.registrationCode` + constant-time `codeMatches`. The callback,
     finding no account and no admin signal, redirects to a coboard **join
     screen**; `complete-join` checks the code → provision `member`. Missing or
     wrong code → rejected ("请输入有效邀请码或联系管理员"). Unknown Synapsly
     users can never silently get in.

`isActive === false` users are refused at login (as today).

Authorization (project/global roles, guards) is **unchanged** — it already lives
entirely in coboard, which is exactly core's boundary model.

## 3. Branding — "Coboard, by Synapsly"

- **Name**: stays **Coboard**. Add a subtle "by Synapsly" lockup on the login
  screen; keep the wordmark elsewhere.
- **Mark**: replace the `LayoutGrid` glyph with the Syna **synapse** mark, ported
  as a local `web/src/components/brand/SynapseMark.tsx` SVG (family-consistent,
  no external asset dependency), used in `TopNav`, `Login`, favicon.
- **Palette / type**: re-tone `web/src/index.css` CSS-vars to the **quiet-luxe
  monochrome** scale, with values ported faithfully from core's resolved token
  JSON (light bg `#fbfbfa`, ink `#0b0b0c`, neutral grays, ink primary action).
  Adopt **Inter Variable** (`@fontsource-variable/inter`) as the type family
  (keep CJK fallbacks). This keeps coboard on **Tailwind v3 + HSL CSS-vars** —
  we replicate token *values*, not the `@synapsly/tokens` package (private,
  UNLICENSED, vanilla-extract + Tailwind v4 — a hard dep would force a fragile
  registry install and a v3→v4 migration for no visual gain).
- `web/index.html`: title, `theme-color`, favicon, OG.

## 4. Moderate optimizations

- **Dark mode**: express the CSS-var palette as a light/dark pair driven by
  `data-theme` (or `.dark` on `<html>`), values from core's dark tokens. Toggle
  in the user-menu dropdown; preference persisted in `localStorage`; default
  follows `prefers-color-scheme`.
- **Single logout**: RP-initiated `/end_session` (§1), gated by
  `SYNAPSLY_SINGLE_LOGOUT`.
- **Remove dead local-auth surface**:
  - backend: `auth/password.ts` (argon2), `POST /auth/password`,
    `POST /auth/register`, `GET /auth/registration`-as-login-gate,
    setup-first-admin flow (`/setup`), password fields in schemas/services.
  - frontend: password field on Login, `Register.tsx`, `Setup.tsx`,
    `/account/password`, change-password UI. "管理账号" links out to
    `https://auth.synapsly.org/account`.
  - The invite code is **repurposed** from a self-register password gate into the
    SSO first-join gate (same admin setting, new meaning; settings copy updated).
  - Product features (board, ideas, announcements, stats, projects, comments,
    task files/texts, contribution stats) are **untouched**.
- **Docs refresh**: README + `.env.example` + `docker-compose.yml` document
  `SYNAPSLY_*`, `ADMIN_EMAILS`, `DEV_LOGIN`, `SYNAPSLY_SINGLE_LOGOUT`, and the
  `ssh dev → ssh hk-01` deploy flow.

## 5. Client registration (first implementation step)

Register a **confidential, first-party** OIDC client on core (super_admin creds
provided out-of-band) via `POST /api/admin/clients` or the `/admin` UI:
- redirect URI: `https://coboard.synapsly.org/api/auth/synapsly/callback`
  (+ `http://localhost:3000/api/auth/synapsly/callback` for local real-SSO tests)
- post-logout URI: `https://coboard.synapsly.org/`
- scopes: `openid profile email`
- first-party: yes (skip consent)
- `client_id` + one-time `client_secret` → deploy `.env` **only**, never git.

## Non-goals (this round)

- M2M Send/Pay/Monitor (email invites, notifications) — deferred.
- Multi-instance / Redis pub-sub — still out (v2 roadmap).
- Any change to coboard's product features or authorization model.

## Risks & mitigations

- **Core `role` claim not yet live** → `ADMIN_EMAILS` fallback keeps admin
  working; existing admin also matches by email.
- **Email-match hijack** → only link by email when `email_verified === true`;
  core verifies emails.
- **`@synapsly/tokens` drift** → we snapshot values with a comment pointing at
  the source tokens; acceptable for a monochrome scale that rarely changes.
- **Locked out during cutover** → dev fake-login + `ADMIN_EMAILS` provide
  recovery paths; keep a DB-level break-glass note in ops docs.

## Verification

`pnpm typecheck && pnpm test && pnpm build` green; manual SSO round-trip against
`auth.synapsly.org` post-deploy; existing admin logs in and retains admin.
