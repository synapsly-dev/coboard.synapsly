ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_number_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "syna_picture_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "core_role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "local_role" "user_role";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "membership_tier" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "membership_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "identity_synced_at" timestamp with time zone;--> statement-breakpoint
-- Existing app roles are preserved as local grants, except the legacy highest
-- role: super_admin can no longer be app-local, so it safely becomes admin until
-- the one verified Core SA logs in and claims the unique slot.
UPDATE "users"
SET "local_role" = CASE
  WHEN "role" = 'admin' THEN 'admin'::"user_role"
  WHEN "role" = 'super_admin' THEN 'admin'::"user_role"
  ELSE 'member'::"user_role"
END;--> statement-breakpoint
UPDATE "users" SET "role" = 'admin' WHERE "role" = 'super_admin';--> statement-breakpoint
CREATE UNIQUE INDEX "users_core_super_admin_uniq" ON "users" USING btree ("core_role") WHERE core_role = 'super_admin';--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_core_role_allowed" CHECK ("users"."core_role" in ('user', 'staff', 'admin', 'super_admin'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_local_role_allowed" CHECK ("users"."local_role" is null or "users"."local_role" in ('member', 'admin'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_super_admin_source_valid" CHECK (("users"."role" = 'super_admin') = ("users"."core_role" = 'super_admin'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_membership_pair_valid" CHECK (("users"."membership_tier" = 'none' and "users"."membership_expires_at" is null) or ("users"."membership_tier" in ('plus', 'pro') and "users"."membership_expires_at" is not null));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_verified_requires_number" CHECK (not "users"."phone_number_verified" or ("users"."phone_number" is not null and "users"."phone_number" <> ''));
