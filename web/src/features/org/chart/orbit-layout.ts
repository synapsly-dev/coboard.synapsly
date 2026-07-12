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
 *
 * v2 (全员星图): a focused scene shows EVERY member of the focus subtree exactly
 * once (dedup by userId) — direct-only members as the phyllotaxis cluster, each
 * moon's subtree members as a sector fan of arc rows behind that moon, and
 * multi-post (兼任) members as ONE shared leaf wired to every anchor unit via
 * `links` (rendered as thin lines that glide with the nodes).
 */

export type OrbitItemKind = 'core' | 'planet' | 'moon' | 'leaf' | 'ghost' | 'ring' | 'halo';

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
   * Leaf only (v2): the unit(s) this member hangs from — `[moon]` for a
   * sector-fan cell, every anchor unit for a 兼任 (multi-post) member (the
   * focus node first when they also hold a direct post). Absent on plain
   * direct-cluster cells, which are owned by the focus node itself.
   */
  anchors?: OrgTreeNode[];
  /**
   * Tree depth of `node` for planet/moon/ghost (roots = 0). Leaves sit at the
   * focus node's depth + 1; core and rings use the scene depth. Ghost clicks
   * rebuild the focus path from this: `path.slice(0, depth).concat(node.id)`.
   */
  depth: number;
}

/**
 * Anchor line between a unit and a member leaf (v2). Coordinates are NOT baked
 * in — the renderer resolves both keys against the item list every render, so
 * lines glide with the 400ms layout animation exactly like the nodes they join.
 */
export interface OrbitLink {
  /** Stable React key: `link:<fromKey>-><toKey>`. */
  key: string;
  /** `node:<moonId>`, or `node:<focusId>` for star anchors of 兼任 members. */
  fromKey: string;
  /** The member leaf: `leaf:<focusId>:<userId>`. */
  toKey: string;
}

