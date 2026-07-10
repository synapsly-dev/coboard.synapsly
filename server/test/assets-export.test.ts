import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Asset, AssetResponse, AssetsResponse } from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/session.js';
import {
  assets,
  ideas,
  projectMembers,
  projects,
  taskClaimants,
  tasks,
  trackMembers,
  tracks,
  users,
  type NewTaskRow,
} from '../src/db/schema.js';

/**
 * P3 tests: 资产库 CRUD + the author/admin/赛道经理 permission matrix + source-task
 * 溯源 survival, and the CSV exports (成员分数表 / 任务明细) — permission tiers
 * (member 403 / 赛道经理 track-scoped / admin full incl. 灵感采纳 rows), BOM +
 * header shape, trackId filtering, and RFC4180 quoting. Mirrors the conventions
 * of tracks.test.ts (session-cookie auth, direct seeding, afterEach cleanup).
 */

const CSRF = { 'x-requested-with': 'XMLHttpRequest' };

let ctx: TestContext;

/** Counter to keep seeded emails/keys unique across tests. */
let seq = 0;

interface SeededUser {
  id: string;
  displayName: string;
  email: string;
  cookie: string;
}

/** Insert a user and return its id/display fields plus a signed session cookie. */
async function seedUser(role: 'admin' | 'member' = 'member'): Promise<SeededUser> {
  seq += 1;
  const [row] = await ctx.db
    .insert(users)
    .values({
      email: `p3-u${seq}@coboard.test`,
      passwordHash: 'x',
      displayName: `成员${seq}号`,
      avatarColor: '#3b82f6',
      role,
    })
    .returning();
  if (!row) throw new Error('seedUser: no row');
  const { token } = await createSession(ctx.db, row.id);
  const cookie = `${SESSION_COOKIE}=${ctx.app.signCookie(token)}`;
  return { id: row.id, displayName: row.displayName, email: row.email, cookie };
}

/** Insert a 赛道 and return its id. */
async function seedTrack(creatorId: string, name?: string): Promise<string> {
  seq += 1;
  const [row] = await ctx.db
    .insert(tracks)
    .values({
      name: name ?? `赛道${seq}`,
      key: `t${seq}`,
      rank: 'n',
      createdBy: creatorId,
    })
    .returning();
  if (!row) throw new Error('seedTrack: no row');
  return row.id;
}

/** Make `userId` a 赛道运营经理 of `trackId`. */
async function addTrackManager(trackId: string, userId: string): Promise<void> {
  await ctx.db
    .insert(trackMembers)
    .values({ trackId, userId, role: 'manager', rank: 'n' });
}

/** Insert a project created by `creatorId`, optionally owned by a track. */
async function seedProject(
  creatorId: string,
  trackId: string | null = null,
  name?: string,
): Promise<string> {
  seq += 1;
  const [row] = await ctx.db
    .insert(projects)
    .values({
      name: name ?? `项目${seq}`,
      key: `p${seq}`,
      trackId,
      createdBy: creatorId,
    })
    .returning();
  if (!row) throw new Error('seedProject: no row');
  return row.id;
}

/** Add a project membership row. */
async function addMember(
  projectId: string,
  userId: string,
  role: 'lead' | 'member' = 'member',
): Promise<void> {
  await ctx.db.insert(projectMembers).values({ projectId, userId, role });
}

/** Insert a task row directly (bypassing the API) for setup. */
async function seedTask(
  values: Partial<NewTaskRow> & { projectId: string | null; createdBy: string },
): Promise<string> {
  const [row] = await ctx.db
    .insert(tasks)
    .values({ title: '任务', rank: 'n', status: 'open', ...values })
    .returning();
  if (!row) throw new Error('seedTask: no row');
  return row.id;
}

// --- asset API helpers ------------------------------------------------------

function postAsset(u: SeededUser, payload: Record<string, unknown>) {
  return ctx.app.inject({
    method: 'POST',
    url: '/api/assets',
    headers: { cookie: u.cookie, ...CSRF },
    payload,
  });
}

async function createAssetOk(
  u: SeededUser,
  payload: Record<string, unknown>,
): Promise<Asset> {
  const res = await postAsset(u, payload);
  expect(res.statusCode).toBe(201);
  return (res.json() as AssetResponse).asset;
}

