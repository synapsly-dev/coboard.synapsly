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
- `name` and `picture` only seed a newly created Coboard profile. A later login
  does not overwrite the user's local display name or uploaded avatar.
- Membership is a strict pair: `none` requires a null expiry; `plus`/`pro`
  require a valid future RFC3339 expiry. An already-open session treats a paid
  tier as `none` as soon as its saved expiry passes. Coboard has no membership
  mutation, checkout, grant, or sale endpoint.

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

The existing `tasks.points`, claimant allocations, idea `reward_points`, and
statistics are **Coboard contribution points**. They are application business
metrics only: they are not Syna Coins, have no spendable balance, and never
sync into the central wallet.

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

The Core OAuth client must allow all six required scopes. Coboard needs no
`wallet:read` or `wallet:debit` scope. Existing email notifications may still
use their separately authorized `email:send` capability.

## Migration and rollback

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
