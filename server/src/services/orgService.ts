import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { isAdminRole } from 'shared';
import type {
  CreateOrgApplicationInput,
  CreateOrgNodeInput,
  DecideOrgApplicationInput,
  MoveOrgNodeInput,
  OrgApplication,
  OrgApplicationsResponse,
  OrgNode,
  OrgNodeMember,
  OrgScope,
  SetOrgMembersInput,
  UpdateOrgNodeInput,
} from 'shared';
import type { Database } from '../db/index.js';
import {
  orgApplications,
  orgNodeMembers,
  orgNodes,
  projectMembers,
  trackMembers,
  users,
  type OrgApplicationRow,
  type OrgNodeRow,
  type UserRow,
} from '../db/schema.js';
import { conflict, forbidden, notFound, validationError } from '../lib/errors.js';
import { publishChange } from './activityService.js';
import { bus, type RealtimeBus } from '../realtime/bus.js';
import { rankBetween } from './taskService.js';
import { setTrackMembers } from './trackService.js';

/**
 * Org-tree service (团队架构 / division-of-labor page). Owns the data access for the
 * flexible, editable org tree: loading a scope's whole tree (nodes + their people),
 * and the create / edit / move / delete / set-members mutations. Authorization (who
 * may edit which scope) is enforced by the route via guards; this layer encodes the
 * data access, the sibling ordering (`rank`), the same-scope + no-cycle invariants,
 * and the realtime fan-out.
 *
 * Scope: a tree is either the whole-team tree (`scope: 'all'`, `project_id` NULL) or a
 * single project's tree (`scope: <projectId>`). Every node in a tree carries the same
 * `project_id`; a node's `project_id` always equals its parent's. Deleting a node
 * cascades to its whole subtree and to every member row (DB-level self-FK cascade).
 *
 * 岗位申报 (P1): this module also owns position applications — apply / withdraw /
 * approve / reject on `position` nodes — including the approver rule
 * ({@link canDecideOnNode}) and the headcount (名额) guard.
 */

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

/** The project id a scope targets: null for the whole-team ('all') tree. */
export function projectIdOfScope(scope: OrgScope): string | null {
  return scope === 'all' ? null : scope;
}

/** The scope a node belongs to (its project id, or 'all' for the whole-team tree). */
export function scopeOfNode(node: OrgNodeRow): OrgScope {
  return node.projectId ?? 'all';
}

// ---------------------------------------------------------------------------
// Row -> wire mapping
// ---------------------------------------------------------------------------

/** Map a user row + role into the node-member wire shape. */
function toOrgNodeMember(user: UserRow, role: 'lead' | 'member'): OrgNodeMember {
  return {
    userId: user.id,
    displayName: user.displayName,
    avatarColor: user.avatarColor,
    hasAvatar: user.avatarMime != null,
    role,
  };
}

