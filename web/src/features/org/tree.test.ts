import { describe, expect, it } from 'vitest';
import type { OrgNode, OrgNodeMember } from 'shared';
import {
  ancestorPath,
  buildTree,
  descendantCount,
  indentInput,
  moveDownInput,
  moveUpInput,
  outdentInput,
} from './tree';
import { canEditOrgScope } from './permissions';
import { isPositionFull, occupancyLabel, occupancyShort, occupiedCount } from './labels';

/** Minimal OrgNode factory for the pure-helper tests. */
function node(id: string, parentId: string | null, rank: string, extra?: Partial<OrgNode>): OrgNode {
  return {
    id,
    projectId: null,
    parentId,
    kind: 'group',
    title: id,
    description: null,
    headcount: null,
    rank,
    leads: [],
    members: [],
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...extra,
  };
}

/** Minimal OrgNodeMember factory (only identity matters for occupancy). */
function member(userId: string, role: OrgNodeMember['role'] = 'member'): OrgNodeMember {
  return { userId, displayName: userId, avatarColor: '#888888', hasAvatar: false, role };
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

describe('ancestorPath', () => {
  const nodes = [
    node('dept', null, 'a', { kind: 'department', title: '运营部' }),
    node('grp', 'dept', 'a', { title: '内容组' }),
    node('pos', 'grp', 'a', { kind: 'position', title: '主编' }),
  ];

  it('walks parentId collecting titles, outermost first', () => {
    expect(ancestorPath(nodes, nodes[2]!)).toEqual(['运营部', '内容组']);
    expect(ancestorPath(nodes, nodes[1]!)).toEqual(['运营部']);
  });

  it('is empty for roots and terminates on missing parents / cycles', () => {
    expect(ancestorPath(nodes, nodes[0]!)).toEqual([]);
    expect(ancestorPath([node('x', 'ghost', 'a')], node('x', 'ghost', 'a'))).toEqual([]);
    const loop = [node('a', 'b', 'a'), node('b', 'a', 'a')];
    expect(ancestorPath(loop, loop[0]!)).toEqual([loop[1]!.title]);
  });
});

describe('岗位 occupancy helpers', () => {
  it('counts leads + members and detects fullness against 名额', () => {
    const pos = node('p', null, 'a', {
      kind: 'position',
      headcount: 2,
      leads: [member('u1', 'lead')],
      members: [member('u2')],
    });
    expect(occupiedCount(pos)).toBe(2);
    expect(isPositionFull(pos)).toBe(true);
    expect(occupancyLabel(pos)).toBe('在岗2/名额2');
    expect(occupancyShort(pos)).toBe('2/2');
  });

  it('null 名额 (不限) is never full', () => {
    const pos = node('p', null, 'a', {
      kind: 'position',
      headcount: null,
      members: [member('u1'), member('u2'), member('u3')],
    });
    expect(isPositionFull(pos)).toBe(false);
    expect(occupancyLabel(pos)).toBe('3 人·不限');
    expect(occupancyShort(pos)).toBe('3 人');
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
