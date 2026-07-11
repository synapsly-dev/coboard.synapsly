import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TaskResponse, TrackResponse, TracksResponse } from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/session.js';
import {
  projectMembers,
  projects,
  taskClaimants,
  tasks,
  trackMembers,
  tracks,
  users,
  type UserRow,
} from '../src/db/schema.js';

/**
 * 赛道 (Track) tests (P0). Covers CRUD + roster (managers/members), the delete guard
 * (409 while owning projects), project→track assignment, task_type read/write, and
 * the key new authority: a 赛道运营经理 (track manager) is project-lead-equivalent over
 * every project in the track — able to review a task they neither created nor lead —
 * while being blocked on projects in OTHER tracks.
 */

let seq = 0;

async function makeUser(
  ctx: TestContext,
  role: 'admin' | 'member' = 'member',
): Promise<UserRow> {
  seq += 1;
  const [row] = await ctx.db
    .insert(users)
    .values({
      email: `track-user${seq}@example.com`,
      passwordHash: 'x',
      displayName: `用户${seq}`,
      avatarColor: '#3b82f6',
      role,
    })
    .returning();
  if (!row) throw new Error('failed to insert user');
  return row;
}

async function authCookie(ctx: TestContext, userId: string): Promise<string> {
  const { token } = await createSession(ctx.db, userId);
  const signed = ctx.app.signCookie(token);
  return `${SESSION_COOKIE}=${signed}`;
}

function headers(cookie: string): Record<string, string> {
  return { cookie, 'x-requested-with': 'fetch' };
}

async function createTrack(
  ctx: TestContext,
  cookie: string,
  body: Record<string, unknown>,
): Promise<TrackResponse> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/tracks',
    headers: headers(cookie),
    payload: body,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as TrackResponse;
}