/** Map a node row + its (already role-split, ordered) people to the wire shape. */
function toOrgNode(row: OrgNodeRow, leads: OrgNodeMember[], members: OrgNodeMember[]): OrgNode {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    trackId: row.trackId,
    kind: row.kind,
    title: row.title,
    description: row.description,
    headcount: row.headcount,
    rank: row.rank,
    leads,
    members,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Loaders / queries
// ---------------------------------------------------------------------------

/** Load a node by id or throw 404. */
export async function loadOrgNodeOrThrow(db: Database, id: string): Promise<OrgNodeRow> {
  const rows = await db.select().from(orgNodes).where(eq(orgNodes.id, id)).limit(1);
  const node = rows[0];
  if (!node) {
    throw notFound('架构节点不存在');
  }
  return node;
}

/** Predicate matching every node in a scope (project id, or NULL for 'all'). */
function inScope(projectId: string | null) {
  return projectId === null ? isNull(orgNodes.projectId) : eq(orgNodes.projectId, projectId);
}

/**
 * Load a scope's whole tree as a FLAT, rank-ordered list of nodes, each with its
 * people split into `leads` / `members` (ordered by their display rank). The client
 * assembles the actual tree by `parentId`. Returns [] for an empty tree.
 */
export async function listTree(db: Database, scope: OrgScope): Promise<OrgNode[]> {
  const projectId = projectIdOfScope(scope);

  const nodeRows = await db
    .select()
    .from(orgNodes)
    .where(inScope(projectId))
    .orderBy(asc(orgNodes.rank), asc(orgNodes.createdAt));

  if (nodeRows.length === 0) {
    return [];
  }

  const regularNodeIds = nodeRows.filter((n) => n.trackId === null).map((n) => n.id);
  const memberRows =
    regularNodeIds.length > 0
      ? await db
          .select({ member: orgNodeMembers, user: users })
          .from(orgNodeMembers)
          .innerJoin(users, eq(orgNodeMembers.userId, users.id))
          .where(inArray(orgNodeMembers.nodeId, regularNodeIds))
          .orderBy(asc(orgNodeMembers.rank))
      : [];

  const leadsByNode = new Map<string, OrgNodeMember[]>();
  const membersByNode = new Map<string, OrgNodeMember[]>();
  for (const { member, user } of memberRows) {
    const bucket = member.role === 'lead' ? leadsByNode : membersByNode;
    const list = bucket.get(member.nodeId) ?? [];
    list.push(toOrgNodeMember(user, member.role));
    bucket.set(member.nodeId, list);
  }

  // A linked Track node displays the canonical track_members roster. Managers map
  // to visual leads; no duplicate org_node_members rows are maintained for it.
  const trackNodeByTrackId = new Map(
    nodeRows.flatMap((node) => (node.trackId ? [[node.trackId, node.id] as const] : [])),
  );
  const trackIds = [...trackNodeByTrackId.keys()];
  if (trackIds.length > 0) {
    const trackMemberRows = await db
      .select({ member: trackMembers, user: users })
      .from(trackMembers)
      .innerJoin(users, eq(trackMembers.userId, users.id))
      .where(inArray(trackMembers.trackId, trackIds))
      .orderBy(asc(trackMembers.rank));
    for (const { member, user } of trackMemberRows) {
      const nodeId = trackNodeByTrackId.get(member.trackId);
      if (!nodeId) continue;
      const role = member.role === 'manager' ? 'lead' : 'member';
      const bucket = role === 'lead' ? leadsByNode : membersByNode;
      const list = bucket.get(nodeId) ?? [];
      list.push(toOrgNodeMember(user, role));
      bucket.set(nodeId, list);
    }
  }

  return nodeRows.map((n) =>
    toOrgNode(n, leadsByNode.get(n.id) ?? [], membersByNode.get(n.id) ?? []),
  );
}

/** Load a single node (with its people) as the wire shape — used by mutation responses. */
async function serializeNode(db: Database, id: string): Promise<OrgNode> {
  const row = await loadOrgNodeOrThrow(db, id);
  if (row.trackId !== null) {
    const trackMemberRows = await db
      .select({ member: trackMembers, user: users })
      .from(trackMembers)
      .innerJoin(users, eq(trackMembers.userId, users.id))
      .where(eq(trackMembers.trackId, row.trackId))
      .orderBy(asc(trackMembers.rank));

    const leads: OrgNodeMember[] = [];
    const members: OrgNodeMember[] = [];
    for (const { member, user } of trackMemberRows) {
      const role = member.role === 'manager' ? 'lead' : 'member';
      (role === 'lead' ? leads : members).push(toOrgNodeMember(user, role));
    }
    return toOrgNode(row, leads, members);
  }

  const memberRows = await db
    .select({ member: orgNodeMembers, user: users })
    .from(orgNodeMembers)
    .innerJoin(users, eq(orgNodeMembers.userId, users.id))
    .where(eq(orgNodeMembers.nodeId, id))
    .orderBy(asc(orgNodeMembers.rank));

  const leads: OrgNodeMember[] = [];
  const members: OrgNodeMember[] = [];
  for (const { member, user } of memberRows) {
    (member.role === 'lead' ? leads : members).push(toOrgNodeMember(user, member.role));
  }
  return toOrgNode(row, leads, members);
}

// ---------------------------------------------------------------------------
// Ordering (rank) + structure invariants
// ---------------------------------------------------------------------------

interface Sibling {
  id: string;
  rank: string;
}

/**
 * The children of `parentId` within `projectId`, ordered by rank, optionally
 * excluding one node (the one being moved, so it isn't treated as its own neighbour).
 */
async function siblingsOrdered(
  db: Database,
  projectId: string | null,
  parentId: string | null,
  excludeId?: string,
): Promise<Sibling[]> {
  const scopePred =
    projectId === null ? isNull(orgNodes.projectId) : eq(orgNodes.projectId, projectId);
  const parentPred =
    parentId === null ? isNull(orgNodes.parentId) : eq(orgNodes.parentId, parentId);
  const rows = await db
    .select({ id: orgNodes.id, rank: orgNodes.rank })
    .from(orgNodes)
    .where(and(scopePred, parentPred))
    .orderBy(asc(orgNodes.rank), asc(orgNodes.createdAt));
  return excludeId ? rows.filter((r) => r.id !== excludeId) : rows;
}

/**
 * A rank placing a node among `siblings`: immediately before `beforeId` when given
 * (and present), otherwise appended after the last sibling.
 */
function rankForPosition(siblings: Sibling[], beforeId: string | null | undefined): string {
  if (beforeId != null) {
    const idx = siblings.findIndex((s) => s.id === beforeId);
    if (idx !== -1) {
      const prev = idx > 0 ? siblings[idx - 1]!.rank : null;
      return rankBetween(prev, siblings[idx]!.rank);
    }
    // beforeId not a sibling (defensive) — fall through to append.
  }
  const last = siblings.length > 0 ? siblings[siblings.length - 1]!.rank : null;
  return rankBetween(last, null);
}

/**
 * The set of node ids in `rootId`'s subtree (including `rootId`), computed over the
 * scope's nodes. Used to reject a move that would make a node its own ancestor.
 */
async function subtreeIds(
  db: Database,
  projectId: string | null,
  rootId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ id: orgNodes.id, parentId: orgNodes.parentId })
    .from(orgNodes)
    .where(inScope(projectId));
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (r.parentId) {
      const list = childrenOf.get(r.parentId) ?? [];
      list.push(r.id);
      childrenOf.set(r.parentId, list);
    }
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child);
  }
  return out;
}

