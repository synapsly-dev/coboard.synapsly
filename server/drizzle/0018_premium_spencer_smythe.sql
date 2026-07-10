CREATE TYPE "public"."application_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
ALTER TYPE "public"."org_node_kind" ADD VALUE 'position';--> statement-breakpoint
CREATE TABLE "org_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" "application_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "org_nodes" ADD COLUMN "headcount" integer;--> statement-breakpoint
ALTER TABLE "org_applications" ADD CONSTRAINT "org_applications_node_id_org_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."org_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_applications" ADD CONSTRAINT "org_applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_applications" ADD CONSTRAINT "org_applications_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_applications_node_idx" ON "org_applications" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "org_applications_user_idx" ON "org_applications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_applications_pending_uniq" ON "org_applications" USING btree ("node_id","user_id") WHERE status = 'pending';