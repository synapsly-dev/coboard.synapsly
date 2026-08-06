-- `max` belongs to the ecosystem-wide membership enum (Syna App Spec §4.3), but
-- Coboard only knew none|plus|pro. A Syna Max account could therefore neither be
-- stored nor even log in: the claim parser rejected the tier outright and this
-- CHECK would have rejected the row. Widen it. The tier remains read-only,
-- display-only data that grants nothing inside Coboard.
ALTER TABLE "users" DROP CONSTRAINT "users_membership_pair_valid";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_membership_pair_valid" CHECK (("users"."membership_tier" = 'none' and "users"."membership_expires_at" is null) or ("users"."membership_tier" in ('plus', 'pro', 'max') and "users"."membership_expires_at" is not null));