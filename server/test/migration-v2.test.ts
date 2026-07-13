import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Migration test for lifecycle v2 (§2, §6). Verifies the 0003 migration:
 * - adds the new `task_status` enum value `pending_review` (usable post-migration),
 * - adds the new `activity_type` values `delivered` / `rejected`,
 * - creates the `task_claimants` table,
 * - performs the data copy (deprecated `assignee_id` / `completed_by` →
 *   `task_claimants`) with the correct per-claimant points logic.
 *
 * It replays the generated SQL up to 0002, seeds legacy single-assignee task rows,
 * then applies 0003 and asserts the resulting claimant rows.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(here, '../drizzle');

interface MigrationJournal {
  entries: { idx: number; tag: string }[];
}

/** Read the ordered migration tags from the drizzle journal. */
async function orderedTags(): Promise<string[]> {
  const journalPath = join(MIGRATIONS_FOLDER, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as MigrationJournal;
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);
}

/** Apply a single migration file (split on the drizzle statement-breakpoint). */
async function applyMigration(pglite: PGlite, tag: string): Promise<void> {
  const raw = await readFile(join(MIGRATIONS_FOLDER, `${tag}.sql`), 'utf8');
  const statements = raw
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await pglite.exec(statement);
  }
}

let pglite: PGlite | undefined;

afterEach(async () => {
  if (pglite) {
    await pglite.close();
    pglite = undefined;
  }
});

describe('0003_task_lifecycle_v2 migration', () => {
  it('adds the enum value + task_claimants and copies legacy assignees', async () => {
    pglite = new PGlite();
    const tags = await orderedTags();
    const v2Tag = '0003_task_lifecycle_v2';
    const v2Index = tags.indexOf(v2Tag);
    expect(v2Index).toBeGreaterThan(0);

    // 1) Apply everything up to (but excluding) the v2 migration — the v1 schema.
    for (const tag of tags.slice(0, v2Index)) {
      await applyMigration(pglite, tag);
    }

    // 2) Seed legacy data using the v1 single-assignee shape.
    await pglite.exec(`
      INSERT INTO users (id, email, password_hash, display_name, avatar_color)
      VALUES
        ('11111111-1111-1111-1111-111111111111', 'a@x.com', 'h', 'Alice', '#3b82f6'),
        ('22222222-2222-2222-2222-222222222222', 'b@x.com', 'h', 'Bob',   '#ef4444');
      INSERT INTO projects (id, name, key, created_by)
      VALUES ('33333333-3333-3333-3333-333333333333', 'P', 'P1',
              '11111111-1111-1111-1111-111111111111');
    `);
    // Task 1: in_progress, assigned to Alice (not done) → claimant with NULL points.
    // Task 2: done, assignee=Alice, completed_by=Bob → two claimants; the done
    //         points (5) are copied onto both legacy rows.
    await pglite.exec(`
      INSERT INTO tasks (id, project_id, title, status, assignee_id, points,
                         created_by, rank, completed_at, completed_by, created_at)
      VALUES
        ('44444444-4444-4444-4444-444444444444',
         '33333333-3333-3333-3333-333333333333', 'T1', 'in_progress',
         '11111111-1111-1111-1111-111111111111', NULL,
         '11111111-1111-1111-1111-111111111111', 'a', NULL, NULL, now()),
        ('55555555-5555-5555-5555-555555555555',
         '33333333-3333-3333-3333-333333333333', 'T2', 'done',
         '11111111-1111-1111-1111-111111111111', 5,
         '11111111-1111-1111-1111-111111111111', 'b', now(),
         '22222222-2222-2222-2222-222222222222', now());
    `);

    // Pre-condition: task_claimants does not exist yet.
    const preCheck = await pglite.query<{ exists: boolean }>(
      `SELECT to_regclass('public.task_claimants') IS NOT NULL AS exists;`,
    );
    expect(preCheck.rows[0]?.exists).toBe(false);

    // 3) Apply the v2 migration.
    await applyMigration(pglite, v2Tag);

    // 4a) The new enum value is usable.
    const enumRows = await pglite.query<{ value: string }>(
      `SELECT unnest(enum_range(NULL::task_status))::text AS value;`,
    );
    expect(enumRows.rows.map((r) => r.value)).toContain('pending_review');

    const activityEnum = await pglite.query<{ value: string }>(
      `SELECT unnest(enum_range(NULL::activity_type))::text AS value;`,
    );
    const activityValues = activityEnum.rows.map((r) => r.value);
    expect(activityValues).toContain('delivered');
    expect(activityValues).toContain('rejected');

    // It can actually be written to a row.
    await pglite.exec(
      `UPDATE tasks SET status = 'pending_review'
       WHERE id = '44444444-4444-4444-4444-444444444444';`,
    );
    const updated = await pglite.query<{ status: string }>(
      `SELECT status FROM tasks WHERE id = '44444444-4444-4444-4444-444444444444';`,
    );
    expect(updated.rows[0]?.status).toBe('pending_review');

    // 4b) The data copy populated task_claimants.
    const claimants = await pglite.query<{
      task_id: string;
      user_id: string;
      points: number | null;
    }>(`SELECT task_id, user_id, points FROM task_claimants ORDER BY task_id, user_id;`);
    const rows = claimants.rows.map((r) => ({
      taskId: r.task_id,
      userId: r.user_id,
      points: r.points,
    }));

    // T1: one claimant (Alice), NULL points (task not done).
    const t1 = rows.filter((r) => r.taskId === '44444444-4444-4444-4444-444444444444');
    expect(t1).toEqual([
      {
        taskId: '44444444-4444-4444-4444-444444444444',
        userId: '11111111-1111-1111-1111-111111111111',
        points: null,
      },
    ]);

    // T2: two claimants (assignee Alice + divergent completed_by Bob), each with
    // the done task's points (5).
    const t2 = rows
      .filter((r) => r.taskId === '55555555-5555-5555-5555-555555555555')
      .sort((a, b) => a.userId.localeCompare(b.userId));
    expect(t2).toEqual([
      {
        taskId: '55555555-5555-5555-5555-555555555555',
        userId: '11111111-1111-1111-1111-111111111111',
        points: 5,
      },
      {
        taskId: '55555555-5555-5555-5555-555555555555',
        userId: '22222222-2222-2222-2222-222222222222',
        points: 5,
      },
    ]);
  });
});

