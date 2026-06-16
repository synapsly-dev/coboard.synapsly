CREATE TYPE "public"."idea_status" AS ENUM('pending', 'adopted', 'rejected');--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" "idea_status" DEFAULT 'pending' NOT NULL,
	"reward_points" integer,
	"adopted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_adopted_by_users_id_fk" FOREIGN KEY ("adopted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ideas_task_id_idx" ON "ideas" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "ideas_author_id_idx" ON "ideas" USING btree ("author_id");