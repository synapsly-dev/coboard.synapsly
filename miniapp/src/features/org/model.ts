import type { MoveOrgNodeInput, OrgNode, OrgNodeKind } from 'shared';

export interface OrgTreeNode extends OrgNode {
  children: OrgTreeNode[];
  depth: number;
}

export interface OutlineRow {
  node: OrgTreeNode;
  depth: number;
  ancestorLines: boolean[];
  isLast: boolean;
}

export const ORG_KIND_LABELS: Record<OrgNodeKind, string> = {
  department: '部门',
  track: '赛道',
  group: '小组',
  position: '岗位',
};

export const ORG_KIND_OPTIONS: OrgNodeKind[] = ['department', 'group', 'position'];

function byRank(a: OrgNode, b: OrgNode): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

export function buildTree(nodes: OrgNode[]): OrgTreeNode[] {
  const byId = new Map<string, OrgTreeNode>();
  for (const node of nodes) byId.set(node.id, { ...node, children: [], depth: 0 });

  const roots: OrgTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const assign = (node: OrgTreeNode, depth: number): void => {
    node.depth = depth;
    node.children.sort(byRank);
    node.children.forEach((child) => assign(child, depth + 1));
  };
  roots.sort(byRank);
  roots.forEach((root) => assign(root, 0));
  return roots;
}

export function flattenTree(roots: OrgTreeNode[]): OrgTreeNode[] {
  const result: OrgTreeNode[] = [];
  const walk = (node: OrgTreeNode): void => {
    result.push(node);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return result;
}

export function flattenVisible(roots: OrgTreeNode[], collapsed: Set<string>): OrgTreeNode[] {
  const result: OrgTreeNode[] = [];
  const walk = (node: OrgTreeNode): void => {
    result.push(node);
    if (!collapsed.has(node.id)) node.children.forEach(walk);
  };
  roots.forEach(walk);
  return result;
}

export function flattenOutline(roots: OrgTreeNode[], collapsed: Set<string>): OutlineRow[] {
  const result: OutlineRow[] = [];
  const walk = (level: OrgTreeNode[], ancestorLines: boolean[]): void => {
    level.forEach((node, index) => {
      const isLast = index === level.length - 1;
      result.push({ node, depth: ancestorLines.length, ancestorLines, isLast });
      if (node.children.length > 0 && !collapsed.has(node.id)) {
        walk(node.children, [...ancestorLines, !isLast]);
      }
    });
  };
  walk(roots, []);
  return result;
}

function collectPeople(node: OrgTreeNode, ids: Set<string>): void {
  node.leads.forEach((person) => ids.add(person.userId));
  node.members.forEach((person) => ids.add(person.userId));
  node.children.forEach((child) => collectPeople(child, ids));
}

export function subtreePeople(node: OrgTreeNode): number {
  const ids = new Set<string>();
  collectPeople(node, ids);
  return ids.size;
}

export function forestPeople(roots: OrgTreeNode[]): number {
  const ids = new Set<string>();
  roots.forEach((root) => collectPeople(root, ids));
  return ids.size;
}

export function occupiedCount(node: OrgNode): number {
  return node.leads.length + node.members.length;
}

export function occupancyLabel(node: OrgNode): string {
  const occupied = occupiedCount(node);
  return node.headcount == null ? `${occupied} 人·不限` : `在岗${occupied}/名额${node.headcount}`;
}

export function occupancyShort(node: OrgNode): string {
  const occupied = occupiedCount(node);
  return node.headcount == null ? `${occupied} 人` : `${occupied}/${node.headcount}`;
}

export function isPositionFull(node: OrgNode): boolean {
  return node.kind === 'position' && node.headcount != null && occupiedCount(node) >= node.headcount;
}

export function ancestorPath(nodes: OrgNode[], node: OrgNode): string[] {
  const byId = new Map(nodes.map((candidate) => [candidate.id, candidate]));
  const path: string[] = [];
  const seen = new Set<string>([node.id]);
  let current = node.parentId ? byId.get(node.parentId) : undefined;
  while (current && !seen.has(current.id)) {
    path.unshift(current.title);
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function descendantCount(node: OrgTreeNode): number {
  return node.children.reduce((count, child) => count + 1 + descendantCount(child), 0);
}

function siblingsOf(nodes: OrgNode[], node: OrgNode): OrgNode[] {
  return nodes.filter((candidate) => candidate.parentId === node.parentId).sort(byRank);
}

export function moveUpInput(nodes: OrgNode[], node: OrgNode): MoveOrgNodeInput | null {
  const siblings = siblingsOf(nodes, node);
  const index = siblings.findIndex((candidate) => candidate.id === node.id);
  if (index <= 0) return null;
  return { parentId: node.parentId, beforeId: siblings[index - 1]!.id };
}

export function moveDownInput(nodes: OrgNode[], node: OrgNode): MoveOrgNodeInput | null {
  const siblings = siblingsOf(nodes, node);
  const index = siblings.findIndex((candidate) => candidate.id === node.id);
  if (index < 0 || index >= siblings.length - 1) return null;
  return { parentId: node.parentId, beforeId: siblings[index + 2]?.id ?? null };
}

export function indentInput(nodes: OrgNode[], node: OrgNode): MoveOrgNodeInput | null {
  const siblings = siblingsOf(nodes, node);
  const index = siblings.findIndex((candidate) => candidate.id === node.id);
  if (index <= 0) return null;
  return { parentId: siblings[index - 1]!.id, beforeId: null };
}

export function outdentInput(nodes: OrgNode[], node: OrgNode): MoveOrgNodeInput | null {
  if (!node.parentId) return null;
  const parent = nodes.find((candidate) => candidate.id === node.parentId);
  if (!parent) return null;
  const siblings = siblingsOf(nodes, parent);
  const parentIndex = siblings.findIndex((candidate) => candidate.id === parent.id);
  return { parentId: parent.parentId, beforeId: siblings[parentIndex + 1]?.id ?? null };
}
