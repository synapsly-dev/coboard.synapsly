ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text USING "role"::text;--> statement-breakpoint
DROP TYPE "public"."user_role";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'admin', 'member');--> statement-breakpoint
WITH first_admin AS (
  SELECT "id"
  FROM "users"
  WHERE "role" = 'admin'
  ORDER BY "created_at" ASC, "id" ASC
  LIMIT 1
)
UPDATE "users"
SET "role" = 'super_admin'
WHERE "id" IN (SELECT "id" FROM first_admin)
  AND NOT EXISTS (
    SELECT 1 FROM "users" WHERE "role" = 'super_admin'
  );--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_super_admin_uniq"
  ON "users" ("role")
  WHERE "role" = 'super_admin';
