-- Adds 'track' to org_node_kind. NOTE: the naive `ALTER TYPE ... ADD VALUE 'track'`
-- (what drizzle-kit generates) is UNSAFE here: drizzle's migrator runs all pending
-- migrations in ONE transaction, and Postgres forbids using a value added via
-- ADD VALUE within the same transaction — 0023 immediately casts to 'track', so a
-- fresh/jumped apply aborts with `unsafe use of new value "track"`. Recreating the
-- enum with the value present at CREATE TYPE is transaction-safe (the label exists
-- from creation, not from ADD VALUE) and yields the identical end state. See the
-- drizzle-enum-migration-pitfall note.
ALTER TABLE "org_nodes" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "org_nodes" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."org_node_kind";--> statement-breakpoint
CREATE TYPE "public"."org_node_kind" AS ENUM('department', 'group', 'position', 'track');--> statement-breakpoint
ALTER TABLE "org_nodes" ALTER COLUMN "kind" SET DATA TYPE "public"."org_node_kind" USING "kind"::"public"."org_node_kind";--> statement-breakpoint
ALTER TABLE "org_nodes" ALTER COLUMN "kind" SET DEFAULT 'group';