describe('赛道 / tracks (P0)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    await ctx.db.delete(taskClaimants);
    await ctx.db.delete(tasks);
    await ctx.db.delete(trackMembers);
    await ctx.db.delete(projectMembers);
    await ctx.db.delete(projects);
    await ctx.db.delete(tracks);
    await ctx.db.delete(users);
    seq = 0;
  });

  it('admin creates a track; any member can list it', async () => {
    const admin = await makeUser(ctx, 'admin');
    const member = await makeUser(ctx, 'member');
    const adminCookie = await authCookie(ctx, admin.id);
    const memberCookie = await authCookie(ctx, member.id);

    const { track } = await createTrack(ctx, adminCookie, {
      name: '升学',
      key: 'shengxue',
      weeklyGoal: '本周产出 3 个有效选题',
    });
    expect(track.name).toBe('升学');
    expect(track.key).toBe('shengxue');
    expect(track.weeklyGoal).toBe('本周产出 3 个有效选题');
    expect(track.projectCount).toBe(0);
    expect(track.managers).toEqual([]);

    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/tracks',
      headers: headers(memberCookie),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as TracksResponse;
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0]!.name).toBe('升学');
  });

  it('forbids a non-admin from creating a track (403)', async () => {
    const member = await makeUser(ctx, 'member');
    const cookie = await authCookie(ctx, member.id);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/tracks',
      headers: headers(cookie),
      payload: { name: '求职', key: 'qiuzhi' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a duplicate track key (409)', async () => {
    const admin = await makeUser(ctx, 'admin');
    const cookie = await authCookie(ctx, admin.id);
    await createTrack(ctx, cookie, { name: '升学', key: 'shengxue' });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/tracks',
      headers: headers(cookie),
      payload: { name: '升学2', key: 'shengxue' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('sets managers/members and assigns a project to the track', async () => {
    const admin = await makeUser(ctx, 'admin');
    const mgr = await makeUser(ctx, 'member');
    const adminCookie = await authCookie(ctx, admin.id);
    const { track } = await createTrack(ctx, adminCookie, { name: '升学', key: 'shengxue' });

    const setRes = await ctx.app.inject({
      method: 'PUT',
      url: `/api/tracks/${track.id}/members`,
      headers: headers(adminCookie),
      payload: { managers: [mgr.id], members: [] },
    });
    expect(setRes.statusCode).toBe(200);
    const setBody = setRes.json() as TrackResponse;
    expect(setBody.track.managers.map((m) => m.userId)).toEqual([mgr.id]);

    // Create a project under the track.
    const projRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(adminCookie),
      payload: { name: '内容组', key: 'CONTENT', trackId: track.id },
    });
    expect(projRes.statusCode).toBe(201);
    const proj = projRes.json() as { project: { id: string; trackId: string | null } };
    expect(proj.project.trackId).toBe(track.id);

    // The listing now reports one project under the track.
    const listRes = await ctx.app.inject({
      method: 'GET',
      url: '/api/tracks',
      headers: headers(adminCookie),
    });
    const body = listRes.json() as TracksResponse;
    expect(body.tracks[0]!.projectCount).toBe(1);
  });

  it('refuses to delete a track that still owns projects (409)', async () => {
    const admin = await makeUser(ctx, 'admin');
    const adminCookie = await authCookie(ctx, admin.id);
    const { track } = await createTrack(ctx, adminCookie, { name: '升学', key: 'shengxue' });
    await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(adminCookie),
      payload: { name: '内容组', key: 'CONTENT', trackId: track.id },
    });

    const delRes = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/tracks/${track.id}`,
      headers: headers(adminCookie),
    });
    expect(delRes.statusCode).toBe(409);
  });

  it('a 赛道运营经理 can review a task in the track without being its project lead', async () => {
    const admin = await makeUser(ctx, 'admin');
    const mgr = await makeUser(ctx, 'member');
    const worker = await makeUser(ctx, 'member');
    const adminCookie = await authCookie(ctx, admin.id);
    const mgrCookie = await authCookie(ctx, mgr.id);
    const workerCookie = await authCookie(ctx, worker.id);

    const { track } = await createTrack(ctx, adminCookie, { name: '升学', key: 'shengxue' });
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/tracks/${track.id}/members`,
      headers: headers(adminCookie),
      payload: { managers: [mgr.id], members: [] },
    });

    // A project in the track whose lead is `admin`; the manager is NOT a member.
    const projRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(adminCookie),
      payload: { name: '内容组', key: 'CONTENT', trackId: track.id },
    });
    const projectId = (projRes.json() as { project: { id: string } }).project.id;
    // Enroll the worker so they can claim.
    await ctx.db.insert(projectMembers).values({ projectId, userId: worker.id, role: 'member' });

    // Worker creates + claims + delivers a task.
    const taskRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: headers(workerCookie),
      payload: { title: '写 3 个选题', projectId, taskType: 'baseline', points: 5 },
    });
    expect(taskRes.statusCode).toBe(201);
    const taskId = (taskRes.json() as TaskResponse).task.id;
    // The created task carries its task_type.
    expect((taskRes.json() as TaskResponse).task.taskType).toBe('baseline');

    await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/claim`,
      headers: headers(workerCookie),
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/deliver`,
      headers: headers(workerCookie),
      payload: { allocations: [{ userId: worker.id, points: 5 }] },
    });

    // The track manager — not a project member, not the lead — approves it.
    const reviewRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/review`,
      headers: headers(mgrCookie),
      payload: { decision: 'approve' },
    });
    expect(reviewRes.statusCode).toBe(200);
    expect((reviewRes.json() as TaskResponse).task.status).toBe('done');
  });

  it('a track manager has NO authority over a project in a different track (403)', async () => {
    const admin = await makeUser(ctx, 'admin');
    const mgr = await makeUser(ctx, 'member');
    const worker = await makeUser(ctx, 'member');
    const adminCookie = await authCookie(ctx, admin.id);
    const mgrCookie = await authCookie(ctx, mgr.id);
    const workerCookie = await authCookie(ctx, worker.id);

    // mgr manages track A only.
    const { track: trackA } = await createTrack(ctx, adminCookie, { name: '升学', key: 'shengxue' });
    const { track: trackB } = await createTrack(ctx, adminCookie, { name: '求职', key: 'qiuzhi' });
    await ctx.app.inject({
      method: 'PUT',
      url: `/api/tracks/${trackA.id}/members`,
      headers: headers(adminCookie),
      payload: { managers: [mgr.id], members: [] },
    });

    // A project in track B; worker delivers a task there.
    const projRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(adminCookie),
      payload: { name: '求职内容', key: 'QZC', trackId: trackB.id },
    });
    const projectId = (projRes.json() as { project: { id: string } }).project.id;
    await ctx.db.insert(projectMembers).values({ projectId, userId: worker.id, role: 'member' });

    const taskRes = await ctx.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers: headers(workerCookie),
      payload: { title: '任务', projectId, points: 3 },
    });
    const taskId = (taskRes.json() as TaskResponse).task.id;
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/claim`,
      headers: headers(workerCookie),
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/deliver`,
      headers: headers(workerCookie),
      payload: { allocations: [{ userId: worker.id, points: 3 }] },
    });

    // The track-A manager must NOT be able to review track-B's task.
    const reviewRes = await ctx.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/review`,
      headers: headers(mgrCookie),
      payload: { decision: 'approve' },
    });
    expect(reviewRes.statusCode).toBe(403);
  });
});