/**
 * Resolve + validate a prospective parent for a node in `projectId`: it must exist,
 * be in the same scope, and not be `movingId` itself or a descendant of it (which
 * would create a cycle). Throws 400 otherwise. `parentId === null` (a root) is valid.
 */
async function assertValidParent(
  db: Database,
  projectId: string | null,
  parentId: string | null,
  movingId?: string,
): Promise<void> {
  if (parentId === null) return;
  const parent = await loadOrgNodeOrThrow(db, parentId);
  if (parent.projectId !== projectId) {
    throw validationError('父节点必须与该节点属于同一个架构');
  }
  if (movingId) {
    const descendants = await subtreeIds(db, projectId, movingId);
    if (descendants.has(parentId)) {
      throw validationError('不能移动到自己或自己的子节点下');
    }
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Publish an `org` realtime event so open trees for this scope refresh (§6.5). */
function publishOrgChange(
  realtimeBus: RealtimeBus,
  type: string,
  scope: OrgScope,
  nodeId: string,
): void {
  publishChange(
    {
      type,
      // Whole-team ('all') tree → null → global channel (every user); a project tree
      // → that project's channel (members only), matching the read visibility.
      projectId: projectIdOfScope(scope),
      entity: 'org',
      payload: { scope, nodeId },
    },
    realtimeBus,
  );
}

/**
 * Create a node in `input.scope`, appended after its parent's last child. A non-null
 * `parentId` must belong to the same scope. Returns the new node (no people yet).
 */
export async function createNode(
  db: Database,
  input: CreateOrgNodeInput,
  realtimeBus: RealtimeBus = bus,
): Promise<OrgNode> {
  if (input.kind === 'track') {
    throw validationError('赛道节点由赛道管理自动创建');
  }
  const projectId = projectIdOfScope(input.scope);
  const parentId = input.parentId ?? null;
  await assertValidParent(db, projectId, parentId);

  const siblings = await siblingsOrdered(db, projectId, parentId);
  const rank = rankForPosition(siblings, null);

  const [inserted] = await db
    .insert(orgNodes)
    .values({
      projectId,
      parentId,
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      headcount: input.headcount ?? null,
      rank,
    })
    .returning();
  if (!inserted) {
    throw new Error('创建架构节点失败：未返回插入行');
  }

  publishOrgChange(realtimeBus, 'org_node_created', input.scope, inserted.id);
  return serializeNode(db, inserted.id);
}

/** Edit a node's title / kind / description / headcount; bumps `updated_at`. */
export async function updateNode(
  db: Database,
  node: OrgNodeRow,
  input: UpdateOrgNodeInput,
  realtimeBus: RealtimeBus = bus,
): Promise<OrgNode> {
  if (node.trackId !== null) {
    throw validationError('赛道节点请在赛道管理中编辑');
  }
  if (input.kind === 'track') {
    throw validationError('赛道节点由赛道管理自动创建');
  }
  const patch: Partial<OrgNodeRow> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.description !== undefined) patch.description = input.description;
  if (input.headcount !== undefined) patch.headcount = input.headcount;

  const [updated] = await db
    .update(orgNodes)
    .set(patch)
    .where(eq(orgNodes.id, node.id))
    .returning();
  if (!updated) throw notFound('架构节点不存在');

  publishOrgChange(realtimeBus, 'org_node_updated', scopeOfNode(node), node.id);
  return serializeNode(db, node.id);
}

/**
 * Reparent and/or reorder a node within its scope. The target parent must be in the
 * same scope and must not be the node itself or a descendant of it. `beforeId` places
 * the node before that sibling; omit/null to append. Bumps `updated_at`.
 */
export async function moveNode(
  db: Database,
  node: OrgNodeRow,
  input: MoveOrgNodeInput,
  realtimeBus: RealtimeBus = bus,
): Promise<OrgNode> {
  if (node.trackId !== null) {
    throw validationError('赛道节点固定为团队架构根节点，不能移动');
  }
  const projectId = node.projectId;
  const newParentId = input.parentId;
  await assertValidParent(db, projectId, newParentId, node.id);

  const siblings = await siblingsOrdered(db, projectId, newParentId, node.id);
  const rank = rankForPosition(siblings, input.beforeId ?? null);

  const [updated] = await db
    .update(orgNodes)
    .set({ parentId: newParentId, rank, updatedAt: new Date() })
    .where(eq(orgNodes.id, node.id))
    .returning();
  if (!updated) throw notFound('架构节点不存在');

  publishOrgChange(realtimeBus, 'org_node_moved', scopeOfNode(node), node.id);
  return serializeNode(db, node.id);
}

/** Delete a node and (via DB cascade) its whole subtree + member rows. */
export async function deleteNode(
  db: Database,
  node: OrgNodeRow,
  realtimeBus: RealtimeBus = bus,
): Promise<void> {
  if (node.trackId !== null) {
    throw validationError('请在赛道管理中删除赛道');
  }
  await db.delete(orgNodes).where(eq(orgNodes.id, node.id));
  publishOrgChange(realtimeBus, 'org_node_deleted', scopeOfNode(node), node.id);
}

/**
 * Replace a node's people with exactly `leads` (负责人) + `members` (成员). Validates
 * that every id refers to an existing user and that the two sets are disjoint; writes
 * are ordered by their position in each array. Returns the refreshed node.
 */
export async function setMembers(
  db: Database,
  node: OrgNodeRow,
  input: SetOrgMembersInput,
  realtimeBus: RealtimeBus = bus,
): Promise<OrgNode> {
  if (node.trackId !== null) {
    await setTrackMembers(
      db,
      node.trackId,
      { managers: input.leads, members: input.members },
      realtimeBus,
    );
    return serializeNode(db, node.id);
  }

  if (input.leads.length > 1) {
    throw validationError('一个节点只能设置一位负责人');
  }

  const allIds = [...input.leads, ...input.members];
  if (new Set(allIds).size !== allIds.length) {
    throw validationError('同一个人不能同时是负责人和成员');
  }

  if (allIds.length > 0) {
    const found = await db.select({ id: users.id }).from(users).where(inArray(users.id, allIds));
    if (found.length !== new Set(allIds).size) {
      throw validationError('存在无效的用户');
    }
  }

  const rows = [
    ...input.leads.map((userId, i) => ({
      nodeId: node.id,
      userId,
      role: 'lead' as const,
      rank: String(i).padStart(6, '0'),
    })),
    ...input.members.map((userId, i) => ({
      nodeId: node.id,
      userId,
      role: 'member' as const,
      rank: String(i).padStart(6, '0'),
    })),
  ];

  // Replace the whole member set (mirrors how task labels are re-set): clear then
  // re-insert. Not wrapped in a transaction to match the codebase's data-access
  // conventions; the two statements run back-to-back on a single request.
  await db.delete(orgNodeMembers).where(eq(orgNodeMembers.nodeId, node.id));
  if (rows.length > 0) {
    await db.insert(orgNodeMembers).values(rows);
  }

  publishOrgChange(realtimeBus, 'org_members_set', scopeOfNode(node), node.id);
  return serializeNode(db, node.id);
}

/**
 * Leave a 部门/小组/岗位 as the caller (self-service, 2026-07-13). Removes the
 * caller's own `member` row. A 负责人 (lead) can't self-leave — an admin must
 * reassign the role first (mirrors a track manager). Track nodes leave via the
 * track path. Idempotent for a non-member. Returns the refreshed node.
 */
export async function leaveNode(
  db: Database,
  node: OrgNodeRow,
  user: UserRow,
  realtimeBus: RealtimeBus = bus,
): Promise<OrgNode> {
  if (node.trackId !== null) {
    throw validationError('赛道请在赛道卡片上退出');
  }
  const [existing] = await db
    .select({ role: orgNodeMembers.role })
    .from(orgNodeMembers)
    .where(and(eq(orgNodeMembers.nodeId, node.id), eq(orgNodeMembers.userId, user.id)))
    .limit(1);

  if (existing?.role === 'lead') {
    throw conflict('负责人不能直接退出，请联系管理员');
  }
  if (existing) {
    await db
      .delete(orgNodeMembers)
      .where(and(eq(orgNodeMembers.nodeId, node.id), eq(orgNodeMembers.userId, user.id)));
    publishOrgChange(realtimeBus, 'org_member_left', scopeOfNode(node), node.id);
  }
  return serializeNode(db, node.id);
}

// ---------------------------------------------------------------------------
// 岗位申报 / org applications (P1)
// ---------------------------------------------------------------------------

/**
 * Postgres uniqueness violation code; mapped to a 409 so a concurrent duplicate
 * apply surfaces as the §7 conflict shape rather than a 500 (mirrors projectService).
 */
const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/** Map an application row + its display context to the wire shape. */
function toOrgApplication(
  row: OrgApplicationRow,
  applicant: UserRow,
  nodeTitle: string,
  nodeProjectId: string | null,
): OrgApplication {
  return {
    id: row.id,
    nodeId: row.nodeId,
    nodeTitle,
    projectId: nodeProjectId,
    applicant: {
      id: applicant.id,
      displayName: applicant.displayName,
      avatarColor: applicant.avatarColor,
      hasAvatar: applicant.avatarMime != null,
    },
    note: row.note,
    status: row.status,
    decidedBy: row.decidedBy,
    decisionNote: row.decisionNote,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
  };
}

/** Load an application by id or throw 404. */
async function loadApplicationOrThrow(db: Database, id: string): Promise<OrgApplicationRow> {
  const rows = await db.select().from(orgApplications).where(eq(orgApplications.id, id)).limit(1);
  const application = rows[0];
  if (!application) {
    throw notFound('申报不存在');
  }
  return application;
}

/** How many people (any role — a lead occupies a slot too) sit on `nodeId`. */
async function memberCount(db: Database, nodeId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orgNodeMembers)
    .where(eq(orgNodeMembers.nodeId, nodeId));
  return rows[0]?.count ?? 0;
}