export interface OrbitLayout {
  items: OrbitItem[];
  /** Unit→member anchor lines (focused scenes only; empty elsewhere). */
  links: OrbitLink[];
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
/**
 * 成员星团 (member cluster): direct members pack in a Vogel/phyllotaxis spiral
 * (sunflower-seed) annulus hugging the star — a FULL, organic disc instead of a
 * thin far-away ring (饱满地呈现成员). Moons orbit just OUTSIDE the cluster, so
 * the scene reads inside-out: star → its people → its sub-units → elsewhere.
 */
/** Leaf cell radius: a 68px cell holds the avatar + the name INSIDE it. */
export const LEAF_R = 34;
/** Phyllotaxis scale — approximates the nearest-neighbour pitch between cells. */
export const LEAF_SPREAD = 74;
/** Breathing room between the star's edge and the first member cells. */
export const LEAF_INNER_GAP = 22;
/** Golden angle (radians) — the phyllotaxis divergence. */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** Soft kind-tinted halo padding around the member cluster (visual seating). */
export const HALO_PAD = 14;

/** Moon ring: at least this radius, else pushed outside the member cluster. */
export const MOON_ORBIT_BASE_R = 230;
export const MOON_R = 46;
/** Gap between the member cluster's outer edge and moon centers. */
export const MOON_DISC_GAP = 42;

/**
 * 卫星扇区 (moon sector fan, v2): each moon's subtree members arc up in
 * concentric rows OUTSIDE the moon ring, centered on the moon's bearing.
 * FAN_BASE (first row radius) = moonOrbit + MOON_R + FAN_BASE_GAP.
 */
export const FAN_BASE_GAP = 64;
/** Radial pitch between consecutive fan rows. */
export const FAN_ROW_GAP = 76;
/** Arc pitch between neighbouring cells within a fan row. */
export const LEAF_PITCH = 72;
/** Fraction of a moon's angular slot its fan may fill (the rest is margin, so
 * neighbouring moons' fans can never overlap). */
export const FAN_SECTOR_RATIO = 0.82;
/** Minimum center distance between any two leaf cells (collision threshold). */
export const LEAF_MIN_DIST = 48;

/** Far arc for ghosted siblings — at least this, always clear of the scene. */
export const GHOST_ARC_R = 620;
/** Minimum clearance between the scene's outer content and the ghost arc. */
export const GHOST_CLEARANCE = 150;
export const GHOST_R = 14;
/** Each older ancestor level's ghosts sit this much farther out. */
export const GHOST_DEPTH_GAP = 110;

/** Whitespace baked around the whole scene (world units). */
export const ORBIT_PADDING = 64;

/** All orbits start at 12 o'clock and run clockwise (screen y grows down). */
const START_ANGLE = -Math.PI / 2;

// --- Helpers ------------------------------------------------------------------

/** Collect every distinct userId (负责人 + 成员) in a node's whole subtree. */
function collectSubtreeUserIds(node: OrgTreeNode, into: Set<string>): void {
  for (const p of node.leads) into.add(p.userId);
  for (const p of node.members) into.add(p.userId);
  for (const child of node.children) collectSubtreeUserIds(child, into);
}

/**
 * Distinct people (负责人 + 成员) in a node's whole subtree — sizes the planets
 * and feeds the headcount chips. 兼任 (one user holding several posts within the
 * subtree) counts ONCE, matching the deduped member star field.
 */
export function subtreePeople(node: OrgTreeNode): number {
  const ids = new Set<string>();
  collectSubtreeUserIds(node, ids);
  return ids.size;
}

/**
 * Distinct people across the whole forest — the 团队 core's headcount. Dedups
 * across root subtrees too, so a user holding posts under two departments still
 * counts once (summing per-root {@link subtreePeople} would double them).
 */
export function forestPeople(roots: OrgTreeNode[]): number {
  const ids = new Set<string>();
  for (const root of roots) collectSubtreeUserIds(root, ids);
  return ids.size;
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
      links: [],
      bounds: { width: 0, height: 0 },
      coreBounds: { x: 0, y: 0, width: 0, height: 0 },
    };
  }

  const chain = resolveFocusPath(roots, focusPath);
  const scene =
    focusPath.length > 0 && chain.length === focusPath.length
      ? focusScene(roots, chain)
      : { items: overviewScene(roots), links: [] };

  return finalize(scene.items, scene.links);
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

