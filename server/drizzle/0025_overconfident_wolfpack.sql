CREATE TABLE "entity_subscriptions" (
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"mode" text DEFAULT 'watching' NOT NULL,
	"muted_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_subscriptions_user_id_entity_type_entity_id_pk" PRIMARY KEY("user_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"channel" text NOT NULL,
	"delivery" text DEFAULT 'immediate' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_topic_channel_pk" PRIMARY KEY("user_id","topic","channel")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"type" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"action_required" boolean DEFAULT false NOT NULL,
	"dedupe_key" text,
	"group_key" text,
	"read_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entity_subscriptions" ADD CONSTRAINT "entity_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_subscriptions_entity_idx" ON "entity_subscriptions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" USING btree ("recipient_user_id","created_at") WHERE read_at IS NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_recipient_action_idx" ON "notifications" USING btree ("recipient_user_id","created_at") WHERE action_required = true AND resolved_at IS NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "notifications" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_group_idx" ON "notifications" USING btree ("recipient_user_id","group_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_recipient_dedupe_uniq" ON "notifications" USING btree ("recipient_user_id","dedupe_key") WHERE dedupe_key IS NOT NULL;