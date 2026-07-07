ALTER TABLE "org_nodes" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "org_nodes" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
UPDATE "org_nodes" SET "kind" = 'group' WHERE "kind" = 'unit';--> statement-breakpoint
DROP TYPE "public"."org_node_kind";--> statement-breakpoint
CREATE TYPE "public"."org_node_kind" AS ENUM('department', 'group');--> statement-breakpoint
ALTER TABLE "org_nodes" ALTER COLUMN "kind" SET DATA TYPE "public"."org_node_kind" USING "kind"::"public"."org_node_kind";--> statement-breakpoint
ALTER TABLE "org_nodes" ALTER COLUMN "kind" SET DEFAULT 'group';