/** Focused `[…, focus]`: centered star + moons + leaves + links + ghost arcs. */
function focusScene(
  roots: OrgTreeNode[],
  chain: OrgTreeNode[],
): { items: OrbitItem[]; links: OrbitLink[] } {
  const items: OrbitItem[] = [];
  const links: OrbitLink[] = [];
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

  // 全员点名 (census): every member of the focus SUBTREE exactly once, deduped
  // by userId. Anchors — 'star' for a direct 负责人/成员 post on the focus node;
  // moon m when they appear anywhere in m's subtree (one anchor per moon no
  // matter how many posts inside it). isLead = 负责人 in ANY unit they hold.
  const census = new Map<
    string,
    { member: OrgNodeMember; isLead: boolean; star: boolean; moons: OrgTreeNode[] }
  >();
  const note = (member: OrgNodeMember, isLead: boolean, moon?: OrgTreeNode): void => {
    let entry = census.get(member.userId);
    if (!entry) {
      entry = { member, isLead: false, star: false, moons: [] };
      census.set(member.userId, entry);
    }
    if (isLead) entry.isLead = true;
    if (moon === undefined) entry.star = true;
    else if (!entry.moons.includes(moon)) entry.moons.push(moon);
  };
  focus.leads.forEach((member) => note(member, true));
  focus.members.forEach((member) => note(member, false));
  for (const moon of focus.children) {
    const walk = (node: OrgTreeNode): void => {
      node.leads.forEach((member) => note(member, true, moon));
      node.members.forEach((member) => note(member, false, moon));
      node.children.forEach(walk);
    };
    walk(moon);
  }
  const entries = [...census.values()];
  const leafKey = (userId: string): string => `leaf:${focus.id}:${userId}`;
  // Every placed leaf center — the collision reference for 兼任 nudging.
  const placed: Array<{ x: number; y: number }> = [];

  // Direct-only members as a phyllotaxis (sunflower) cluster hugging the star —
  // the 饱满 member disc. No link line: proximity implies ownership. 负责人
  // first ⇒ innermost, closest to the star (census preserves that order). Cells
  // pack at ~LEAF_SPREAD pitch; the annulus starts just outside the star's edge.
  const cluster = entries.filter((entry) => entry.star && entry.moons.length === 0);
  // Outer edge of the member cluster (star edge when there are no members).
  let discOuter = FOCUS_R;
  if (cluster.length > 0) {
    const innerR = FOCUS_R + LEAF_INNER_GAP + LEAF_R;
    // Index offset that opens the annulus hole: r(k) = SPREAD·√(k+k0).
    const k0 = (innerR / LEAF_SPREAD) ** 2;
    cluster.forEach(({ member, isLead }, i) => {
      const radius = LEAF_SPREAD * Math.sqrt(i + k0);
      const { x, y } = polar(radius, START_ANGLE + i * GOLDEN_ANGLE);
      discOuter = Math.max(discOuter, radius + LEAF_R);
      placed.push({ x, y });
      items.push({
        key: leafKey(member.userId),
        kind: 'leaf',
        x,
        y,
        r: LEAF_R,
        member,
        isLead,
        depth: focusDepth + 1,
      });
    });
    // Soft kind-tinted halo behind the DIRECT cluster seats the composition.
    items.push({
      key: 'halo:members',
      kind: 'halo',
      x: 0,
      y: 0,
      r: discOuter + HALO_PAD,
      node: focus,
      depth: focusDepth,
    });
  }

  // Unit children as moons on a ring just OUTSIDE the member cluster.
  const moons = focus.children;
  const moonOrbit = Math.max(MOON_ORBIT_BASE_R, discOuter + MOON_DISC_GAP + MOON_R);
  if (moons.length > 0) {
    items.push({ key: 'ring:moons', kind: 'ring', x: 0, y: 0, r: moonOrbit, depth: focusDepth });
    moons.forEach((child, i) => {
      const { x, y } = polar(moonOrbit, slotAngle(i, moons.length));
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

  // Subtree members OUTSIDE the moon ring (v2): sector fans + 兼任 leaves.
  // Tracks the outermost leaf edge so ghosts/coreBounds clear the fans.
  let leafOuter = discOuter;
  if (moons.length > 0) {
    const fanBase = moonOrbit + MOON_R + FAN_BASE_GAP;
    const sector = ((Math.PI * 2) / moons.length) * FAN_SECTOR_RATIO;
    const moonAngle = new Map(
      moons.map((moon, i): [string, number] => [moon.id, slotAngle(i, moons.length)]),
    );

    const pushLeaf = (
      entry: { member: OrgNodeMember; isLead: boolean },
      x: number,
      y: number,
      anchors: OrgTreeNode[],
    ): void => {
      const key = leafKey(entry.member.userId);
      placed.push({ x, y });
      leafOuter = Math.max(leafOuter, Math.hypot(x, y) + LEAF_R);
      items.push({
        key,
        kind: 'leaf',
        x,
        y,
        r: LEAF_R,
        member: entry.member,
        isLead: entry.isLead,
        anchors,
        depth: focusDepth + 1,
      });
      for (const anchor of anchors) {
        const fromKey = `node:${anchor.id}`;
        links.push({ key: `link:${fromKey}->${key}`, fromKey, toKey: key });
      }
    };

    // Single-moon members fan out in concentric arc rows behind their moon,
    // centered on its bearing; rows fill inner→outer at LEAF_PITCH along the
    // arc. Cells never leave their sector, so neighbouring fans stay apart.
    for (const moon of moons) {
      const fan = entries.filter(
        (entry) => !entry.star && entry.moons.length === 1 && entry.moons[0] === moon,
      );
      const bearing = moonAngle.get(moon.id)!;
      let index = 0;
      for (let row = 0; index < fan.length; row += 1) {
        const radius = fanBase + row * FAN_ROW_GAP;
        const capacity = Math.max(1, Math.floor((sector * radius) / LEAF_PITCH));
        const rowEntries = fan.slice(index, index + capacity);
        const pitch = LEAF_PITCH / radius;
        rowEntries.forEach((entry, i) => {
          const angle = bearing + (i - (rowEntries.length - 1) / 2) * pitch;
          const { x, y } = polar(radius, angle);
          pushLeaf(entry, x, y, [moon]);
        });
        index += rowEntries.length;
      }
    }

    // 兼任 (multi-post) members: ONE leaf in the middle band, linked to EVERY
    // anchor. Direction = normalized vector sum of the anchor positions (the
    // star sits at the origin and contributes zero; a near-zero sum — e.g. two
    // opposite moons — falls back to the first moon's bearing), then nudged
    // along the arc until clear of every already-placed cell.
    for (const entry of entries) {
      const anchorCount = (entry.star ? 1 : 0) + entry.moons.length;
      if (anchorCount < 2) continue;
      let sumX = 0;
      let sumY = 0;
      for (const moon of entry.moons) {
        const p = polar(moonOrbit, moonAngle.get(moon.id)!);
        sumX += p.x;
        sumY += p.y;
      }
      const bearing =
        Math.hypot(sumX, sumY) < 1e-6
          ? moonAngle.get(entry.moons[0]!.id)!
          : Math.atan2(sumY, sumX);
      const spot = nudgeClear(bearing, fanBase + FAN_ROW_GAP, placed);
      pushLeaf(entry, spot.x, spot.y, entry.star ? [focus, ...entry.moons] : [...entry.moons]);
    }
  }

  // Ghost arcs must clear the (possibly grown) scene content, fans included.
  const sceneOuter = Math.max(leafOuter, moons.length > 0 ? moonOrbit + MOON_R : 0);
  const ghostBase = Math.max(GHOST_ARC_R, sceneOuter + GHOST_CLEARANCE);

  // Every ancestor level's siblings become ghosts. The focus node's own siblings
  // sit on the nearest arc; each older level is pushed GHOST_DEPTH_GAP farther.
  // Angles preserve each ghost's bearing among its FULL sibling set (the slot it
  // held in the overview / as a moon), keeping spatial memory intact.
  for (let d = 0; d <= focusDepth; d++) {
    const siblings = d === 0 ? roots : chain[d - 1]!.children;
    const arcR = ghostBase + (focusDepth - d) * GHOST_DEPTH_GAP;
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

  return { items, links };
}

/**
 * First spot ≥ LEAF_MIN_DIST from every placed cell: sweep the arc at `radius`
 * away from `bearing` in LEAF_PITCH steps to both sides, then move one band
 * out and retry (兼任 leaves only — fan rows are collision-free by construction).
 */
function nudgeClear(
  bearing: number,
  startRadius: number,
  placed: Array<{ x: number; y: number }>,
): { x: number; y: number } {
  let radius = startRadius;
  for (let band = 0; band < 8; band += 1) {
    const step = LEAF_PITCH / radius;
    const half = Math.ceil(Math.PI / step);
    for (let k = 0; k <= half; k += 1) {
      for (const sign of k === 0 ? [0] : [-1, 1]) {
        const spot = polar(radius, bearing + sign * k * step);
        if (placed.every((p) => Math.hypot(p.x - spot.x, p.y - spot.y) >= LEAF_MIN_DIST)) {
          return spot;
        }
      }
    }
    radius += FAN_ROW_GAP;
  }
  // Pathological fallback (every band saturated): straight out along the bearing.
  return polar(radius, bearing);
}

/** Offset all items so coordinates are positive with padding; compute bounds. */
function finalize(items: OrbitItem[], links: OrbitLink[]): OrbitLayout {
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
    links,
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
