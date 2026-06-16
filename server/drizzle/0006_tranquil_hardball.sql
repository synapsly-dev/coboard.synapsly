ALTER TABLE "activities" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "project_id" DROP NOT NULL;