/**
 * The ids of every node in `scope` whose applications `user` may decide (P1):
 * - a global admin (and, for a project tree, that project's lead) → all scope nodes;
 * - the whole-team tree → every node that carries one of the user's org-lead
 *   memberships on itself or any ancestor (walk `parentId` in memory, like
 *   `subtreeIds`);
 * - anyone else → none.
 */
async function decidableNodeIds(
  db: Database,
  user: UserRow,
  scope: OrgScope,
  scopeNodes: { id: string; parentId: string | null; trackId: string | null }[],
): Promise<Set<string>> {
  const allIds = new Set(scopeNodes.map((n) => n.id));
  if (isAdminRole(user.role)) {
    return allIds;
  }

  const projectId = projectIdOfScope(scope);
  if (projectId !== null) {
    const leadRows = await db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, user.id),
          eq(projectMembers.role, 'lead'),
        ),
      )
      .limit(1);
    return leadRows.length > 0 ? allIds : new Set();
  }

  // Whole-team tree: an ordinary org lead or a linked Track's manager decides for
  // their node and its whole subtree.
  const leadRows = await db
    .select({ nodeId: orgNodeMembers.nodeId })
    .from(orgNodeMembers)
    .where(and(eq(orgNodeMembers.userId, user.id), eq(orgNodeMembers.role, 'lead')));
  const managerRows = await db
    .select({ trackId: trackMembers.trackId })
    .from(trackMembers)
    .where(and(eq(trackMembers.userId, user.id), eq(trackMembers.role, 'manager')));
  const managedTrackIds = new Set(managerRows.map((r) => r.trackId));
  const leadNodeIds = new Set([
    ...leadRows.map((r) => r.nodeId),
    ...scopeNodes
      .filter((node) => node.trackId !== null && managedTrackIds.has(node.trackId))
      .map((node) => node.id),
  ]);
  if (leadNodeIds.size === 0) {
    return new Set();
  }

  const parentOf = new Map(scopeNodes.map((n) => [n.id, n.parentId]));
  const out = new Set<string>();
  for (const node of scopeNodes) {
    let current: string | null = node.id;
    while (current !== null) {
      if (leadNodeIds.has(current)) {
        out.add(node.id);
        break;
      }
      current = parentOf.get(current) ?? null;
    }
  }
  return out;
}

