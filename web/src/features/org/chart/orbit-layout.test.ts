import { describe, expect, it } from 'vitest';
import type { OrgNode, OrgNodeMember } from 'shared';
import { buildTree } from '../tree';
import {
  CORE_R,
  FOCUS_R,
  GHOST_ARC_R,
  GHOST_DEPTH_GAP,
  LEAF_R,
  MOON_R,
  ORBIT_PADDING,
  OVERVIEW_ORBIT_BASE,
  OVERVIEW_ORBIT_PER_PLANET,
  PLANET_R_MAX,
  PLANET_R_MIN,
  orbitLayout,
  planetRadius,
  type OrbitItem,
} from './orbit-layout';

/** Minimal OrgNode factory (same shape as layout.test.ts). */
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

function person(id: string, role: 'lead' | 'member' = 'member'): OrgNodeMember {
  return { userId: id, displayName: `P${id}`, avatarColor: '#888888', hasAvatar: false, role };
}

function people(count: number, role: 'lead' | 'member' = 'member'): OrgNodeMember[] {
  return Array.from({ length: count }, (_, i) => person(`${role}${i}`, role));
}

function ofKind(layout: ReturnType<typeof orbitLayout>, kind: OrbitItem['kind']): OrbitItem[] {
  return layout.items.filter((i) => i.kind === kind);
}

function itemFor(layout: ReturnType<typeof orbitLayout>, key: string): OrbitItem {
  const hit = layout.items.find((i) => i.key === key);
  if (!hit) throw new Error(`item ${key} missing`);
  return hit;
}