describe('0006 no-project tasks migration', () => {
  it('drops NOT NULL on tasks.project_id and activities.project_id (pool tasks insertable)', async () => {
    pglite = new PGlite();
    const tags = await orderedTags();
    const v6Tag = '0006_tranquil_hardball';
    expect(tags).toContain(v6Tag);

    // Apply every migration up to and including 0006.
    const v6Index = tags.indexOf(v6Tag);
    for (const tag of tags.slice(0, v6Index + 1)) {
      await applyMigration(pglite, tag);
    }

    // Both columns must now be nullable.
    const cols = await pglite.query<{ table_name: string; is_nullable: string }>(
      `SELECT table_name, is_nullable FROM information_schema.columns
       WHERE column_name = 'project_id'
         AND table_name IN ('tasks', 'activities')
       ORDER BY table_name;`,
    );
    const nullable = Object.fromEntries(cols.rows.map((r) => [r.table_name, r.is_nullable]));
    expect(nullable.tasks).toBe('YES');
    expect(nullable.activities).toBe('YES');

    // A no-project (pool) task + a no-project activity can be written.
    await pglite.exec(`
      INSERT INTO users (id, email, password_hash, display_name, avatar_color)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'pool@x.com', 'h', 'Pooler', '#3b82f6');
      INSERT INTO tasks (id, project_id, title, status, created_by, rank, created_at)
      VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL, 'Pool task', 'open',
              'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'n', now());
      INSERT INTO activities (id, task_id, project_id, actor_id, type, created_at)
      VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc',
              'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', NULL,
              'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'created', now());
    `);

    const task = await pglite.query<{ project_id: string | null }>(
      `SELECT project_id FROM tasks WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';`,
    );
    expect(task.rows[0]?.project_id).toBeNull();

    const activity = await pglite.query<{ project_id: string | null }>(
      `SELECT project_id FROM activities WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';`,
    );
    expect(activity.rows[0]?.project_id).toBeNull();
  });
});

describe('0016_unique_super_admin migration', () => {
  it('promotes the first admin and enforces a single super_admin', async () => {
    pglite = new PGlite();
    const tags = await orderedTags();
    const superAdminTag = '0016_unique_super_admin';
    const superAdminIndex = tags.indexOf(superAdminTag);
    expect(superAdminIndex).toBeGreaterThan(0);

    for (const tag of tags.slice(0, superAdminIndex)) {
      await applyMigration(pglite, tag);
    }

    await pglite.exec(`
      INSERT INTO users (email, password_hash, display_name, avatar_color, role, created_at)
      VALUES
        ('first-admin@x.com', NULL, 'First Admin', '#3b82f6', 'admin', '2026-01-01T00:00:00Z'),
        ('second-admin@x.com', NULL, 'Second Admin', '#ef4444', 'admin', '2026-01-02T00:00:00Z'),
        ('member@x.com', NULL, 'Member', '#10b981', 'member', '2026-01-03T00:00:00Z');
    `);

    await applyMigration(pglite, superAdminTag);

    const enumRows = await pglite.query<{ value: string }>(
      `SELECT unnest(enum_range(NULL::user_role))::text AS value;`,
    );
    expect(enumRows.rows.map((r) => r.value)).toContain('super_admin');

    const roles = await pglite.query<{ email: string; role: string }>(
      `SELECT email, role::text AS role FROM users ORDER BY created_at;`,
    );
    expect(roles.rows).toEqual([
      { email: 'first-admin@x.com', role: 'super_admin' },
      { email: 'second-admin@x.com', role: 'admin' },
      { email: 'member@x.com', role: 'member' },
    ]);

    await expect(
      pglite.exec(`
        INSERT INTO users (email, password_hash, display_name, avatar_color, role)
        VALUES ('second-sa@x.com', NULL, 'Second SA', '#64748b', 'super_admin');
      `),
    ).rejects.toThrow();
  });
});

