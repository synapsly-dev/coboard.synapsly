import type { MoveOrgNodeInput, OrgNode } from 'shared';

/**
 * Pure helpers for the org tree (团队架构). The API returns a FLAT, rank-ordered
 * node list; the page assembles it into a hierarchy and derives the button-based
 * structural moves (up / down / indent / outdent) as `move` payloads. Kept pure and
 * dependency-free so they're unit-testable in isolation.
 */

export interface OrgTreeNode extends OrgNode {
  children: OrgTreeNode[];
  /** 0 for roots, +1 per level — drives the indentation in the UI. */
  depth: number;
}

/** Compare two nodes by their sibling rank, then creation time (stable). */
function byRank(a: OrgNode, b: OrgNode): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/**
 * Assemble the flat node list into a forest of {@link OrgTreeNode} roots, each with
 * rank-ordered `children` and a `depth`. Orphan nodes (parent missing from the set)
 * are treated as roots so nothing is ever dropped.
 */
export function buildTree(nodes: OrgNode[]): OrgTreeNode[] {
  const byId = new Map<string, OrgTreeNode>();
  for (const n of nodes) {
    byId.set(n.id, { ...n, children: [], depth: 0 });
  }

  const roots: OrgTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId != null ? byId.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const assignDepth = (node: OrgTreeNode, depth: number): void => {
    node.depth = depth;
    node.children.sort(byRank);
    for (const child of node.children) assignDepth(child, depth + 1);
  };
  roots.sort(byRank);
  for (const root of roots) assignDepth(root, 0);

  return roots;
}

/** Flatten a forest into a pre-order list (only the visible/expanded ones if filtered upstream). */
export function flattenTree(roots: OrgTreeNode[]): OrgTreeNode[] {
  const out: OrgTreeNode[] = [];
  const walk = (node: OrgTreeNode): void => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

/** The rank-ordered siblings of a node (nodes sharing its parent), including itself. */
function siblingsOf(nodes: OrgNode[], node: OrgNode): OrgNode[] {
  return nodes.filter((n) => n.parentId === node.parentId).sort(byRank);
}

/**
 * Move payload to shift `node` before its previous sibling (visually "up"). Null when
 * it is already the first among its siblings.
 */
export function moveUpInput(nodes: OrgNode[], node: OrgNode): MoveOrgNodeInput | null {
  const siblings = siblingsOf(nodes, node);
  const idx = siblings.findIndex((s) => s.id === node.id);
  if (idx <= 0) return null;
  return { parentId: node.parentId, beforeId: siblings[idx - 1]!.id };
}

/**
 * Move payload to shift `node` after its next sibling (visually "down"). Null when it
 * is already last. Placing it before the sibling two positions down (or appending when
 * that doesn't exist) has the effect of swapping it past its immediate next sibling.
 */
export function moveDownInput(nodes: OrgNode[], node: OrgNode): MoveOrgNodeInput | null {
  const siblings = siblingsOf(nodes, node);
  const idx = siblings.findIndex((s) => s.id === node.id);
  if (idx === -1 || idx >= siblings.length - 1) return null;
  const afterNext = siblings[idx + 2];
  return { parentId: node.parentId, beforeId: afterNext ? afterNext.id : null };
}

/**
 * Move payload to nest `node` under its previous sibling (indent). Null when it has no
 * previous sibling to become a child of.
 */
export function indentInput(nodes: OrgNode[], node: OrgNode): MoveOrgNodeInput | null {
  const siblings = siblingsOf(nodes, node);
  const idx = siblings.findIndex((s) => s.id === node.id);
  if (idx <= 0) return null;
  return { parentId: siblings[idx - 1]!.id, beforeId: null };
}

/**
 * Move payload to lift `node` up to its grandparent's level, placed right after its
 * former parent (outdent). Null when the node is already a root.
 */
export function outdentInput(nodes: OrgNode[], node: OrgNode): MoveOrgNodeInput | null {
  if (node.parentId == null) return null;
  const parent = nodes.find((n) => n.id === node.parentId);
  if (!parent) return null;
  const parentSiblings = siblingsOf(nodes, parent);
  const parentIdx = parentSiblings.findIndex((s) => s.id === parent.id);
  const afterParent = parentSiblings[parentIdx + 1];
  return { parentId: parent.parentId, beforeId: afterParent ? afterParent.id : null };
}

/**
 * Breadcrumb of a node's ancestor titles, outermost first (e.g. ["运营部", "内容组"]).
 * Walks `parentId` through the flat list; cycles/missing parents terminate the walk
 * so a malformed tree can't hang the UI. Used to group 岗位 cards in the recruit view.
 */
export function ancestorPath(nodes: OrgNode[], node: OrgNode): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const titles: string[] = [];
  const seen = new Set<string>([node.id]);
  let cur = node.parentId != null ? byId.get(node.parentId) : undefined;
  while (cur && !seen.has(cur.id)) {
    titles.unshift(cur.title);
    seen.add(cur.id);
    cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
  }
  return titles;
}

/** Count of a node's descendants (used for the delete confirmation copy). */
export function descendantCount(roots: OrgTreeNode[], nodeId: string): number {
  const find = (list: OrgTreeNode[]): OrgTreeNode | undefined => {
    for (const n of list) {
      if (n.id === nodeId) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return undefined;
  };
  const node = find(roots);
  if (!node) return 0;
  let count = 0;
  const walk = (n: OrgTreeNode): void => {
    for (const child of n.children) {
      count += 1;
      walk(child);
    }
  };
  walk(node);
  return count;
}
