import { describe, expect, it } from 'vitest';
import type { OrgNode } from 'shared';
import {
  buildTree,
  descendantCount,
  indentInput,
  moveDownInput,
  moveUpInput,
  outdentInput,
} from './tree';
import { canEditOrgScope } from './permissions';

/** Minimal OrgNode factory for the pure-helper tests. */
function node(id: string, parentId: string | null, rank: string, extra?: Partial<OrgNode>): OrgNode {
  return {
    id,
    projectId: null,
    parentId,
    kind: 'unit',
    title: id,
    description: null,
    rank,
    leads: [],
    members: [],
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...extra,
  };
}

describe('buildTree', () => {
  it('assembles roots and rank-ordered children with depth', () => {
    const nodes = [
      node('b', null, 'b'),
      node('a', null, 'a'),
      node('a2', 'a', 'n'),
      node('a1', 'a', 'm'),
    ];
    const roots = buildTree(nodes);
    expect(roots.map((r) => r.id)).toEqual(['a', 'b']); // sorted by rank
    expect(roots[0]!.depth).toBe(0);
    expect(roots[0]!.children.map((c) => c.id)).toEqual(['a1', 'a2']); // m < n
    expect(roots[0]!.children[0]!.depth).toBe(1);
  });

  it('treats orphans (missing parent) as roots so nothing is dropped', () => {
    const roots = buildTree([node('x', 'ghost', 'a')]);
    expect(roots.map((r) => r.id)).toEqual(['x']);
  });
});

describe('reorder move inputs', () => {
  const nodes = [node('a', null, 'a'), node('b', null, 'b'), node('c', null, 'c')];

  it('moveUp targets the previous sibling; null for the first', () => {
    expect(moveUpInput(nodes, nodes[1]!)).toEqual({ parentId: null, beforeId: 'a' });
    expect(moveUpInput(nodes, nodes[0]!)).toBeNull();
  });

  it('moveDown places before the sibling two down, appending past the last', () => {
    expect(moveDownInput(nodes, nodes[0]!)).toEqual({ parentId: null, beforeId: 'c' });
    // moving the second-to-last down appends (beforeId null).
    expect(moveDownInput(nodes, nodes[1]!)).toEqual({ parentId: null, beforeId: null });
    expect(moveDownInput(nodes, nodes[2]!)).toBeNull();
  });

  it('indent nests under the previous sibling; null for the first', () => {
    expect(indentInput(nodes, nodes[1]!)).toEqual({ parentId: 'a', beforeId: null });
    expect(indentInput(nodes, nodes[0]!)).toBeNull();
  });

  it('outdent lifts to the grandparent after the former parent; null at root', () => {
    const tree = [
      node('p', null, 'a'),
      node('p2', null, 'b'),
      node('c', 'p', 'a'),
    ];
    // `c` under `p` outdents to root, placed before `p2` (p's next sibling).
    expect(outdentInput(tree, tree[2]!)).toEqual({ parentId: null, beforeId: 'p2' });
    expect(outdentInput(tree, tree[0]!)).toBeNull();
  });
});

describe('descendantCount', () => {
  it('counts the whole subtree under a node', () => {
    const roots = buildTree([
      node('r', null, 'a'),
      node('c1', 'r', 'a'),
      node('c2', 'r', 'b'),
      node('g', 'c1', 'a'),
    ]);
    expect(descendantCount(roots, 'r')).toBe(3);
    expect(descendantCount(roots, 'c1')).toBe(1);
    expect(descendantCount(roots, 'c2')).toBe(0);
  });
});

describe('canEditOrgScope', () => {
  const admin = { id: 'a', role: 'admin' } as never;
  const member = { id: 'm', role: 'member' } as never;

  it('admins edit any scope', () => {
    expect(canEditOrgScope(admin, 'all', undefined)).toBe(true);
    expect(canEditOrgScope(admin, 'proj-1', undefined)).toBe(true);
  });

  it('non-admins cannot edit the whole-team tree', () => {
    expect(canEditOrgScope(member, 'all', 'lead')).toBe(false);
  });

  it('project leads edit their project tree; plain members cannot', () => {
    expect(canEditOrgScope(member, 'proj-1', 'lead')).toBe(true);
    expect(canEditOrgScope(member, 'proj-1', 'member')).toBe(false);
    expect(canEditOrgScope(member, 'proj-1', undefined)).toBe(false);
  });

  it('anonymous cannot edit', () => {
    expect(canEditOrgScope(null, 'all', undefined)).toBe(false);
  });
});
