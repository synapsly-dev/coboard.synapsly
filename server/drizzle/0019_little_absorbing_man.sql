CREATE TYPE "public"."quality_grade" AS ENUM('a', 'b', 'c', 'd');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TYPE "public"."review_stage" AS ENUM('first', 'final');--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'transferred';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'due_changed';--> statement-breakpoint
CREATE TABLE "task_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"stage" "review_stage" NOT NULL,
	"decision" "review_decision" NOT NULL,
	"quality_grade" "quality_grade",
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "deliverable_spec" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "acceptance_criteria" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "quality_grade" "quality_grade";--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "needs_final_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "first_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "first_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_reviews" ADD CONSTRAINT "task_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_reviews_task_created_idx" ON "task_reviews" USING btree ("task_id","created_at");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_first_approved_by_users_id_fk" FOREIGN KEY ("first_approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;