CREATE TABLE "miniapp_auth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"oidc_id_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "miniapp_auth_codes" ADD CONSTRAINT "miniapp_auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "miniapp_auth_codes_expires_at_idx" ON "miniapp_auth_codes" USING btree ("expires_at");