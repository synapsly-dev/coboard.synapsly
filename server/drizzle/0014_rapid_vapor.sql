CREATE TYPE "public"."org_member_role" AS ENUM('lead', 'member');--> statement-breakpoint
CREATE TYPE "public"."org_node_kind" AS ENUM('department', 'group', 'unit');--> statement-breakpoint
CREATE TABLE "org_node_members" (
	"node_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_member_role" NOT NULL,
	"rank" text NOT NULL,
	CONSTRAINT "org_node_members_node_id_user_id_pk" PRIMARY KEY("node_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "org_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"parent_id" uuid,
	"kind" "org_node_kind" DEFAULT 'unit' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"rank" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_node_members" ADD CONSTRAINT "org_node_members_node_id_org_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."org_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_node_members" ADD CONSTRAINT "org_node_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_nodes" ADD CONSTRAINT "org_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_nodes" ADD CONSTRAINT "org_nodes_parent_id_org_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_node_members_user_id_idx" ON "org_node_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "org_nodes_project_parent_idx" ON "org_nodes" USING btree ("project_id","parent_id");--> statement-breakpoint
CREATE INDEX "org_nodes_parent_idx" ON "org_nodes" USING btree ("parent_id");