/**
 * Whether `user` may decide (approve/reject) applications on `node` (P1):
 * a global admin; the project's lead for a project-tree node; or, on the
 * whole-team tree, an org lead on the node or any ancestor.
 */
export async function canDecideOnNode(
  db: Database,
  user: UserRow,
  node: OrgNodeRow,
): Promise<boolean> {
  const scopeNodes = await db
    .select({ id: orgNodes.id, parentId: orgNodes.parentId, trackId: orgNodes.trackId })
    .from(orgNodes)
    .where(inScope(node.projectId));
  const decidable = await decidableNodeIds(db, user, scopeOfNode(node), scopeNodes);
  return decidable.has(node.id);
}

/**
 * The applications view for `user` in `scope` (P1): all of their OWN applications
 * (any status) plus — when they are an approver somewhere in the scope — every
 * `pending` application on the nodes they may decide. One query; the OR de-dupes
 * the own+pending overlap. Newest first.
 */
export async function listApplications(
  db: Database,
  user: UserRow,
  scope: OrgScope,
): Promise<OrgApplicationsResponse> {
  const projectId = projectIdOfScope(scope);
  const scopeNodes = await db
    .select({ id: orgNodes.id, parentId: orgNodes.parentId, trackId: orgNodes.trackId })
    .from(orgNodes)
    .where(inScope(projectId));
  if (scopeNodes.length === 0) {
    return { applications: [], canDecideNodeIds: [] };
  }

  const decidable = await decidableNodeIds(db, user, scope, scopeNodes);
  const visible =
    decidable.size > 0
      ? or(
          eq(orgApplications.userId, user.id),
          and(
            eq(orgApplications.status, 'pending'),
            inArray(orgApplications.nodeId, [...decidable]),
          ),
        )
      : eq(orgApplications.userId, user.id);

  const rows = await db
    .select({ application: orgApplications, applicant: users, node: orgNodes })
    .from(orgApplications)
    .innerJoin(users, eq(orgApplications.userId, users.id))
    .innerJoin(orgNodes, eq(orgApplications.nodeId, orgNodes.id))
    .where(and(inScope(projectId), visible))
    .orderBy(desc(orgApplications.createdAt));

  return {
    applications: rows.map(({ application, applicant, node }) =>
      toOrgApplication(application, applicant, node.title, node.projectId),
    ),
    canDecideNodeIds: [...decidable],
  };
}

