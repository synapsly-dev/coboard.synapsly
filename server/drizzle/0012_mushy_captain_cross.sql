ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "oidc_id_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "synapsly_sub" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_synapsly_sub_uniq" ON "users" USING btree ("synapsly_sub");