describe('orbitLayout', () => {
  it('returns empty layout for an empty forest', () => {
    expect(orbitLayout([], [])).toEqual({
      items: [],
      bounds: { width: 0, height: 0 },
      coreBounds: { x: 0, y: 0, width: 0, height: 0 },
    });
  });

  it('coreBounds excludes ghost arcs (focused camera target), covers core items', () => {
    const roots = buildTree([
      node('a', null, 'a', { members: people(4) }),
      node('a1', 'a', 'a'),
      node('b', null, 'b'),
      node('c', null, 'c'),
    ]);
    const layout = orbitLayout(roots, ['a']);

    // Tighter than the full bounds (ghosts pushed far outside the core rect).
    expect(layout.coreBounds.width).toBeLessThan(layout.bounds.width);
    expect(layout.coreBounds.height).toBeLessThan(layout.bounds.height);

    const within = (x: number, y: number, r: number): boolean =>
      x - r >= layout.coreBounds.x &&
      y - r >= layout.coreBounds.y &&
      x + r <= layout.coreBounds.x + layout.coreBounds.width &&
      y + r <= layout.coreBounds.y + layout.coreBounds.height;

    for (const item of layout.items) {
      if (item.kind === 'ghost') {
        expect(within(item.x, item.y, item.r)).toBe(false);
      } else {
        expect(within(item.x, item.y, item.r)).toBe(true);
      }
    }
  });

  it('overview emits only core + one ring + root planets, nothing deeper', () => {
    const roots = buildTree([
      node('a', null, 'a'),
      node('a1', 'a', 'a', { members: people(3) }),
      node('b', null, 'b'),
      node('c', null, 'c'),
    ]);
    const layout = orbitLayout(roots, []);

    expect(ofKind(layout, 'core')).toHaveLength(1);
    expect(ofKind(layout, 'ring')).toHaveLength(1);
    expect(ofKind(layout, 'planet').map((i) => i.node?.id).sort()).toEqual(['a', 'b', 'c']);
    expect(ofKind(layout, 'moon')).toHaveLength(0);
    expect(ofKind(layout, 'leaf')).toHaveLength(0);
    expect(ofKind(layout, 'ghost')).toHaveLength(0);
    // a1 (below a root) is never emitted in the overview.
    expect(layout.items.some((i) => i.node?.id === 'a1')).toBe(false);

    // First planet sits straight above the core (-90°), on the ring radius.
    const core = itemFor(layout, 'core');
    const first = itemFor(layout, 'node:a');
    const ring = itemFor(layout, 'ring:overview');
    expect(ring.r).toBe(OVERVIEW_ORBIT_BASE + 3 * OVERVIEW_ORBIT_PER_PLANET);
    expect(core.r).toBe(CORE_R);
    expect(first.x).toBeCloseTo(core.x, 6);
    expect(first.y).toBeCloseTo(core.y - ring.r, 6);
  });

  it('scales overview planet radius by subtree people, clamped', () => {
    expect(planetRadius(0)).toBe(PLANET_R_MIN);
    expect(planetRadius(1000)).toBe(PLANET_R_MAX);

    const roots = buildTree([
      node('big', null, 'a', { members: people(6) }),
      node('big-child', 'big', 'a', { members: people(40) }),
      node('small', null, 'b'),
    ]);
    const layout = orbitLayout(roots, []);
    // big counts its whole subtree (46 people) → clamped to max; small floors at min.
    expect(itemFor(layout, 'node:big').r).toBe(PLANET_R_MAX);
    expect(itemFor(layout, 'node:small').r).toBe(PLANET_R_MIN);
  });

  it('focus emits centered star, moons, lead-first leaves, ghosts and rings', () => {
    const roots = buildTree([
      node('a', null, 'a', { leads: people(1, 'lead'), members: people(2) }),
      node('a1', 'a', 'a'),
      node('a2', 'a', 'b'),
      node('deep', 'a1', 'a'), // grandchild: must NOT appear while focusing a
      node('b', null, 'b'),
      node('c', null, 'c'),
    ]);
    const layout = orbitLayout(roots, ['a']);

    const star = itemFor(layout, 'node:a');
    expect(star.kind).toBe('planet');
    expect(star.r).toBe(FOCUS_R);

    const moons = ofKind(layout, 'moon');
    expect(moons.map((m) => m.node?.id).sort()).toEqual(['a1', 'a2']);
    expect(moons.every((m) => m.r === MOON_R)).toBe(true);

    // Direct members only, 负责人 first.
    const leaves = ofKind(layout, 'leaf');
    expect(leaves).toHaveLength(3);
    expect(leaves[0]?.isLead).toBe(true);
    expect(leaves[0]?.member?.userId).toBe('lead0');
    expect(leaves.slice(1).every((l) => l.isLead === false)).toBe(true);

    // Other roots ghosted; grandchild never emitted.
    expect(ofKind(layout, 'ghost').map((g) => g.node?.id).sort()).toEqual(['b', 'c']);
    expect(layout.items.some((i) => i.node?.id === 'deep')).toBe(false);

    // One moon ring; the member cluster is seated by a halo, not a ring.
    expect(ofKind(layout, 'ring').map((r) => r.key)).toEqual(['ring:moons']);
    const halos = ofKind(layout, 'halo');
    expect(halos).toHaveLength(1);
    expect(halos[0]?.node?.id).toBe('a');
  });

  it('ghosts keep their overview bearing (spatial memory)', () => {
    const roots = buildTree([
      node('a', null, 'a'),
      node('b', null, 'b'),
      node('c', null, 'c'),
      node('d', null, 'd'),
    ]);
    const layout = orbitLayout(roots, ['a']);
    const center = itemFor(layout, 'node:a');

    // Overview slots for 4 roots: a -90°, b 0°, c 90°, d 180° — ghosts keep them.
    const b = itemFor(layout, 'node:b');
    expect(b.x).toBeCloseTo(center.x + GHOST_ARC_R, 6);
    expect(b.y).toBeCloseTo(center.y, 6);
    const c = itemFor(layout, 'node:c');
    expect(c.x).toBeCloseTo(center.x, 6);
    expect(c.y).toBeCloseTo(center.y + GHOST_ARC_R, 6);
    const d = itemFor(layout, 'node:d');
    expect(d.x).toBeCloseTo(center.x - GHOST_ARC_R, 6);
    expect(d.y).toBeCloseTo(center.y, 6);
  });

  it('packs members into a non-overlapping phyllotaxis cluster inside the moon ring', () => {
    const roots = buildTree([
      node('a', null, 'a', { leads: people(2, 'lead'), members: people(26) }),
      node('a1', 'a', 'a'),
      node('b', null, 'b'),
    ]);
    const layout = orbitLayout(roots, ['a']);
    const center = itemFor(layout, 'node:a');
    const dist = (i: OrbitItem): number => Math.hypot(i.x - center.x, i.y - center.y);

    const leaves = ofKind(layout, 'leaf');
    expect(leaves).toHaveLength(28);

    // Cluster hugs the star: cells clear the star and no two AVATARS collide.
    for (const leaf of leaves) {
      expect(dist(leaf)).toBeGreaterThan(FOCUS_R + LEAF_R / 2);
    }
    for (let i = 0; i < leaves.length; i += 1) {
      for (let j = i + 1; j < leaves.length; j += 1) {
        const a = leaves[i]!;
        const b = leaves[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(48);
      }
    }

    // 负责人 innermost (phyllotaxis radius grows with index; leads come first).
    const leadMax = Math.max(...leaves.filter((l) => l.isLead).map(dist));
    const memberMin = Math.min(...leaves.filter((l) => !l.isLead).map(dist));
    expect(leadMax).toBeLessThan(memberMin);

    // Moons orbit OUTSIDE the whole cluster; the halo seats it.
    const clusterOuter = Math.max(...leaves.map(dist)) + LEAF_R;
    for (const moon of ofKind(layout, 'moon')) {
      expect(dist(moon) - MOON_R).toBeGreaterThanOrEqual(clusterOuter);
    }
    const halo = ofKind(layout, 'halo')[0]!;
    expect(halo.r).toBeGreaterThanOrEqual(clusterOuter);
  });

  it('ghosts every ancestor level on progressively farther arcs', () => {
    const roots = buildTree([
      node('a', null, 'a'),
      node('a1', 'a', 'a', { members: people(2) }),
      node('a2', 'a', 'b'),
      node('a1x', 'a1', 'a'),
      node('b', null, 'b'),
    ]);
    const layout = orbitLayout(roots, ['a', 'a1']);
    const center = itemFor(layout, 'node:a1');

    expect(center.r).toBe(FOCUS_R);
    expect(ofKind(layout, 'moon').map((m) => m.node?.id)).toEqual(['a1x']);

    // Focus siblings on the near arc; root-level ghosts one band farther out.
    const ghosts = ofKind(layout, 'ghost');
    expect(ghosts.map((g) => g.node?.id).sort()).toEqual(['a2', 'b']);
    const a2 = itemFor(layout, 'node:a2');
    expect(a2.depth).toBe(1);
    expect(Math.hypot(a2.x - center.x, a2.y - center.y)).toBeCloseTo(GHOST_ARC_R, 6);
    const b = itemFor(layout, 'node:b');
    expect(b.depth).toBe(0);
    expect(Math.hypot(b.x - center.x, b.y - center.y)).toBeCloseTo(
      GHOST_ARC_R + GHOST_DEPTH_GAP,
      6,
    );

    // The ancestor itself lives in the breadcrumb, not on the canvas.
    expect(layout.items.some((i) => i.node?.id === 'a')).toBe(false);
  });

  it('falls back to the overview on an unknown or stale focus path', () => {
    const roots = buildTree([node('a', null, 'a'), node('a1', 'a', 'a'), node('b', null, 'b')]);
    for (const stale of [['zz'], ['a', 'zz'], ['a1']]) {
      const layout = orbitLayout(roots, stale);
      expect(ofKind(layout, 'core')).toHaveLength(1);
      expect(ofKind(layout, 'planet').map((i) => i.node?.id).sort()).toEqual(['a', 'b']);
      expect(ofKind(layout, 'ghost')).toHaveLength(0);
      expect(ofKind(layout, 'leaf')).toHaveLength(0);
    }
  });

  it('keeps all coordinates positive and bounds padded around every item', () => {
    const roots = buildTree([
      node('a', null, 'a', { leads: people(1, 'lead'), members: people(30) }),
      node('a1', 'a', 'a'),
      node('b', null, 'b'),
    ]);
    for (const path of [[], ['a']]) {
      const layout = orbitLayout(roots, path);
      let minEdge = Infinity;
      for (const item of layout.items) {
        expect(item.x - item.r).toBeGreaterThanOrEqual(0);
        expect(item.y - item.r).toBeGreaterThanOrEqual(0);
        expect(item.x + item.r).toBeLessThanOrEqual(layout.bounds.width);
        expect(item.y + item.r).toBeLessThanOrEqual(layout.bounds.height);
        minEdge = Math.min(minEdge, item.x - item.r, item.y - item.r);
      }
      expect(minEdge).toBeCloseTo(ORBIT_PADDING, 6);
    }
  });
});
