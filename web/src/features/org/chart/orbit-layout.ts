import type { OrgNodeMember } from 'shared';
import type { OrgTreeNode } from '../tree';

/**
 * Pure orbital ("星系") layout for the org planet canvas. One function derives all
 * three scenes from a single piece of state — `focusPath`, the id chain of the
 * focused node:
 *
 * - `[]`      overview: the 团队 core (恒星) at center, root departments as
 *             planets evenly spaced on one orbit ring; nothing below roots.
 * - `[a]`     focus: node `a` centered as a local star, its unit children as
 *             moons on an inner ring, its DIRECT members as avatar leaves on an
 *             outer ring, the other roots pushed out as ghost planets on a far
 *             arc that preserves their overview bearing (spatial memory).
 * - `[a,b,…]` recursion: same picture around the deepest node; every ancestor
 *             level's siblings compress into progressively farther ghost arcs.
 *
 * Because item keys are stable (`node:<id>` / `leaf:<nodeId>:<userId>`), the
 * renderer can CSS-transition items between two layouts — the "挤开" effect is
 * simply the diff between scenes. Kept pure and DOM-free (orbit-layout.test.ts).
 */

export type OrbitItemKind = 'core' | 'planet' | 'moon' | 'leaf' | 'ghost' | 'ring';

export interface OrbitItem {
  /** Stable React key: `core`, `ring:*`, `node:<id>`, `leaf:<nodeId>:<userId>`. */
  key: string;
  kind: OrbitItemKind;
  /** Center of the item, world px (positive after the final offset). */
  x: number;
  y: number;
  /** Radius: circle radius for nodes/core/ghosts, orbit radius for rings. */
  r: number;
  /** The org node (planet / moon / ghost; absent on core, rings and leaves). */
  node?: OrgTreeNode;
  /** The person (leaf items only). */
  member?: OrgNodeMember;
  /** Leaf only: the member is a 负责人 (renders the amber ring + crown). */
  isLead?: boolean;
  /**
   * Tree depth of `node` for planet/moon/ghost (roots = 0). Leaves sit at the
   * focus node's depth + 1; core and rings use the scene depth. Ghost clicks
   * rebuild the focus path from this: `path.slice(0, depth).concat(node.id)`.
   */
  depth: number;
}

export interface OrbitLayout {
  items: OrbitItem[];
  /** Tight world size including ORBIT_PADDING on all sides ({0,0} when empty). */
  bounds: { width: number; height: number };
  /**
   * Rect (world coordinates) around the CORE scene only — everything except the
   * ghost arcs. The focused camera frames THIS (可读性: the star/moons/leaves
   * fill the viewport; ghosts sit at the edges). Equals `bounds` as a rect when
   * there are no ghosts (overview / empty).
   */
  coreBounds: { x: number; y: number; width: number; height: number };
}

// --- Geometry constants (world px; tuned for legibility, tweak freely) -------

/** 团队 core (恒星) radius in the overview. */
export const CORE_R = 56;
/** Overview planet radius = clamp(PLANET_R_MIN + people × PLANET_R_PER_PERSON). */
export const PLANET_R_MIN = 30;
export const PLANET_R_MAX = 52;
export const PLANET_R_PER_PERSON = 1.5;
/** Overview orbit radius = base + planet count × step (more planets, wider ring). */
export const OVERVIEW_ORBIT_BASE = 220;
export const OVERVIEW_ORBIT_PER_PLANET = 6;

/**
 * Focused node (local star) radius. The focused scene is deliberately GENEROUS
 * (可读性优先): the camera frames only the core scene (coreBounds, ghosts
 * excluded) and may zoom past 100%, so these sizes read comfortably.
 */
export const FOCUS_R = 78;
/** Inner ring for the focus node's unit children (moons). */
export const MOON_ORBIT_R = 230;
export const MOON_R = 46;
/** Outer ring for the focus node's direct members (avatar leaves). */
export const LEAF_ORBIT_R = 400;
/** Leaf ring when the focus node has NO unit children (avoid a hollow scene). */
export const LEAF_ORBIT_NEAR_R = 290;
export const LEAF_R = 24;
/** More leaves than this split into two rings (inner + outer). */
export const LEAF_RING_SPLIT = 24;
/** Radial gap between the two leaf rings. */
export const LEAF_RING_GAP = 96;
/** Alternating radial jitter on a crowded single leaf ring (label overlap). */
export const LEAF_JITTER = 16;
/** Apply the jitter only when a single ring holds more than this many leaves. */
export const LEAF_JITTER_MIN = 10;

