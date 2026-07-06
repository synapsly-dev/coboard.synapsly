import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OrgNodeResponse, OrgTreeResponse, ProjectRole } from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/session.js';
import {
  orgNodeMembers,
  orgNodes,
  projectMembers,
  projects,
  users,
  type UserRow,
} from '../src/db/schema.js';

/**
 * Org-tree (团队架构) tests. Covers create/list (tree assembly), edit, move
 * (reorder + reparent, cycle rejection, cross-scope rejection), cascade delete,
 * set-members (leads/members split, disjoint validation), and the scope
 * authorization matrix (whole-team tree = admin; project tree = lead; viewers).
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
      email: `org-user${seq}@example.com`,
      passwordHash: 'x',
      displayName: `用户${seq}`,
      avatarColor: '#3b82f6',
      role,
    })
    .returning();
  if (!row) throw new Error('failed to insert user');
  return row;
}

async function makeProject(ctx: TestContext, createdBy: string): Promise<string> {
  seq += 1;
  const [row] = await ctx.db
    .insert(projects)
    .values({ name: `项目${seq}`, key: `OPRJ${seq}`, createdBy })
    .returning();
  if (!row) throw new Error('failed to insert project');
  return row.id;
}

async function addMember(
  ctx: TestContext,
  projectId: string,
  userId: string,
  role: ProjectRole = 'member',
): Promise<void> {
  await ctx.db.insert(projectMembers).values({ projectId, userId, role });
}

async function authCookie(ctx: TestContext, userId: string): Promise<string> {
  const { token } = await createSession(ctx.db, userId);
  const signed = ctx.app.signCookie(token);
  return `${SESSION_COOKIE}=${signed}`;
}

function headers(cookie: string): Record<string, string> {
  return { cookie, 'x-requested-with': 'fetch' };
}

async function createNode(
  ctx: TestContext,
  cookie: string,
  body: Record<string, unknown>,
): Promise<OrgNodeResponse> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/org/nodes',
    headers: headers(cookie),
    payload: body,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as OrgNodeResponse;
}

async function getTree(
  ctx: TestContext,
  cookie: string,
  scope: string,
): Promise<OrgTreeResponse> {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/org/tree?scope=${scope}`,
    headers: headers(cookie),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as OrgTreeResponse;
}

describe('org tree / 团队架构', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    await ctx.db.delete(orgNodeMembers);
    await ctx.db.delete(orgNodes);
    await ctx.db.delete(projectMembers);
    await ctx.db.delete(projects);
    await ctx.db.delete(users);
    seq = 0;
  });

  it('admin builds a whole-team tree; any member can view it', async () => {
    const admin = await makeUser(ctx, 'admin');
    const member = await makeUser(ctx, 'member');
    const adminCookie = await authCookie(ctx, admin.id);
    const memberCookie = await authCookie(ctx, member.id);

    const root = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'department',
      title: '工程部',
    });
    await createNode(ctx, adminCookie, {
      scope: 'all',
      parentId: root.node.id,
      kind: 'group',
      title: '前端组',
    });

    // A plain member can read the whole-team tree.
    const tree = await getTree(ctx, memberCookie, 'all');
    expect(tree.nodes).toHaveLength(2);
    const titles = tree.nodes.map((n) => n.title).sort();
    expect(titles).toEqual(['前端组', '工程部']);
  });

  it('rejects a non-admin editing the whole-team tree (403)', async () => {
    const member = await makeUser(ctx, 'member');
    const cookie = await authCookie(ctx, member.id);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/org/nodes',
      headers: headers(cookie),
      payload: { scope: 'all', kind: 'unit', title: '越权' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('project lead edits the project tree; a member may view but not edit', async () => {
    const lead = await makeUser(ctx, 'member');
    const member = await makeUser(ctx, 'member');
    const projectId = await makeProject(ctx, lead.id);
    await addMember(ctx, projectId, lead.id, 'lead');
    await addMember(ctx, projectId, member.id, 'member');
    const leadCookie = await authCookie(ctx, lead.id);
    const memberCookie = await authCookie(ctx, member.id);

    const node = await createNode(ctx, leadCookie, {
      scope: projectId,
      kind: 'group',
      title: '小组A',
    });

    // Member can view.
    const tree = await getTree(ctx, memberCookie, projectId);
    expect(tree.nodes).toHaveLength(1);

    // Member cannot create.
    const denied = await ctx.app.inject({
      method: 'POST',
      url: '/api/org/nodes',
      headers: headers(memberCookie),
      payload: { scope: projectId, kind: 'unit', title: '越权' },
    });
    expect(denied.statusCode).toBe(403);

    // Member cannot edit an existing node either.
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/org/nodes/${node.node.id}`,
      headers: headers(memberCookie),
      payload: { title: '改名' },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('non-member cannot view a project tree (403)', async () => {
    const lead = await makeUser(ctx, 'member');
    const outsider = await makeUser(ctx, 'member');
    const projectId = await makeProject(ctx, lead.id);
    await addMember(ctx, projectId, lead.id, 'lead');
    const outsiderCookie = await authCookie(ctx, outsider.id);

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/org/tree?scope=${projectId}`,
      headers: headers(outsiderCookie),
    });
    expect(res.statusCode).toBe(403);
  });

  it('reorders siblings via move (beforeId)', async () => {
    const admin = await makeUser(ctx, 'admin');
    const cookie = await authCookie(ctx, admin.id);
    const a = await createNode(ctx, cookie, { scope: 'all', kind: 'unit', title: 'A' });
    const b = await createNode(ctx, cookie, { scope: 'all', kind: 'unit', title: 'B' });

    // Initially A before B (append order).
    let tree = await getTree(ctx, cookie, 'all');
    let ordered = [...tree.nodes].sort((x, y) => x.rank.localeCompare(y.rank));
    expect(ordered.map((n) => n.title)).toEqual(['A', 'B']);

    // Move B before A.
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/org/nodes/${b.node.id}/move`,
      headers: headers(cookie),
      payload: { parentId: null, beforeId: a.node.id },
    });
    expect(res.statusCode).toBe(200);

    tree = await getTree(ctx, cookie, 'all');
    ordered = [...tree.nodes].sort((x, y) => x.rank.localeCompare(y.rank));
    expect(ordered.map((n) => n.title)).toEqual(['B', 'A']);
  });

  it('reparents a node (indent) and rejects moving a node under its own descendant', async () => {
    const admin = await makeUser(ctx, 'admin');
    const cookie = await authCookie(ctx, admin.id);
    const parent = await createNode(ctx, cookie, { scope: 'all', kind: 'department', title: '父' });
    const child = await createNode(ctx, cookie, {
      scope: 'all',
      parentId: parent.node.id,
      kind: 'group',
      title: '子',
    });

    // Move `parent` under `child` — would create a cycle → 400.
    const cycle = await ctx.app.inject({
      method: 'POST',
      url: `/api/org/nodes/${parent.node.id}/move`,
      headers: headers(cookie),
      payload: { parentId: child.node.id, beforeId: null },
    });
    expect(cycle.statusCode).toBe(400);

    // A valid reparent: make the child a root.
    const ok = await ctx.app.inject({
      method: 'POST',
      url: `/api/org/nodes/${child.node.id}/move`,
      headers: headers(cookie),
      payload: { parentId: null, beforeId: null },
    });
    expect(ok.statusCode).toBe(200);
    const moved = ok.json() as OrgNodeResponse;
    expect(moved.node.parentId).toBeNull();
  });

  it('cascade-deletes the whole subtree', async () => {
    const admin = await makeUser(ctx, 'admin');
    const cookie = await authCookie(ctx, admin.id);
    const root = await createNode(ctx, cookie, { scope: 'all', kind: 'department', title: '根' });
    await createNode(ctx, cookie, {
      scope: 'all',
      parentId: root.node.id,
      kind: 'group',
      title: '子',
    });

    const del = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/org/nodes/${root.node.id}`,
      headers: headers(cookie),
    });
    expect(del.statusCode).toBe(204);

    const tree = await getTree(ctx, cookie, 'all');
    expect(tree.nodes).toHaveLength(0);
  });

  it('sets a node’s leads and members (disjoint), and rejects overlap', async () => {
    const admin = await makeUser(ctx, 'admin');
    const alice = await makeUser(ctx, 'member');
    const bob = await makeUser(ctx, 'member');
    const cookie = await authCookie(ctx, admin.id);
    const node = await createNode(ctx, cookie, { scope: 'all', kind: 'group', title: '组' });

    const set = await ctx.app.inject({
      method: 'PUT',
      url: `/api/org/nodes/${node.node.id}/members`,
      headers: headers(cookie),
      payload: { leads: [alice.id], members: [bob.id] },
    });
    expect(set.statusCode).toBe(200);
    const updated = set.json() as OrgNodeResponse;
    expect(updated.node.leads.map((m) => m.userId)).toEqual([alice.id]);
    expect(updated.node.members.map((m) => m.userId)).toEqual([bob.id]);
    expect(updated.node.leads[0]?.role).toBe('lead');

    // Overlap (same user as both lead and member) → 400.
    const overlap = await ctx.app.inject({
      method: 'PUT',
      url: `/api/org/nodes/${node.node.id}/members`,
      headers: headers(cookie),
      payload: { leads: [alice.id], members: [alice.id] },
    });
    expect(overlap.statusCode).toBe(400);
  });

  it('rejects creating a node whose parent is in a different scope', async () => {
    const admin = await makeUser(ctx, 'admin');
    const projectId = await makeProject(ctx, admin.id);
    const cookie = await authCookie(ctx, admin.id);

    // A whole-team root.
    const root = await createNode(ctx, cookie, { scope: 'all', kind: 'unit', title: '全团队根' });

    // Try to attach a project-scoped node under the whole-team parent → 400.
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/org/nodes',
      headers: headers(cookie),
      payload: { scope: projectId, parentId: root.node.id, kind: 'unit', title: '错配' },
    });
    expect(res.statusCode).toBe(400);
  });
});
