import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type {
  CreateOrgNodeInput,
  MoveOrgNodeInput,
  OrgNode,
  OrgNodeMember,
  OrgScope,
  SetOrgMembersInput,
  UpdateOrgNodeInput,
} from 'shared';
import type { Database } from '../db/index.js';
import {
  orgNodeMembers,
  orgNodes,
  users,
  type OrgNodeRow,
  type UserRow,
} from '../db/schema.js';
import { notFound, validationError } from '../lib/errors.js';
import { publishChange } from './activityService.js';
import { bus, type RealtimeBus } from '../realtime/bus.js';
import { rankBetween } from './taskService.js';

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
function toOrgNode(
  row: OrgNodeRow,
  leads: OrgNodeMember[],
  members: OrgNodeMember[],
): OrgNode {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    kind: row.kind,
    title: row.title,
    description: row.description,
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

  const nodeIds = nodeRows.map((n) => n.id);
  const memberRows = await db
    .select({ member: orgNodeMembers, user: users })
    .from(orgNodeMembers)
    .innerJoin(users, eq(orgNodeMembers.userId, users.id))
    .where(inArray(orgNodeMembers.nodeId, nodeIds))
    .orderBy(asc(orgNodeMembers.rank));

  const leadsByNode = new Map<string, OrgNodeMember[]>();
  const membersByNode = new Map<string, OrgNodeMember[]>();
  for (const { member, user } of memberRows) {
    const bucket = member.role === 'lead' ? leadsByNode : membersByNode;
    const list = bucket.get(member.nodeId) ?? [];
    list.push(toOrgNodeMember(user, member.role));
    bucket.set(member.nodeId, list);
  }

  return nodeRows.map((n) =>
    toOrgNode(n, leadsByNode.get(n.id) ?? [], membersByNode.get(n.id) ?? []),
  );
}

/** Load a single node (with its people) as the wire shape — used by mutation responses. */
async function serializeNode(db: Database, id: string): Promise<OrgNode> {
  const row = await loadOrgNodeOrThrow(db, id);
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
  const scopePred = projectId === null ? isNull(orgNodes.projectId) : eq(orgNodes.projectId, projectId);
  const parentPred = parentId === null ? isNull(orgNodes.parentId) : eq(orgNodes.parentId, parentId);
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
async function subtreeIds(db: Database, projectId: string | null, rootId: string): Promise<Set<string>> {
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
      rank,
    })
    .returning();
  if (!inserted) {
    throw new Error('创建架构节点失败：未返回插入行');
  }

  publishOrgChange(realtimeBus, 'org_node_created', input.scope, inserted.id);
  return serializeNode(db, inserted.id);
}

/** Edit a node's title / kind / description; bumps `updated_at`. */
export async function updateNode(
  db: Database,
  node: OrgNodeRow,
  input: UpdateOrgNodeInput,
  realtimeBus: RealtimeBus = bus,
): Promise<OrgNode> {
  const patch: Partial<OrgNodeRow> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.description !== undefined) patch.description = input.description;

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
  if (input.leads.length > 1) {
    throw validationError('一个节点只能设置一位负责人');
  }

  const allIds = [...input.leads, ...input.members];
  if (new Set(allIds).size !== allIds.length) {
    throw validationError('同一个人不能同时是负责人和成员');
  }

  if (allIds.length > 0) {
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, allIds));
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
