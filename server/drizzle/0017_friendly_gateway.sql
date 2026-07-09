CREATE TYPE "public"."task_type" AS ENUM('critical', 'baseline', 'claimable', 'collab');--> statement-breakpoint
CREATE TYPE "public"."track_member_role" AS ENUM('manager', 'member');--> statement-breakpoint
CREATE TABLE "track_members" (
	"track_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "track_member_role" NOT NULL,
	"rank" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "track_members_track_id_user_id_pk" PRIMARY KEY("track_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"weekly_goal" text,
	"archived" boolean DEFAULT false NOT NULL,
	"rank" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "track_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "task_type" "task_type";--> statement-breakpoint
ALTER TABLE "track_members" ADD CONSTRAINT "track_members_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "track_members" ADD CONSTRAINT "track_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "track_members_user_id_idx" ON "track_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracks_key_uniq" ON "tracks" USING btree ("key");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_track_id_idx" ON "projects" USING btree ("track_id");
