import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type {
  OrgApplicationResponse,
  OrgApplicationsResponse,
  OrgNodeResponse,
  ProjectRole,
} from 'shared';
import type { TestContext } from './helpers.js';
import { createTestContext } from './helpers.js';
import { createSession, SESSION_COOKIE } from '../src/auth/session.js';
import {
  orgApplications,
  orgNodeMembers,
  orgNodes,
  projectMembers,
  projects,
  trackMembers,
  tracks,
  users,
  type UserRow,
} from '../src/db/schema.js';

/**
 * 岗位申报 (P1) tests. Covers apply (position-only, duplicate / already-a-member /
 * headcount conflicts), the approver rule (whole-team ancestor lead, project lead,
 * global admin — and who may NOT decide), approve (member row + decided_by,
 * re-checked headcount), reject (decision note, no member row), withdraw (own
 * pending only), and the GET list + canDecideNodeIds visibility split.
 */

let seq = 0;

async function makeUser(ctx: TestContext, role: 'admin' | 'member' = 'member'): Promise<UserRow> {
  seq += 1;
  const [row] = await ctx.db
    .insert(users)
    .values({
      email: `org-app-user${seq}@example.com`,
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
    .values({ name: `项目${seq}`, key: `OAPP${seq}`, createdBy })
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

async function setNodeMembers(
  ctx: TestContext,
  cookie: string,
  nodeId: string,
  leads: string[],
  members: string[],
): Promise<void> {
  const res = await ctx.app.inject({
    method: 'PUT',
    url: `/api/org/nodes/${nodeId}/members`,
    headers: headers(cookie),
    payload: { leads, members },
  });
  expect(res.statusCode).toBe(200);
}

async function applyTo(ctx: TestContext, cookie: string, nodeId: string, note?: string) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/org/nodes/${nodeId}/applications`,
    headers: headers(cookie),
    payload: note === undefined ? {} : { note },
  });
}

async function decide(
  ctx: TestContext,
  cookie: string,
  applicationId: string,
  decision: 'approve' | 'reject',
  note?: string,
) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/org/applications/${applicationId}/${decision}`,
    headers: headers(cookie),
    payload: note === undefined ? {} : { note },
  });
}