/**
 * Apply to a `position` node (P1). Rejects non-position nodes (400), an applicant
 * who already sits on the node or already has a pending application (409), and a
 * full position (`headcount` reached, any role counts as occupying — 409).
 */
export async function applyToNode(
  db: Database,
  user: UserRow,
  nodeId: string,
  input: CreateOrgApplicationInput,
  realtimeBus: RealtimeBus = bus,
): Promise<OrgApplication> {
  const node = await loadOrgNodeOrThrow(db, nodeId);
  // 部门/小组/岗位都通过申请→审批加入 (2026-07-13); 赛道走直接加入 (POST /tracks/:id/join).
  if (node.kind === 'track') {
    throw validationError('赛道请直接加入，无需申请');
  }

  const existingMember = await db
    .select({ userId: orgNodeMembers.userId })
    .from(orgNodeMembers)
    .where(and(eq(orgNodeMembers.nodeId, node.id), eq(orgNodeMembers.userId, user.id)))
    .limit(1);
  if (existingMember.length > 0) {
    throw conflict('你已是该单元成员');
  }

  const pending = await db
    .select({ id: orgApplications.id })
    .from(orgApplications)
    .where(
      and(
        eq(orgApplications.nodeId, node.id),
        eq(orgApplications.userId, user.id),
        eq(orgApplications.status, 'pending'),
      ),
    )
    .limit(1);
  if (pending.length > 0) {
    throw conflict('你已提交过申请，请等待处理');
  }

  // 名额仅对设置了 headcount 的岗位有意义; 部门/小组 headcount 为 null，天然跳过。
  if (node.headcount !== null && (await memberCount(db, node.id)) >= node.headcount) {
    throw conflict('名额已满，暂时无法加入');
  }

  let inserted: OrgApplicationRow | undefined;
  try {
    [inserted] = await db
      .insert(orgApplications)
      .values({ nodeId: node.id, userId: user.id, note: input.note ?? '' })
      .returning();
  } catch (error) {
    // Concurrent duplicate — the partial unique (node, user) WHERE pending index.
    if (isUniqueViolation(error)) {
      throw conflict('你已提交过申请，请等待处理');
    }
    throw error;
  }
  if (!inserted) {
    throw new Error('创建申报失败：未返回插入行');
  }

  publishOrgChange(realtimeBus, 'org_application_created', scopeOfNode(node), node.id);
  return toOrgApplication(inserted, user, node.title, node.projectId);
}