describe('0022/0023 Track organization migration', () => {
  it('reuses matching roots, creates missing roots, and preserves both rosters', async () => {
    pglite = new PGlite();
    const tags = await orderedTags();
    const enumTag = '0022_demonic_agent_zero';
    const linkTag = '0023_jittery_frank_castle';
    const enumIndex = tags.indexOf(enumTag);
    expect(enumIndex).toBeGreaterThan(0);
    expect(tags[enumIndex + 1]).toBe(linkTag);

    for (const tag of tags.slice(0, enumIndex)) {
      await applyMigration(pglite, tag);
    }

    await pglite.exec(`
      INSERT INTO users (id, email, display_name, avatar_color, role, created_at)
      VALUES
        ('10000000-0000-0000-0000-000000000001', 'admin@x.com', 'Admin', '#111111', 'admin', '2026-01-01T00:00:00Z'),
        ('10000000-0000-0000-0000-000000000002', 'lead@x.com', 'Lead', '#222222', 'member', '2026-01-02T00:00:00Z'),
        ('10000000-0000-0000-0000-000000000003', 'member@x.com', 'Member', '#333333', 'member', '2026-01-03T00:00:00Z');

      INSERT INTO tracks (id, name, key, rank, created_by, created_at, updated_at)
      VALUES
        ('20000000-0000-0000-0000-000000000001', '升学', 'study', 'a',
         '10000000-0000-0000-0000-000000000001', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
        ('20000000-0000-0000-0000-000000000002', '求职', 'career', 'b',
         '10000000-0000-0000-0000-000000000001', '2026-02-02T00:00:00Z', '2026-02-02T00:00:00Z');

      INSERT INTO org_nodes (id, project_id, parent_id, kind, title, rank, created_at, updated_at)
      VALUES
        ('30000000-0000-0000-0000-000000000001', NULL, NULL, 'department', '升学赛道', 'a',
         '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z'),
        ('30000000-0000-0000-0000-000000000002', NULL,
         '30000000-0000-0000-0000-000000000001', 'group', '内容组', 'a',
         '2026-03-02T00:00:00Z', '2026-03-02T00:00:00Z');

      INSERT INTO org_node_members (node_id, user_id, role, rank)
      VALUES
        ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'lead', 'a'),
        ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'member', 'b');

      INSERT INTO track_members (track_id, user_id, role, rank)
      VALUES
        ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'manager', 'a');
    `);

    await applyMigration(pglite, enumTag);
    await applyMigration(pglite, linkTag);

    const nodes = await pglite.query<{
      id: string;
      parent_id: string | null;
      track_id: string | null;
      kind: string;
      title: string;
    }>(`SELECT id, parent_id, track_id, kind::text AS kind, title FROM org_nodes ORDER BY title;`);

    expect(nodes.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: '30000000-0000-0000-0000-000000000001',
          track_id: '20000000-0000-0000-0000-000000000001',
          kind: 'track',
          title: '升学赛道',
        }),
        expect.objectContaining({
          track_id: '20000000-0000-0000-0000-000000000002',
          kind: 'track',
          title: '求职赛道',
        }),
        expect.objectContaining({
          id: '30000000-0000-0000-0000-000000000002',
          parent_id: '30000000-0000-0000-0000-000000000001',
          kind: 'group',
        }),
      ]),
    );

    const roster = await pglite.query<{ user_id: string; role: string }>(`
      SELECT user_id, role::text AS role
      FROM track_members
      WHERE track_id = '20000000-0000-0000-0000-000000000001'
      ORDER BY user_id;
    `);
    expect(roster.rows).toEqual([
      { user_id: '10000000-0000-0000-0000-000000000002', role: 'manager' },
      // Existing Track manager wins over the legacy org-node member role.
      { user_id: '10000000-0000-0000-0000-000000000003', role: 'manager' },
    ]);

    const legacyRows = await pglite.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM org_node_members
      WHERE node_id = '30000000-0000-0000-0000-000000000001';
    `);
    expect(legacyRows.rows[0]?.count).toBe(0);
  });
});