async function listApplications(
  ctx: TestContext,
  cookie: string,
  scope = 'all',
): Promise<OrgApplicationsResponse> {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/org/applications?scope=${scope}`,
    headers: headers(cookie),
  });
  expect(res.statusCode).toBe(200);
  return res.json() as OrgApplicationsResponse;
}

async function memberRows(ctx: TestContext, nodeId: string, userId: string) {
  return ctx.db
    .select()
    .from(orgNodeMembers)
    .where(and(eq(orgNodeMembers.nodeId, nodeId), eq(orgNodeMembers.userId, userId)));
}

describe('岗位申报 / org applications', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  afterEach(async () => {
    await ctx.db.delete(orgApplications);
    await ctx.db.delete(orgNodeMembers);
    await ctx.db.delete(orgNodes);
    await ctx.db.delete(trackMembers);
    await ctx.db.delete(tracks);
    await ctx.db.delete(projectMembers);
    await ctx.db.delete(projects);
    await ctx.db.delete(users);
    seq = 0;
  });

  it('member applies to a position and sees it in their list', async () => {
    const admin = await makeUser(ctx, 'admin');
    const member = await makeUser(ctx);
    const adminCookie = await authCookie(ctx, admin.id);
    const memberCookie = await authCookie(ctx, member.id);

    const position = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'position',
      title: '前端工程师',
      headcount: 3,
    });
    expect(position.node.headcount).toBe(3);

    const res = await applyTo(ctx, memberCookie, position.node.id, '我想加入');
    expect(res.statusCode).toBe(201);
    const { application } = res.json() as OrgApplicationResponse;
    expect(application.status).toBe('pending');
    expect(application.nodeId).toBe(position.node.id);
    expect(application.nodeTitle).toBe('前端工程师');
    expect(application.projectId).toBeNull();
    expect(application.note).toBe('我想加入');
    expect(application.applicant.id).toBe(member.id);
    expect(application.decidedBy).toBeNull();
    expect(application.decidedAt).toBeNull();

    const list = await listApplications(ctx, memberCookie);
    expect(list.applications.map((a) => a.id)).toEqual([application.id]);
    expect(list.canDecideNodeIds).toHaveLength(0);
  });

  it('member applies to a 部门/小组; approval writes the member row (2026-07-13)', async () => {
    const admin = await makeUser(ctx, 'admin');
    const member = await makeUser(ctx);
    const adminCookie = await authCookie(ctx, admin.id);
    const memberCookie = await authCookie(ctx, member.id);

    const dept = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'department',
      title: '增长部',
    });
    const group = await createNode(ctx, adminCookie, {
      scope: 'all',
      parentId: dept.node.id,
      kind: 'group',
      title: '内容组',
    });

    // Applying to a group (headcount 不限) succeeds and starts pending.
    const applied = await applyTo(ctx, memberCookie, group.node.id, '想加入内容组');
    expect(applied.statusCode).toBe(201);
    const applicationId = (applied.json() as OrgApplicationResponse).application.id;

    // Admin approves → the applicant becomes a member of the group.
    const approved = await decide(ctx, adminCookie, applicationId, 'approve');
    expect(approved.statusCode).toBe(200);
    const rows = await memberRows(ctx, group.node.id, member.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('member');
  });

  it('applying to a 赛道 (track) node is rejected with 400 (use direct join)', async () => {
    const admin = await makeUser(ctx, 'admin');
    const member = await makeUser(ctx);
    const memberCookie = await authCookie(ctx, member.id);

    // A track node is created via track management; emulate the linked node.
    const [track] = await ctx.db
      .insert(tracks)
      .values({ name: '增长赛道', key: `TRK${(seq += 1)}`, rank: '000000', createdBy: admin.id })
      .returning();
    const [trackNode] = await ctx.db
      .insert(orgNodes)
      .values({ kind: 'track', trackId: track!.id, title: '增长赛道', rank: '000000' })
      .returning();

    const res = await applyTo(ctx, memberCookie, trackNode!.id);
    expect(res.statusCode).toBe(400);
  });

  it('self-leave a 部门/小组: member row removed; 负责人 → 409; non-member idempotent', async () => {
    const admin = await makeUser(ctx, 'admin');
    const member = await makeUser(ctx);
    const lead = await makeUser(ctx);
    const stranger = await makeUser(ctx);
    const adminCookie = await authCookie(ctx, admin.id);
    const memberCookie = await authCookie(ctx, member.id);
    const leadCookie = await authCookie(ctx, lead.id);
    const strangerCookie = await authCookie(ctx, stranger.id);

    const group = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'group',
      title: '投放组',
    });
    await setNodeMembers(ctx, adminCookie, group.node.id, [lead.id], [member.id]);

    const leave = async (cookie: string) =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/org/nodes/${group.node.id}/leave`,
        headers: headers(cookie),
      });

    // A 负责人 cannot self-leave.
    const asLead = await leave(leadCookie);
    expect(asLead.statusCode).toBe(409);
    expect(await memberRows(ctx, group.node.id, lead.id)).toHaveLength(1);

    // A member leaves → their row is gone.
    const asMember = await leave(memberCookie);
    expect(asMember.statusCode).toBe(200);
    expect(await memberRows(ctx, group.node.id, member.id)).toHaveLength(0);

    // A non-member leaving is a no-op (idempotent 200).
    const asStranger = await leave(strangerCookie);
    expect(asStranger.statusCode).toBe(200);
  });

  it('rejects a duplicate pending application and an existing occupant applying (409)', async () => {
    const admin = await makeUser(ctx, 'admin');
    const applicant = await makeUser(ctx);
    const occupant = await makeUser(ctx);
    const adminCookie = await authCookie(ctx, admin.id);
    const applicantCookie = await authCookie(ctx, applicant.id);
    const occupantCookie = await authCookie(ctx, occupant.id);

    const position = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'position',
      title: '运营专员',
    });
    await setNodeMembers(ctx, adminCookie, position.node.id, [], [occupant.id]);

    const first = await applyTo(ctx, applicantCookie, position.node.id);
    expect(first.statusCode).toBe(201);
    const dup = await applyTo(ctx, applicantCookie, position.node.id);
    expect(dup.statusCode).toBe(409);

    // Someone already on the node cannot apply again.
    const already = await applyTo(ctx, occupantCookie, position.node.id);
    expect(already.statusCode).toBe(409);
  });

  it('rejects applying to a full position (headcount reached) with 409', async () => {
    const admin = await makeUser(ctx, 'admin');
    const occupant = await makeUser(ctx);
    const applicant = await makeUser(ctx);
    const adminCookie = await authCookie(ctx, admin.id);
    const applicantCookie = await authCookie(ctx, applicant.id);

    const position = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'position',
      title: '设计师',
      headcount: 1,
    });
    await setNodeMembers(ctx, adminCookie, position.node.id, [], [occupant.id]);

    const res = await applyTo(ctx, applicantCookie, position.node.id);
    expect(res.statusCode).toBe(409);
  });

  it('ancestor lead approves: member row written, decided_by set; re-deciding → 409', async () => {
    const admin = await makeUser(ctx, 'admin');
    const lead = await makeUser(ctx);
    const applicant = await makeUser(ctx);
    const adminCookie = await authCookie(ctx, admin.id);
    const leadCookie = await authCookie(ctx, lead.id);
    const applicantCookie = await authCookie(ctx, applicant.id);

    const dept = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'department',
      title: '工程部',
    });
    const position = await createNode(ctx, adminCookie, {
      scope: 'all',
      parentId: dept.node.id,
      kind: 'position',
      title: '后端工程师',
      headcount: 2,
    });
    // The lead sits on the PARENT department node, not the position itself.
    await setNodeMembers(ctx, adminCookie, dept.node.id, [lead.id], []);

    const applied = await applyTo(ctx, applicantCookie, position.node.id, '申请加入');
    expect(applied.statusCode).toBe(201);
    const applicationId = (applied.json() as OrgApplicationResponse).application.id;

    const approved = await decide(ctx, leadCookie, applicationId, 'approve', '欢迎加入');
    expect(approved.statusCode).toBe(200);
    const { application } = approved.json() as OrgApplicationResponse;
    expect(application.status).toBe('approved');
    expect(application.decidedBy).toBe(lead.id);
    expect(application.decisionNote).toBe('欢迎加入');
    expect(application.decidedAt).not.toBeNull();

    const rows = await memberRows(ctx, position.node.id, applicant.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('member');

    // The application is no longer pending — a second decision conflicts.
    const again = await decide(ctx, leadCookie, applicationId, 'approve');
    expect(again.statusCode).toBe(409);
  });

  it('rejects approving when the position filled up after the apply (409)', async () => {
    const admin = await makeUser(ctx, 'admin');
    const applicant = await makeUser(ctx);
    const other = await makeUser(ctx);
    const adminCookie = await authCookie(ctx, admin.id);
    const applicantCookie = await authCookie(ctx, applicant.id);

    const position = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'position',
      title: '测试工程师',
      headcount: 1,
    });

    const applied = await applyTo(ctx, applicantCookie, position.node.id);
    expect(applied.statusCode).toBe(201);
    const applicationId = (applied.json() as OrgApplicationResponse).application.id;

    // The slot fills between apply and approve.
    await ctx.db.insert(orgNodeMembers).values({
      nodeId: position.node.id,
      userId: other.id,
      role: 'member',
      rank: '000000',
    });

    const approved = await decide(ctx, adminCookie, applicationId, 'approve');
    expect(approved.statusCode).toBe(409);
    // No member row was written for the applicant.
    expect(await memberRows(ctx, position.node.id, applicant.id)).toHaveLength(0);
  });

  it('reject records the decision note and writes NO member row', async () => {
    const admin = await makeUser(ctx, 'admin');
    const applicant = await makeUser(ctx);
    const adminCookie = await authCookie(ctx, admin.id);
    const applicantCookie = await authCookie(ctx, applicant.id);

    const position = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'position',
      title: '产品经理',
    });
    const applied = await applyTo(ctx, applicantCookie, position.node.id);
    expect(applied.statusCode).toBe(201);
    const applicationId = (applied.json() as OrgApplicationResponse).application.id;

    const rejected = await decide(ctx, adminCookie, applicationId, 'reject', '经验不足');
    expect(rejected.statusCode).toBe(200);
    const { application } = rejected.json() as OrgApplicationResponse;
    expect(application.status).toBe('rejected');
    expect(application.decisionNote).toBe('经验不足');
    expect(application.decidedBy).toBe(admin.id);

    expect(await memberRows(ctx, position.node.id, applicant.id)).toHaveLength(0);
  });

  it('withdraws own pending application; someone else’s → 403', async () => {
    const admin = await makeUser(ctx, 'admin');
    const applicant = await makeUser(ctx);
    const other = await makeUser(ctx);
    const adminCookie = await authCookie(ctx, admin.id);
    const applicantCookie = await authCookie(ctx, applicant.id);
    const otherCookie = await authCookie(ctx, other.id);

    const position = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'position',
      title: '增长运营',
    });
    const applied = await applyTo(ctx, applicantCookie, position.node.id);
    expect(applied.statusCode).toBe(201);
    const applicationId = (applied.json() as OrgApplicationResponse).application.id;

    // Not the applicant → 403.
    const denied = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/org/applications/${applicationId}`,
      headers: headers(otherCookie),
    });
    expect(denied.statusCode).toBe(403);

    const withdrawn = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/org/applications/${applicationId}`,
      headers: headers(applicantCookie),
    });
    expect(withdrawn.statusCode).toBe(200);
    const { application } = withdrawn.json() as OrgApplicationResponse;
    expect(application.status).toBe('withdrawn');
    expect(application.decidedBy).toBeNull();
    expect(application.decidedAt).not.toBeNull();

    // Already withdrawn → deciding it conflicts.
    const late = await decide(ctx, adminCookie, applicationId, 'approve');
    expect(late.statusCode).toBe(409);
  });

  it('permission matrix: plain member and other-subtree lead cannot decide; admin can', async () => {
    const admin = await makeUser(ctx, 'admin');
    const plain = await makeUser(ctx);
    const otherLead = await makeUser(ctx);
    const applicant = await makeUser(ctx);
    const adminCookie = await authCookie(ctx, admin.id);
    const plainCookie = await authCookie(ctx, plain.id);
    const otherLeadCookie = await authCookie(ctx, otherLead.id);
    const applicantCookie = await authCookie(ctx, applicant.id);

    const deptA = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'department',
      title: '部门A',
    });
    const positionA = await createNode(ctx, adminCookie, {
      scope: 'all',
      parentId: deptA.node.id,
      kind: 'position',
      title: 'A岗位',
    });
    const deptB = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'department',
      title: '部门B',
    });
    // otherLead leads a DIFFERENT subtree (department B).
    await setNodeMembers(ctx, adminCookie, deptB.node.id, [otherLead.id], []);

    const applied = await applyTo(ctx, applicantCookie, positionA.node.id);
    expect(applied.statusCode).toBe(201);
    const applicationId = (applied.json() as OrgApplicationResponse).application.id;

    const asPlain = await decide(ctx, plainCookie, applicationId, 'approve');
    expect(asPlain.statusCode).toBe(403);

    const asOtherLead = await decide(ctx, otherLeadCookie, applicationId, 'approve');
    expect(asOtherLead.statusCode).toBe(403);

    const asAdmin = await decide(ctx, adminCookie, applicationId, 'approve');
    expect(asAdmin.statusCode).toBe(200);
  });

  it('GET /org/applications: approver sees others’ pending + canDecideNodeIds; plain member only their own', async () => {
    const admin = await makeUser(ctx, 'admin');
    const lead = await makeUser(ctx);
    const alice = await makeUser(ctx);
    const bob = await makeUser(ctx);
    const adminCookie = await authCookie(ctx, admin.id);
    const leadCookie = await authCookie(ctx, lead.id);
    const aliceCookie = await authCookie(ctx, alice.id);
    const bobCookie = await authCookie(ctx, bob.id);

    const dept = await createNode(ctx, adminCookie, {
      scope: 'all',
      kind: 'department',
      title: '市场部',
    });
    const position = await createNode(ctx, adminCookie, {
      scope: 'all',
      parentId: dept.node.id,
      kind: 'position',
      title: '市场专员',
    });
    await setNodeMembers(ctx, adminCookie, dept.node.id, [lead.id], []);

    const a = await applyTo(ctx, aliceCookie, position.node.id);
    expect(a.statusCode).toBe(201);
    const b = await applyTo(ctx, bobCookie, position.node.id);
    expect(b.statusCode).toBe(201);

    // The (ancestor) lead sees both pending applications and may decide the node.
    const asLead = await listApplications(ctx, leadCookie);
    expect(asLead.applications).toHaveLength(2);
    expect(asLead.canDecideNodeIds).toContain(position.node.id);

    // A plain applicant only sees their own and decides nothing.
    const asAlice = await listApplications(ctx, aliceCookie);
    expect(asAlice.applications.map((x) => x.applicant.id)).toEqual([alice.id]);
    expect(asAlice.canDecideNodeIds).toHaveLength(0);
  });

  it('project tree: project lead decides; non-members cannot even list the scope', async () => {
    const lead = await makeUser(ctx);
    const member = await makeUser(ctx);
    const outsider = await makeUser(ctx);
    const projectId = await makeProject(ctx, lead.id);
    await addMember(ctx, projectId, lead.id, 'lead');
    await addMember(ctx, projectId, member.id, 'member');
    const leadCookie = await authCookie(ctx, lead.id);
    const memberCookie = await authCookie(ctx, member.id);
    const outsiderCookie = await authCookie(ctx, outsider.id);

    const position = await createNode(ctx, leadCookie, {
      scope: projectId,
      kind: 'position',
      title: '项目岗位',
      headcount: 1,
    });

    const applied = await applyTo(ctx, memberCookie, position.node.id);
    expect(applied.statusCode).toBe(201);
    const applicationId = (applied.json() as OrgApplicationResponse).application.id;

    // Non-member cannot list a project scope.
    const denied = await ctx.app.inject({
      method: 'GET',
      url: `/api/org/applications?scope=${projectId}`,
      headers: headers(outsiderCookie),
    });
    expect(denied.statusCode).toBe(403);

    // The project lead sees the pending application and may decide every scope node.
    const asLead = await listApplications(ctx, leadCookie, projectId);
    expect(asLead.applications.map((x) => x.id)).toEqual([applicationId]);
    expect(asLead.canDecideNodeIds).toContain(position.node.id);

    // The plain project member sees only their own, with no decide rights.
    const asMember = await listApplications(ctx, memberCookie, projectId);
    expect(asMember.applications.map((x) => x.id)).toEqual([applicationId]);
    expect(asMember.canDecideNodeIds).toHaveLength(0);

    const approved = await decide(ctx, leadCookie, applicationId, 'approve');
    expect(approved.statusCode).toBe(200);
    expect(await memberRows(ctx, position.node.id, member.id)).toHaveLength(1);
  });
});