/** Withdraw the caller's OWN pending application (P1); sets `decided_at`. */
export async function withdrawApplication(
  db: Database,
  user: UserRow,
  applicationId: string,
  realtimeBus: RealtimeBus = bus,
): Promise<OrgApplication> {
  const application = await loadApplicationOrThrow(db, applicationId);
  if (application.userId !== user.id) {
    throw forbidden('只能撤回自己的申报');
  }
  if (application.status !== 'pending') {
    throw conflict('该申报已被处理');
  }
  const node = await loadOrgNodeOrThrow(db, application.nodeId);

  const [updated] = await db
    .update(orgApplications)
    .set({ status: 'withdrawn', decidedAt: new Date() })
    .where(eq(orgApplications.id, application.id))
    .returning();
  if (!updated) throw notFound('申报不存在');

  publishOrgChange(realtimeBus, 'org_application_withdrawn', scopeOfNode(node), node.id);
  return toOrgApplication(updated, user, node.title, node.projectId);
}

/**
 * Decide a pending application (P1). Requires {@link canDecideOnNode}. Approving
 * re-checks the headcount, then appends the applicant to the node as a `member`
 * (rank after the current occupants, same convention as setMembers); rejecting
 * only records the decision. Either way writes decided_by / decision_note /
 * decided_at.
 */
