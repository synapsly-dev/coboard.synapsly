ALTER TABLE "org_nodes" ADD COLUMN "track_id" uuid;--> statement-breakpoint
ALTER TABLE "org_nodes" ADD CONSTRAINT "org_nodes_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_nodes_track_id_uniq" ON "org_nodes" USING btree ("track_id");--> statement-breakpoint

-- Reuse an existing whole-team root such as "升学赛道" for a Track named
-- "升学". Matching is deliberately narrow: only root departments, ignoring
-- whitespace and one trailing "赛道" suffix. Duplicate names pair deterministically.
WITH track_candidates AS (
	SELECT
		"id" AS "track_id",
		lower(regexp_replace(regexp_replace(btrim("name"), '[[:space:]]+', '', 'g'), '赛道$', '')) AS "normalized_name",
		row_number() OVER (
			PARTITION BY lower(regexp_replace(regexp_replace(btrim("name"), '[[:space:]]+', '', 'g'), '赛道$', ''))
			ORDER BY "created_at", "id"
		) AS "ordinal"
	FROM "tracks"
),
node_candidates AS (
	SELECT
		"id" AS "node_id",
		lower(regexp_replace(regexp_replace(btrim("title"), '[[:space:]]+', '', 'g'), '赛道$', '')) AS "normalized_name",
		row_number() OVER (
			PARTITION BY lower(regexp_replace(regexp_replace(btrim("title"), '[[:space:]]+', '', 'g'), '赛道$', ''))
			ORDER BY "created_at", "id"
		) AS "ordinal"
	FROM "org_nodes"
	WHERE "project_id" IS NULL
		AND "parent_id" IS NULL
		AND "track_id" IS NULL
		AND "kind" = 'department'
)
UPDATE "org_nodes" AS node
SET "track_id" = track."track_id", "kind" = 'track'::"org_node_kind"
FROM node_candidates AS candidate
INNER JOIN track_candidates AS track
	ON track."normalized_name" = candidate."normalized_name"
	AND track."ordinal" = candidate."ordinal"
WHERE node."id" = candidate."node_id";--> statement-breakpoint

-- Every remaining Track receives a visual root. Appending "赛道" keeps the
-- established organization-tree wording while the badge now carries the real type.
INSERT INTO "org_nodes" (
	"id", "project_id", "parent_id", "track_id", "kind", "title",
	"description", "headcount", "rank", "created_at", "updated_at"
)
SELECT
	gen_random_uuid(), NULL, NULL, track."id", 'track'::"org_node_kind",
	CASE
		WHEN btrim(track."name") ~ '赛道$' THEN btrim(track."name")
		ELSE btrim(track."name") || '赛道'
	END,
	track."description", NULL, track."rank", track."created_at", track."updated_at"
FROM "tracks" AS track
LEFT JOIN "org_nodes" AS node ON node."track_id" = track."id"
WHERE node."id" IS NULL;--> statement-breakpoint

-- Track membership becomes the single source of truth for linked nodes. Preserve
-- both existing rosters: org leads become managers, ordinary org members remain
-- members, and an existing manager always wins a role conflict.
INSERT INTO "track_members" ("track_id", "user_id", "role", "rank", "created_at")
SELECT
	node."track_id",
	member."user_id",
	CASE
		WHEN member."role" = 'lead' THEN 'manager'::"track_member_role"
		ELSE 'member'::"track_member_role"
	END,
	member."rank",
	now()
FROM "org_nodes" AS node
INNER JOIN "org_node_members" AS member ON member."node_id" = node."id"
WHERE node."track_id" IS NOT NULL
ON CONFLICT ("track_id", "user_id") DO UPDATE
SET "role" = CASE
		WHEN "track_members"."role" = 'manager' OR excluded."role" = 'manager'
			THEN 'manager'::"track_member_role"
		ELSE 'member'::"track_member_role"
	END;--> statement-breakpoint

DELETE FROM "org_node_members" AS member
USING "org_nodes" AS node
WHERE member."node_id" = node."id" AND node."track_id" IS NOT NULL;