describe('赛道经理的项目管理权 (2026-07-11 spec)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    await ctx.db.delete(taskClaimants);
    await ctx.db.delete(tasks);
    await ctx.db.delete(trackMembers);
    await ctx.db.delete(projectMembers);
    await ctx.db.delete(projects);
    await ctx.db.delete(tracks);
    await ctx.db.delete(users);
    seq = 0;
  });

  /** Admin + a manager managing `managed`, returning both cookies + track ids. */
  async function setupManager(managedCount = 1): Promise<{
    adminCookie: string;
    mgrCookie: string;
    mgr: UserRow;
    trackIds: string[];
  }> {
    const admin = await makeUser(ctx, 'admin');
    const mgr = await makeUser(ctx, 'member');
    const adminCookie = await authCookie(ctx, admin.id);
    const mgrCookie = await authCookie(ctx, mgr.id);
    const trackIds: string[] = [];
    for (let i = 0; i < managedCount; i += 1) {
      const { track } = await createTrack(ctx, adminCookie, {
        name: `赛道${i + 1}`,
        key: `mgr-track-${i + 1}`,
      });
      await ctx.app.inject({
        method: 'PUT',
        url: `/api/tracks/${track.id}/members`,
        headers: headers(adminCookie),
        payload: { managers: [mgr.id], members: [] },
      });
      trackIds.push(track.id);
    }
    return { adminCookie, mgrCookie, mgr, trackIds };
  }

  it('lets a 赛道经理 create a project inside their track and auto-become its lead', async () => {
    const { mgrCookie, mgr, trackIds } = await setupManager();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(mgrCookie),
      payload: { name: '内容组', key: 'MPRJ1', trackId: trackIds[0] },
    });
    expect(res.statusCode).toBe(201);
    const { project } = res.json() as { project: { id: string; trackId: string | null } };
    expect(project.trackId).toBe(trackIds[0]);

    // Creator auto-enrolled as the project's lead.
    const members = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${project.id}/members`,
      headers: headers(mgrCookie),
    });
    const body = members.json() as { members: { userId: string; role: string }[] };
    expect(body.members).toEqual([
      expect.objectContaining({ userId: mgr.id, role: 'lead' }),
    ]);
  });

  it('requires a trackId from a 赛道经理 (400) and rejects a foreign track (403)', async () => {
    const { adminCookie, mgrCookie } = await setupManager();
    const noTrack = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(mgrCookie),
      payload: { name: '组', key: 'MPRJ2' },
    });
    expect(noTrack.statusCode).toBe(400);

    const { track: foreign } = await createTrack(ctx, adminCookie, {
      name: '外部赛道',
      key: 'foreign-track',
    });
    const wrongTrack = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(mgrCookie),
      payload: { name: '组', key: 'MPRJ3', trackId: foreign.id },
    });
    expect(wrongTrack.statusCode).toBe(403);
  });

  it('still forbids a plain member from creating projects (403)', async () => {
    const member = await makeUser(ctx, 'member');
    const cookie = await authCookie(ctx, member.id);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(cookie),
      payload: { name: '组', key: 'MPRJ4' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('keeps admin creation unrestricted (no trackId needed)', async () => {
    const admin = await makeUser(ctx, 'admin');
    const cookie = await authCookie(ctx, admin.id);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(cookie),
      payload: { name: '组', key: 'MPRJ5' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('lets a manager of both tracks move a project between them, but not to a foreign track', async () => {
    const { adminCookie, mgrCookie, trackIds } = await setupManager(2);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(mgrCookie),
      payload: { name: '组', key: 'MPRJ6', trackId: trackIds[0] },
    });
    const projectId = (created.json() as { project: { id: string } }).project.id;

    const move = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      headers: headers(mgrCookie),
      payload: { trackId: trackIds[1] },
    });
    expect(move.statusCode).toBe(200);
    expect((move.json() as { project: { trackId: string | null } }).project.trackId).toBe(
      trackIds[1],
    );

    const { track: foreign } = await createTrack(ctx, adminCookie, {
      name: '外部赛道',
      key: 'foreign-move',
    });
    const bad = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      headers: headers(mgrCookie),
      payload: { trackId: foreign.id },
    });
    expect(bad.statusCode).toBe(403);
  });

  it('forbids a plain project lead (non-manager) from changing trackId but not from renaming', async () => {
    const { adminCookie, trackIds } = await setupManager();
    const lead = await makeUser(ctx, 'member');
    const leadCookie = await authCookie(ctx, lead.id);
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(adminCookie),
      payload: { name: '组', key: 'MPRJ7', trackId: trackIds[0] },
    });
    const projectId = (created.json() as { project: { id: string } }).project.id;
    await ctx.db.insert(projectMembers).values({ projectId, userId: lead.id, role: 'lead' });

    const rename = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      headers: headers(leadCookie),
      payload: { name: '组·改名' },
    });
    expect(rename.statusCode).toBe(200);

    const move = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      headers: headers(leadCookie),
      payload: { trackId: null },
    });
    expect(move.statusCode).toBe(403);
  });

  it('keeps admin trackId moves unrestricted', async () => {
    const { adminCookie, trackIds } = await setupManager();
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: headers(adminCookie),
      payload: { name: '组', key: 'MPRJ8', trackId: trackIds[0] },
    });
    const projectId = (created.json() as { project: { id: string } }).project.id;
    const move = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      headers: headers(adminCookie),
      payload: { trackId: null },
    });
    expect(move.statusCode).toBe(200);
  });
});