/** Far arc for the focus node's ghosted siblings (clear of the outer leaf ring). */
export const GHOST_ARC_R = 620;
export const GHOST_R = 14;
/** Each older ancestor level's ghosts sit this much farther out. */
export const GHOST_DEPTH_GAP = 110;

/** Whitespace baked around the whole scene (world units). */
export const ORBIT_PADDING = 64;

/** All orbits start at 12 o'clock and run clockwise (screen y grows down). */
const START_ANGLE = -Math.PI / 2;

// --- Helpers ------------------------------------------------------------------

/** Total people (负责人 + 成员) in a node's whole subtree — sizes the planets. */
export function subtreePeople(node: OrgTreeNode): number {
  let total = node.leads.length + node.members.length;
  for (const child of node.children) total += subtreePeople(child);
  return total;
}

/**
 * Resolve a focus path id chain into nodes, level by level. Returns [] whenever
 * any segment is unknown/stale (e.g. the node was deleted meanwhile) so callers
 * can fall back to the overview instead of rendering a broken scene.
 */
export function resolveFocusPath(roots: OrgTreeNode[], focusPath: string[]): OrgTreeNode[] {
  const chain: OrgTreeNode[] = [];
  let level = roots;
  for (const id of focusPath) {
    const hit = level.find((n) => n.id === id);
    if (!hit) return [];
    chain.push(hit);
    level = hit.children;
  }
  return chain;
}

/** Overview planet radius from the subtree headcount, clamped. */
export function planetRadius(people: number): number {
  return Math.min(PLANET_R_MAX, Math.max(PLANET_R_MIN, PLANET_R_MIN + people * PLANET_R_PER_PERSON));
}

/** Angle of slot `index` among `count` evenly spaced slots, from -90° clockwise. */
function slotAngle(index: number, count: number, offset = 0): number {
  return START_ANGLE + ((index + offset) * Math.PI * 2) / Math.max(count, 1);
}