function patchAsset(u: SeededUser, id: string, payload: Record<string, unknown>) {
  return ctx.app.inject({
    method: 'PATCH',
    url: `/api/assets/${id}`,
    headers: { cookie: u.cookie, ...CSRF },
    payload,
  });
}

function deleteAssetReq(u: SeededUser, id: string) {
  return ctx.app.inject({
    method: 'DELETE',
    url: `/api/assets/${id}`,
    headers: { cookie: u.cookie, ...CSRF },
  });
}

async function listAssetsOk(u: SeededUser, qs = ''): Promise<Asset[]> {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/assets${qs}`,
    headers: { cookie: u.cookie },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as AssetsResponse).assets;
}

// --- deliver/review helpers (build done tasks via the API, like review tests) --

function deliver(
  taskId: string,
  u: SeededUser,
  allocations: { userId: string; points: number }[],
) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/deliver`,
    headers: { cookie: u.cookie, ...CSRF },
    payload: { allocations },
  });
}

function review(taskId: string, u: SeededUser, payload: Record<string, unknown>) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/review`,
    headers: { cookie: u.cookie, ...CSRF },
    payload,
  });
}

/**
 * Seed a project task claimed by `worker`, then complete it through the real
 * deliver → approve flow so completed_at / points / reviewed_by are all set.
 */
async function completeTask(opts: {
  projectId: string;
  title: string;
  worker: SeededUser;
  reviewer: SeededUser;
  points?: number;
  qualityGrade?: 'a' | 'b' | 'c' | 'd';
}): Promise<string> {
  const taskId = await seedTask({
    projectId: opts.projectId,
    createdBy: opts.reviewer.id,
    status: 'in_progress',
    title: opts.title,
    points: opts.points ?? 3,
  });
  await ctx.db.insert(taskClaimants).values({ taskId, userId: opts.worker.id });
  const delivered = await deliver(taskId, opts.worker, [
    { userId: opts.worker.id, points: opts.points ?? 3 },
  ]);
  expect(delivered.statusCode).toBe(200);
  const approved = await review(taskId, opts.reviewer, {
    decision: 'approve',
    ...(opts.qualityGrade ? { qualityGrade: opts.qualityGrade } : {}),
  });
  expect(approved.statusCode).toBe(200);
  return taskId;
}

function exportCsv(u: SeededUser, url: string) {
  return ctx.app.inject({ method: 'GET', url, headers: { cookie: u.cookie } });
}

/** Today's filename stamp, computed the same way as the route (UTC date). */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

describe('资产库 + CSV 导出 (P3)', () => {
  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    await ctx.db.delete(assets);
    await ctx.db.delete(ideas);
    await ctx.db.delete(taskClaimants);
    await ctx.db.delete(tasks);
    await ctx.db.delete(trackMembers);
    await ctx.db.delete(projectMembers);
    await ctx.db.delete(projects);
    await ctx.db.delete(tracks);
    await ctx.db.delete(users);
    seq = 0;
  });

  // -------------------------------------------------------------------------
  // Assets: create
  // -------------------------------------------------------------------------

  it('member creates a body-only asset and a link-only asset; neither body nor url → 400', async () => {
    const member = await seedUser('member');

    const bodyOnly = await createAssetOk(member, {
      kind: 'content',
      title: '爆款标题结构',
      body: '三段式：钩子 → 冲突 → 行动号召',
    });
    expect(bodyOnly.kind).toBe('content');
    expect(bodyOnly.body).toBe('三段式：钩子 → 冲突 → 行动号召');
    expect(bodyOnly.url).toBeNull();
    expect(bodyOnly.trackId).toBeNull();
    expect(bodyOnly.taskId).toBeNull();
    expect(bodyOnly.creator.id).toBe(member.id);

    const linkOnly = await createAssetOk(member, {
      kind: 'resource',
      title: '剪辑素材站',
      url: 'https://example.com/assets',
    });
    expect(linkOnly.body).toBe(''); // link-only assets default to an empty body
    expect(linkOnly.url).toBe('https://example.com/assets');

    const neither = await postAsset(member, { kind: 'content', title: '空的' });
    expect(neither.statusCode).toBe(400);
  });

  it('validates the optional track/task references (404 赛道不存在 / 任务不存在)', async () => {
    const member = await seedUser('member');
    const missingTrack = await postAsset(member, {
      kind: 'content',
      title: 'x',
      body: 'y',
      trackId: '00000000-0000-4000-8000-000000000000',
    });
    expect(missingTrack.statusCode).toBe(404);
    const missingTask = await postAsset(member, {
      kind: 'content',
      title: 'x',
      body: 'y',
      taskId: '00000000-0000-4000-8000-000000000000',
    });
    expect(missingTask.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Assets: list + filters + resolved context
  // -------------------------------------------------------------------------

  it('lists newest first, filters by kind and trackId, and resolves trackName/taskTitle/creator', async () => {
    const admin = await seedUser('admin');
    const member = await seedUser('member');
    const trackA = await seedTrack(admin.id, '升学赛道');
    const trackB = await seedTrack(admin.id, '求职赛道');
    const taskId = await seedTask({
      projectId: null,
      createdBy: admin.id,
      title: '写周报模板',
    });

    const a1 = await createAssetOk(member, {
      kind: 'content',
      title: '来自任务的沉淀',
      body: '正文',
      trackId: trackA,
      taskId,
    });
    await createAssetOk(member, {
      kind: 'feedback',
      title: '用户反馈一条',
      body: '太贵了',
      trackId: trackB,
    });
    const a3 = await createAssetOk(member, {
      kind: 'content',
      title: '通用素材',
      body: '素材',
    });

    const all = await listAssetsOk(member);
    expect(all.map((a) => a.title)).toEqual(['通用素材', '用户反馈一条', '来自任务的沉淀']);

    const contentOnly = await listAssetsOk(member, '?kind=content');
    expect(contentOnly.map((a) => a.id).sort()).toEqual([a1.id, a3.id].sort());

    const trackAOnly = await listAssetsOk(member, `?trackId=${trackA}`);
    expect(trackAOnly.map((a) => a.id)).toEqual([a1.id]);
    expect(trackAOnly[0]!.trackName).toBe('升学赛道');
    expect(trackAOnly[0]!.taskTitle).toBe('写周报模板');
    expect(trackAOnly[0]!.creator.id).toBe(member.id);
    expect(trackAOnly[0]!.creator.displayName).toBe(member.displayName);
  });

  // -------------------------------------------------------------------------
  // Assets: edit/delete permission matrix
  // -------------------------------------------------------------------------

  it('author edits own; other plain member 403; admin and 赛道经理 (any track) edit all', async () => {
    const admin = await seedUser('admin');
    const author = await seedUser('member');
    const other = await seedUser('member');
    const mgr = await seedUser('member');
    // The manager runs an UNRELATED track — asset curation is team-wide (P3 §1).
    const trackId = await seedTrack(admin.id);
    await addTrackManager(trackId, mgr.id);

    const asset = await createAssetOk(author, {
      kind: 'issue',
      title: '发布流程卡点',
      body: '审核排队超过 48h',
    });

    const own = await patchAsset(author, asset.id, { title: '发布流程卡点（更新）' });
    expect(own.statusCode).toBe(200);
    expect((own.json() as AssetResponse).asset.title).toBe('发布流程卡点（更新）');

    const stranger = await patchAsset(other, asset.id, { title: '越权改名' });
    expect(stranger.statusCode).toBe(403);

    const byAdmin = await patchAsset(admin, asset.id, { body: '已联系平台加急' });
    expect(byAdmin.statusCode).toBe(200);
    expect((byAdmin.json() as AssetResponse).asset.body).toBe('已联系平台加急');

    const byMgr = await patchAsset(mgr, asset.id, { kind: 'feedback' });
    expect(byMgr.statusCode).toBe(200);
    expect((byMgr.json() as AssetResponse).asset.kind).toBe('feedback');

    // updatedAt was bumped past createdAt by the edits.
    const [row] = await ctx.db.select().from(assets).where(eq(assets.id, asset.id));
    expect(row!.updatedAt.getTime()).toBeGreaterThan(row!.createdAt.getTime());
  });

  it('delete follows the same matrix: plain member 403, admin 204', async () => {
    const admin = await seedUser('admin');
    const author = await seedUser('member');
    const other = await seedUser('member');
    const asset = await createAssetOk(author, {
      kind: 'resource',
      title: '摄影棚联系方式',
      body: '电话 138…',
    });

    expect((await deleteAssetReq(other, asset.id)).statusCode).toBe(403);
    expect((await deleteAssetReq(admin, asset.id)).statusCode).toBe(204);
    expect(await listAssetsOk(author)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Assets: 溯源 survives source-task deletion
  // -------------------------------------------------------------------------

  it('an asset survives its source task deletion (taskId → null, still listed)', async () => {
    const member = await seedUser('member');
    const taskId = await seedTask({
      projectId: null,
      createdBy: member.id,
      title: '会被删除的任务',
    });
    const asset = await createAssetOk(member, {
      kind: 'content',
      title: '沉淀自任务',
      body: '任务产出的模板',
      taskId,
    });
    expect(asset.taskTitle).toBe('会被删除的任务');

    await ctx.db.delete(tasks).where(eq(tasks.id, taskId));

    const listed = await listAssetsOk(member);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(asset.id);
    expect(listed[0]!.taskId).toBeNull();
    expect(listed[0]!.taskTitle).toBeNull();
  });

  // -------------------------------------------------------------------------
  // GET /export/scores.csv
  // -------------------------------------------------------------------------

  it('scores.csv: plain member 403; admin gets BOM + header + task row + 灵感采纳 row', async () => {
    const admin = await seedUser('admin');
    const worker = await seedUser('member');
    const member = await seedUser('member');
    const trackId = await seedTrack(admin.id, '内容赛道');
    const projectId = await seedProject(admin.id, trackId, '短视频项目');
    await addMember(projectId, worker.id, 'member');
    await completeTask({
      projectId,
      title: '剪辑三条短视频',
      worker,
      reviewer: admin,
      points: 3,
      qualityGrade: 'a',
    });
    // An adopted idea credits reward points (admin-only export rows).
    await ctx.db.insert(ideas).values({
      authorId: worker.id,
      body: '把每周复盘的金句沉淀进内容库，标题直接复用',
      status: 'adopted',
      rewardPoints: 5,
      adoptedBy: admin.id,
    });

    const denied = await exportCsv(member, '/api/export/scores.csv');
    expect(denied.statusCode).toBe(403);

    const res = await exportCsv(admin, '/api/export/scores.csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="scores-${todayStamp()}.csv"`,
    );

    const body = res.body;
    expect(body.startsWith('\ufeff')).toBe(true);
    const lines = body.replace(/^\ufeff/, '').split('\r\n').filter((l) => l !== '');
    expect(lines[0]).toBe('成员,邮箱,赛道,项目,任务,任务类型,最终点数,交付质量,审核人,复核状态,完成时间');
    // One task row + one adopted-idea row.
    expect(lines).toHaveLength(3);
    const taskLine = lines.find((l) => l.includes('剪辑三条短视频'));
    expect(taskLine).toBeDefined();
    expect(taskLine).toContain(worker.displayName);
    expect(taskLine).toContain(worker.email);
    expect(taskLine).toContain('内容赛道');
    expect(taskLine).toContain('短视频项目');
    expect(taskLine).toContain(',3,'); // 最终点数 = the claimant's share
    expect(taskLine).toContain(',A,'); // 交付质量 letter
    expect(taskLine).toContain(admin.displayName); // 审核人
    expect(taskLine).toContain('无需复核');
    const ideaLine = lines.find((l) => l.includes('灵感采纳'));
    expect(ideaLine).toBeDefined();
    expect(ideaLine).toContain(worker.displayName);
    expect(ideaLine).toContain(',5,'); // rewardPoints
    expect(ideaLine).toContain(admin.displayName); // adoptedBy
  });

  it('scores.csv: 赛道经理 only gets rows from their managed track (and no idea rows)', async () => {
    const admin = await seedUser('admin');
    const worker = await seedUser('member');
    const mgr = await seedUser('member');
    const trackA = await seedTrack(admin.id, '甲赛道');
    const trackB = await seedTrack(admin.id, '乙赛道');
    await addTrackManager(trackA, mgr.id);
    const projectA = await seedProject(admin.id, trackA, '甲项目');
    const projectB = await seedProject(admin.id, trackB, '乙项目');
    await addMember(projectA, worker.id, 'member');
    await addMember(projectB, worker.id, 'member');
    await completeTask({ projectId: projectA, title: '甲赛道任务', worker, reviewer: admin });
    await completeTask({ projectId: projectB, title: '乙赛道任务', worker, reviewer: admin });
    await ctx.db.insert(ideas).values({
      authorId: worker.id,
      body: '一个好点子',
      status: 'adopted',
      rewardPoints: 2,
      adoptedBy: admin.id,
    });

    const res = await exportCsv(mgr, '/api/export/scores.csv');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('甲赛道任务');
    expect(res.body).toContain('甲项目');
    expect(res.body).not.toContain('乙赛道任务');
    expect(res.body).not.toContain('乙项目');
    expect(res.body).not.toContain('灵感采纳'); // idea rows are admin-only

    // The admin sees both tracks' rows.
    const full = await exportCsv(admin, '/api/export/scores.csv');
    expect(full.body).toContain('甲赛道任务');
    expect(full.body).toContain('乙赛道任务');
  });

  // -------------------------------------------------------------------------
  // GET /export/tasks.csv
  // -------------------------------------------------------------------------

  it('tasks.csv: admin 200 with 提交物要求 value; trackId filter narrows; RFC4180 quoting', async () => {
    const admin = await seedUser('admin');
    const member = await seedUser('member');
    const trackA = await seedTrack(admin.id, '甲赛道');
    const trackB = await seedTrack(admin.id, '乙赛道');
    const projectA = await seedProject(admin.id, trackA, '甲项目');
    const projectB = await seedProject(admin.id, trackB, '乙项目');
    await seedTask({
      projectId: projectA,
      createdBy: admin.id,
      title: '写"周报", 附数据',
      deliverableSpec: '提交 PDF 文档 + 数据表链接',
      taskType: 'baseline',
    });
    await seedTask({ projectId: projectB, createdBy: admin.id, title: '乙赛道任务' });

    const denied = await exportCsv(member, '/api/export/tasks.csv');
    expect(denied.statusCode).toBe(403);

    const res = await exportCsv(admin, '/api/export/tasks.csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="tasks-${todayStamp()}.csv"`,
    );
    expect(res.body.startsWith('\ufeff')).toBe(true);
    const lines = res.body.replace(/^\ufeff/, '').split('\r\n').filter((l) => l !== '');
    expect(lines[0]).toBe(
      '任务,任务类型,状态,赛道,项目,优先级,基础点数,交付质量,提交物要求,验收标准,DDL,需复核,初审人,复核人,认领人,创建时间,完成时间',
    );
    expect(lines).toHaveLength(3);
    expect(res.body).toContain('提交 PDF 文档 + 数据表链接');
    // RFC4180: the comma+quote title arrives quoted with doubled inner quotes.
    expect(res.body).toContain('"写""周报"", 附数据"');
    expect(res.body).toContain('B · 底线任务');
    expect(res.body).toContain('待认领');

    // trackId filter narrows to the one track's rows.
    const filtered = await exportCsv(admin, `/api/export/tasks.csv?trackId=${trackA}`);
    expect(filtered.statusCode).toBe(200);
    expect(filtered.body).toContain('周报');
    expect(filtered.body).not.toContain('乙赛道任务');
  });

  it('tasks.csv: 赛道经理 is scoped to their tracks and cannot filter by a foreign track', async () => {
    const admin = await seedUser('admin');
    const mgr = await seedUser('member');
    const worker = await seedUser('member');
    const trackA = await seedTrack(admin.id, '甲赛道');
    const trackB = await seedTrack(admin.id, '乙赛道');
    await addTrackManager(trackA, mgr.id);
    const projectA = await seedProject(admin.id, trackA, '甲项目');
    const projectB = await seedProject(admin.id, trackB, '乙项目');
    const taskA = await seedTask({ projectId: projectA, createdBy: admin.id, title: '甲赛道任务' });
    await seedTask({ projectId: projectB, createdBy: admin.id, title: '乙赛道任务' });
    // 认领人 column: worker claims the 甲 task.
    await ctx.db.insert(taskClaimants).values({ taskId: taskA, userId: worker.id });

    const res = await exportCsv(mgr, '/api/export/tasks.csv');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('甲赛道任务');
    expect(res.body).toContain(worker.displayName); // 认领人 resolved
    expect(res.body).not.toContain('乙赛道任务');

    const foreign = await exportCsv(mgr, `/api/export/tasks.csv?trackId=${trackB}`);
    expect(foreign.statusCode).toBe(403);
  });
});