export async function decideApplication(
  db: Database,
  user: UserRow,
  applicationId: string,
  decision: 'approved' | 'rejected',
  input: DecideOrgApplicationInput,
  realtimeBus: RealtimeBus = bus,
): Promise<OrgApplication> {
  const application = await loadApplicationOrThrow(db, applicationId);
  if (application.status !== 'pending') {
    throw conflict('该申报已被处理');
  }
  const node = await loadOrgNodeOrThrow(db, application.nodeId);
  if (!(await canDecideOnNode(db, user, node))) {
    throw forbidden('需要该单元的负责人或管理员权限');
  }

  if (decision === 'approved') {
    const occupied = await memberCount(db, node.id);
    if (node.headcount !== null && occupied >= node.headcount) {
      throw conflict('名额已满，暂时无法加入');
    }
    // Append after every current occupant (total count >= member count, so the
    // rank sorts after the existing members). A concurrent double-write is benign:
    // (node, user) is the PK.
    await db
      .insert(orgNodeMembers)
      .values({
        nodeId: node.id,
        userId: application.userId,
        role: 'member',
        rank: String(occupied).padStart(6, '0'),
      })
      .onConflictDoNothing();
  }

  const [updated] = await db
    .update(orgApplications)
    .set({
      status: decision,
      decidedBy: user.id,
      decisionNote: input.note ?? null,
      decidedAt: new Date(),
    })
    .where(eq(orgApplications.id, application.id))
    .returning();
  if (!updated) throw notFound('申报不存在');

  const applicantRows = await db
    .select()
    .from(users)
    .where(eq(users.id, application.userId))
    .limit(1);
  const applicant = applicantRows[0];
  if (!applicant) {
    // Unreachable in practice: deleting the applicant cascades the application.
    throw notFound('申报人不存在');
  }

  publishOrgChange(realtimeBus, 'org_application_decided', scopeOfNode(node), node.id);
  return toOrgApplication(updated, applicant, node.title, node.projectId);
}