function polar(radius: number, angle: number): { x: number; y: number } {
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

// --- Layout -------------------------------------------------------------------

/**
 * Lay out the forest around `focusPath`. Coordinates are computed around a
 * (0,0) center, then offset so everything is positive with ORBIT_PADDING of
 * whitespace on all sides (same convention as layout.ts).
 */
export function orbitLayout(roots: OrgTreeNode[], focusPath: string[]): OrbitLayout {
  if (roots.length === 0) {
    return {
      items: [],
      bounds: { width: 0, height: 0 },
      coreBounds: { x: 0, y: 0, width: 0, height: 0 },
    };
  }

  const chain = resolveFocusPath(roots, focusPath);
  const items =
    focusPath.length > 0 && chain.length === focusPath.length
      ? focusScene(roots, chain)
      : overviewScene(roots);

  return finalize(items);
}

/** Overview `[]`: core + one orbit ring + roots as planets. Nothing deeper. */
function overviewScene(roots: OrgTreeNode[]): OrbitItem[] {
  const items: OrbitItem[] = [];
  const orbitR = OVERVIEW_ORBIT_BASE + roots.length * OVERVIEW_ORBIT_PER_PLANET;

  items.push({ key: 'ring:overview', kind: 'ring', x: 0, y: 0, r: orbitR, depth: 0 });
  items.push({ key: 'core', kind: 'core', x: 0, y: 0, r: CORE_R, depth: 0 });

  roots.forEach((root, i) => {
    const { x, y } = polar(orbitR, slotAngle(i, roots.length));
    items.push({
      key: `node:${root.id}`,
      kind: 'planet',
      x,
      y,
      r: planetRadius(subtreePeople(root)),
      node: root,
      depth: 0,
    });
  });

  return items;
}

/** Focused `[…, focus]`: centered star + moons + leaves + ghost arcs per level. */
function focusScene(roots: OrgTreeNode[], chain: OrgTreeNode[]): OrbitItem[] {
  const items: OrbitItem[] = [];
  const focus = chain[chain.length - 1]!;
  const focusDepth = chain.length - 1;

  // The focus node — a local star at the center.
  items.push({
    key: `node:${focus.id}`,
    kind: 'planet',
    x: 0,
    y: 0,
    r: FOCUS_R,
    node: focus,
    depth: focusDepth,
  });

  // Unit children as moons on the inner ring.
  const moons = focus.children;
  if (moons.length > 0) {
    items.push({ key: 'ring:moons', kind: 'ring', x: 0, y: 0, r: MOON_ORBIT_R, depth: focusDepth });
    moons.forEach((child, i) => {
      const { x, y } = polar(MOON_ORBIT_R, slotAngle(i, moons.length));
      items.push({
        key: `node:${child.id}`,
        kind: 'moon',
        x,
        y,
        r: MOON_R,
        node: child,
        depth: focusDepth + 1,
      });
    });
  }

  // Direct members as avatar leaves on the outer ring(s), 负责人 first.
  const people: Array<{ member: OrgNodeMember; isLead: boolean }> = [
    ...focus.leads.map((member) => ({ member, isLead: true })),
    ...focus.members.map((member) => ({ member, isLead: false })),
  ];
  if (people.length > 0) {
    const baseR = moons.length > 0 ? LEAF_ORBIT_R : LEAF_ORBIT_NEAR_R;
    const twoRings = people.length > LEAF_RING_SPLIT;
    const innerCount = twoRings ? Math.ceil(people.length / 2) : people.length;

    items.push({ key: 'ring:leaves', kind: 'ring', x: 0, y: 0, r: baseR, depth: focusDepth });
    if (twoRings) {
      items.push({
        key: 'ring:leaves-outer',
        kind: 'ring',
        x: 0,
        y: 0,
        r: baseR + LEAF_RING_GAP,
        depth: focusDepth,
      });
    }

    people.forEach(({ member, isLead }, i) => {
      const onOuter = twoRings && i >= innerCount;
      const ringIndex = onOuter ? i - innerCount : i;
      const ringCount = onOuter ? people.length - innerCount : innerCount;
      // Outer ring shifts half a slot so the two rings interleave visually; a
      // crowded single ring alternates radius so name labels don't collide.
      const jitter =
        !twoRings && people.length > LEAF_JITTER_MIN && i % 2 === 1 ? LEAF_JITTER : 0;
      const radius = (onOuter ? baseR + LEAF_RING_GAP : baseR) + jitter;
      const { x, y } = polar(radius, slotAngle(ringIndex, ringCount, onOuter ? 0.5 : 0));
      items.push({
        key: `leaf:${focus.id}:${member.userId}`,
        kind: 'leaf',
        x,
        y,
        r: LEAF_R,
        member,
        isLead,
        depth: focusDepth + 1,
      });
    });
  }

  // Every ancestor level's siblings become ghosts. The focus node's own siblings
  // sit on the nearest arc; each older level is pushed GHOST_DEPTH_GAP farther.
  // Angles preserve each ghost's bearing among its FULL sibling set (the slot it
  // held in the overview / as a moon), keeping spatial memory intact.
  for (let d = 0; d <= focusDepth; d++) {
    const siblings = d === 0 ? roots : chain[d - 1]!.children;
    const arcR = GHOST_ARC_R + (focusDepth - d) * GHOST_DEPTH_GAP;
    siblings.forEach((sibling, i) => {
      if (sibling.id === chain[d]!.id) return;
      const { x, y } = polar(arcR, slotAngle(i, siblings.length));
      items.push({
        key: `node:${sibling.id}`,
        kind: 'ghost',
        x,
        y,
        r: GHOST_R,
        node: sibling,
        depth: d,
      });
    });
  }

  return items;
}

/** Offset all items so coordinates are positive with padding; compute bounds. */
function finalize(items: OrbitItem[]): OrbitLayout {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // Core scene extent — everything but the ghost arcs (drives the focused camera).
  let coreMinX = Infinity;
  let coreMinY = Infinity;
  let coreMaxX = -Infinity;
  let coreMaxY = -Infinity;
  for (const item of items) {
    minX = Math.min(minX, item.x - item.r);
    minY = Math.min(minY, item.y - item.r);
    maxX = Math.max(maxX, item.x + item.r);
    maxY = Math.max(maxY, item.y + item.r);
    if (item.kind !== 'ghost') {
      coreMinX = Math.min(coreMinX, item.x - item.r);
      coreMinY = Math.min(coreMinY, item.y - item.r);
      coreMaxX = Math.max(coreMaxX, item.x + item.r);
      coreMaxY = Math.max(coreMaxY, item.y + item.r);
    }
  }
  // Degenerate guard (ghost-only scenes can't occur, but stay safe).
  if (coreMinX === Infinity) {
    coreMinX = minX;
    coreMinY = minY;
    coreMaxX = maxX;
    coreMaxY = maxY;
  }

  const dx = ORBIT_PADDING - minX;
  const dy = ORBIT_PADDING - minY;
  for (const item of items) {
    item.x += dx;
    item.y += dy;
  }

  return {
    items,
    bounds: {
      width: maxX - minX + ORBIT_PADDING * 2,
      height: maxY - minY + ORBIT_PADDING * 2,
    },
    coreBounds: {
      x: coreMinX + dx - ORBIT_PADDING / 2,
      y: coreMinY + dy - ORBIT_PADDING / 2,
      width: coreMaxX - coreMinX + ORBIT_PADDING,
      height: coreMaxY - coreMinY + ORBIT_PADDING,
    },
  };
}
