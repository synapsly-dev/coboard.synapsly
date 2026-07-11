import { describe, expect, it } from 'vitest';
import type { OrgNode } from 'shared';
import { buildTree } from '../tree';
import {
  layoutTree,
  NODE_H,
  NODE_W,
  PADDING,
  RANK_GAP,
  ROOT_GAP,
  SIBLING_GAP,
} from './layout';

/** Minimal OrgNode factory (same shape as tree.test.ts). */
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

const none = new Set<string>();

function placed(layout: ReturnType<typeof layoutTree>, id: string): { x: number; y: number } {
  const hit = layout.nodes.find((n) => n.node.id === id);
  if (!hit) throw new Error(`node ${id} not placed`);
  return hit;
}

describe('layoutTree', () => {
  it('returns empty bounds for an empty forest', () => {
    const layout = layoutTree([], none);
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
    expect(layout.bounds).toEqual({ width: 0, height: 0 });
  });

  it('places a single node at the padding origin with tight bounds', () => {
    const layout = layoutTree(buildTree([node('a', null, 'a')]), none);
    expect(layout.nodes).toHaveLength(1);
    expect(placed(layout, 'a')).toMatchObject({ x: PADDING, y: PADDING });
    expect(layout.edges).toHaveLength(0);
    expect(layout.bounds).toEqual({
      width: NODE_W + PADDING * 2,
      height: NODE_H + PADDING * 2,
    });
  });

  it('centers a parent over its two children and anchors edges center-to-center', () => {
    const roots = buildTree([
      node('p', null, 'a'),
      node('c1', 'p', 'a'),
      node('c2', 'p', 'b'),
    ]);
    const layout = layoutTree(roots, none);

    const p = placed(layout, 'p');
    const c1 = placed(layout, 'c1');
    const c2 = placed(layout, 'c2');

    // Children sit side by side one rank down; parent is centered over their span.
    expect(c1.x).toBe(PADDING);
    expect(c2.x).toBe(PADDING + NODE_W + SIBLING_GAP);
    expect(c1.y).toBe(PADDING + NODE_H + RANK_GAP);
    expect(p.x).toBe((c1.x + c2.x) / 2);

    // One edge per child: parent bottom-center → child top-center.
    expect(layout.edges).toHaveLength(2);
    for (const edge of layout.edges) {
      expect(edge.fromX).toBe(p.x + NODE_W / 2);
      expect(edge.fromY).toBe(p.y + NODE_H);
      expect(edge.toY).toBe(c1.y);
    }
    expect(layout.edges.map((e) => e.toX).sort((a, b) => a - b)).toEqual([
      c1.x + NODE_W / 2,
      c2.x + NODE_W / 2,
    ]);
  });

  it('prunes descendants and edges of a collapsed node', () => {
    const roots = buildTree([
      node('p', null, 'a'),
      node('c1', 'p', 'a'),
      node('g1', 'c1', 'a'),
      node('c2', 'p', 'b'),
    ]);
    const layout = layoutTree(roots, new Set(['p']));

    expect(layout.nodes.map((n) => n.node.id)).toEqual(['p']);
    expect(layout.edges).toHaveLength(0);
    // Collapsed subtree contributes a single card width.
    expect(layout.bounds).toEqual({
      width: NODE_W + PADDING * 2,
      height: NODE_H + PADDING * 2,
    });

    // Collapsing mid-tree keeps the node but prunes below it.
    const mid = layoutTree(roots, new Set(['c1']));
    expect(mid.nodes.map((n) => n.node.id).sort()).toEqual(['c1', 'c2', 'p']);
    expect(mid.edges).toHaveLength(2);
  });

  it('pushes siblings apart by the widest subtree, not just the card', () => {
    const roots = buildTree([
      node('root', null, 'a'),
      node('wide', 'root', 'a'),
      node('w1', 'wide', 'a'),
      node('w2', 'wide', 'b'),
      node('leaf', 'root', 'b'),
    ]);
    const layout = layoutTree(roots, none);

    const wideSpan = NODE_W * 2 + SIBLING_GAP; // wide's two children
    const wide = placed(layout, 'wide');
    const leaf = placed(layout, 'leaf');
    const root = placed(layout, 'root');

    // "wide" is centered over its own children; "leaf" clears the whole wide subtree.
    expect(wide.x).toBe(PADDING + (wideSpan - NODE_W) / 2);
    expect(leaf.x).toBe(PADDING + wideSpan + SIBLING_GAP);
    // Root is centered over the full children span.
    const span = wideSpan + SIBLING_GAP + NODE_W;
    expect(root.x).toBe(PADDING + (span - NODE_W) / 2);
    expect(layout.bounds.width).toBe(span + PADDING * 2);
    expect(layout.bounds.height).toBe(NODE_H * 3 + RANK_GAP * 2 + PADDING * 2);
  });

  it('spaces multiple roots by ROOT_GAP', () => {
    const layout = layoutTree(buildTree([node('a', null, 'a'), node('b', null, 'b')]), none);
    const a = placed(layout, 'a');
    const b = placed(layout, 'b');
    expect(a).toMatchObject({ x: PADDING, y: PADDING });
    expect(b).toMatchObject({ x: PADDING + NODE_W + ROOT_GAP, y: PADDING });
    expect(layout.bounds.width).toBe(NODE_W * 2 + ROOT_GAP + PADDING * 2);
  });
});
