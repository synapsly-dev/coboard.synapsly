# Coboard × Syna App Spec v2

This document records Coboard's current production integration contract. The
repository-level Syna App Spec remains authoritative if this document drifts.

## Identity and membership

- Issuer: `https://accounts.synapsly.org`.
- Confidential Authorization Code + PKCE client.
- Required scopes: `openid profile email phone roles membership`.
- `sub` is the permanent unique identity key. A verified email may only bridge
  an existing row that has no `sub`; it never replaces a different bound `sub`.
- `email`, `email_verified`, `phone_number`, `phone_number_verified`, Core
  `role`, `membership_tier`, and `membership_expires_at` overwrite the local
  snapshot on every successful login.
- `name` and `picture` seed a Coboard profile **once**, at its first identity
  sync — which for rows that predate SSO (legacy accounts, accounts an admin
  pre-provisioned by email) happens on the sync path, not the provisioning path.
  `identity_synced_at IS NULL` is the marker for "never synced". A later login
  never overwrites a local display name, an uploaded avatar, or a seeded picture,
  and a user who deletes their avatar keeps it deleted.
- Membership is a strict pair: `none` requires a null expiry; `plus`/`pro`/`max`
  require a valid future RFC3339 expiry. An already-open session treats a paid
  tier as `none` as soon as its saved expiry passes. Coboard has no membership
  mutation, checkout, grant, or sale endpoint.
- **Display-only claims never gate authentication.** `role`, `membership_tier` /
  `membership_expires_at`, and `picture` all degrade to their documented floor
  (`user`, `none`, no avatar) with a server-side `warn` when they are absent,
  unknown, malformed or already expired. Core settles membership lazily, clocks
  drift between hosts, and a client whose `allowed_scopes` were narrowed simply
  stops emitting a claim family: none of that may cost a user their session.
  Only genuinely unusable identity (no `sub`, no usable `email`, an id_token that
  fails verification) refuses the login, and it says which.
- `/userinfo` is preferred but optional: if that one request fails, the login
  completes from the signature-verified id_token, which carries the same claims.

## RBAC

`users.core_role` stores the latest Syna ID baseline. `users.local_role` stores
only Coboard grants (`member|admin`). `users.role` is the materialized effective
role used by request guards:

```
effective = max(map(core_role), local_role)
user/staff -> member; admin -> admin; super_admin -> super_admin
```

The single `super_admin` can only be installed by a freshly verified Core
`super_admin` claim. It is excluded from local-role inputs, protected by partial
unique indexes, automatically clears a stale holder, and is read-only to every
admin management operation. The Core SA may still customize their own local
display name/avatar through self-service profile routes.

## Wallet exemption and points terminology

Coboard currently performs no AI generation or other metered Syna operation.
It therefore has no Wallet M2M credentials, balance cache, debit, refund,
outbox, price table, or recharge UI. Do not add dummy debits merely to make the
app resemble metered products.

Because Coboard shows no balance, spec §4.4.1 (credit display must mirror
`GET /api/wallet/balance` field for field) has nothing to bind to here. That is
the exemption working as intended, not an omission: the correct way to stay
compliant is to keep showing no balance. If Coboard ever gains a metered
operation, §4.4.1 applies in full from the first screen that shows a number.

The existing `tasks.points`, claimant allocations, idea `reward_points`, and
statistics are **Coboard contribution points**. They are application business
metrics only: they are not Syna Coins, have no spendable balance, and never
sync into the central wallet.

## Membership tier: display name only

`membership_tier` is mirrored read-only and used for exactly one thing — a
display name (`MEMBERSHIP_TIER_LABELS` in `packages/shared`, spec §4.1). It is
absent from every authorization check, rate limit, feature flag and price in the
codebase, and Coboard states no benefits of its own next to it; the profile pages
link to <https://accounts.synapsly.org/membership>, where the tier is defined
once for the whole ecosystem.

Coboard has no free-quota / trial-count / local-credit counter of any kind
(spec §4.6.1) and never had one — there is nothing to remove and nothing to
reintroduce.

## Production configuration

Required active environment values:

```dotenv
PUBLIC_URL=https://coboard.synapsly.org
OIDC_ISSUER=https://accounts.synapsly.org
OIDC_CLIENT_ID=<confidential client id>
OIDC_CLIENT_SECRET=<host-only secret>
OIDC_SCOPES=openid profile email phone roles membership
OIDC_REDIRECT_URI=https://coboard.synapsly.org/api/auth/synapsly/callback
SYNAPSLY_SINGLE_LOGOUT=true
DEV_LOGIN=false
```

The Core OAuth client must allow all six required scopes — Syna ID silently
narrows a request to the client's `allowed_scopes`, so a missing `profile` costs
new users their avatar, a missing `roles` logs everyone in as an ordinary member,
and a missing `membership` shows every account as the free tier. Coboard logs a
`warn` for each degraded claim family rather than refusing the login. Coboard
needs no `wallet:read` or `wallet:debit` scope. Existing email notifications may
still use their separately authorized `email:send` capability.

## Migration and rollback

Migration `0028_strange_speedball.sql` widens the `users_membership_pair_valid`
CHECK to accept `max`. It is a constraint swap with no data change, applies in
seconds, and is safe to leave in place if the app image is rolled back — the old
code simply never writes the new value.

Migration `0027_sparkling_chameleon.sql` adds the authoritative identity,
baseline/local role, and membership fields plus constraints/indexes. Before
deploying:

1. Create and checksum a `pg_dump` backup.
2. Confirm the active OAuth client allows the required scopes.
3. Apply the migration through normal app startup.
4. Verify the membership-pair/role constraints and both unique SA indexes.
5. Complete one real Syna ID login and confirm `identity_synced_at` is populated.

Legacy `member`/`admin` roles become local grants. A legacy local
`super_admin` is deliberately reduced to local `admin`; the verified Core SA
reclaims the unique highest role on login. Because that data correction cannot
be inferred in reverse, the only exact rollback is: stop the new app, restore
the pre-deploy database backup, then start the prior image. The prior image can
temporarily run against the additive schema for emergency code rollback, but
that is not a full data rollback.
