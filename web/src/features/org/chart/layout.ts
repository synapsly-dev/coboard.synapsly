import type { OrgTreeNode } from '../tree';

/**
 * Pure tidy-tree layout for the org chart canvas (团队架构 图谱). Reingold–Tilford
 * style for fixed-size cards: a post-order pass computes each subtree's width
 * (max of the card width and the children span), then a pre-order pass centers
 * every parent over its children span. Collapsed nodes contribute a single card
 * width and emit no descendants or edges. Kept pure and DOM-free so it is
 * unit-testable in isolation (layout.test.ts).
 */

/** Card width in world px. */
export const NODE_W = 224;
/** Card height in world px. */
export const NODE_H = 112;
/** Horizontal gap between sibling subtrees. */
export const SIBLING_GAP = 24;
/** Vertical gap between ranks (parent bottom → child top). */
export const RANK_GAP = 64;
/** Horizontal gap between root subtrees (independent columns). */
export const ROOT_GAP = 48;
/** Whitespace baked around the whole diagram (world units). */
export const PADDING = 48;

export interface PlacedNode {
  node: OrgTreeNode;
  /** Left edge of the card, world px. */
  x: number;
  /** Top edge of the card, world px. */
  y: number;
}

/** One orthogonal connector: parent bottom-center → child top-center. */
export interface Edge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface OrgLayout {
  nodes: PlacedNode[];
  edges: Edge[];
  /** Tight world size including PADDING on all sides ({0,0} when empty). */
  bounds: { width: number; height: number };
}

/**
 * Lay out a forest of org nodes. `collapsed` prunes the descendants (and edges)
 * of any node whose id it contains; the collapsed node itself still renders.
 */
export function layoutTree(roots: OrgTreeNode[], collapsed: Set<string>): OrgLayout {
  const nodes: PlacedNode[] = [];
  const edges: Edge[] = [];
  if (roots.length === 0) return { nodes, edges, bounds: { width: 0, height: 0 } };

  const visibleChildren = (node: OrgTreeNode): OrgTreeNode[] =>
    collapsed.has(node.id) ? [] : node.children;

  // Post-order: width of each visible subtree.
  const widths = new Map<string, number>();
  const measure = (node: OrgTreeNode): number => {
    const kids = visibleChildren(node);
    let width = NODE_W;
    if (kids.length > 0) {
      let span = SIBLING_GAP * (kids.length - 1);
      for (const child of kids) span += measure(child);
      width = Math.max(NODE_W, span);
    }
    widths.set(node.id, width);
    return width;
  };

  // Pre-order: place each card centered over its children span.
  let maxDepth = 0;
  const place = (node: OrgTreeNode, left: number, depth: number): void => {
    const width = widths.get(node.id) ?? NODE_W;
    const x = left + (width - NODE_W) / 2;
    const y = PADDING + depth * (NODE_H + RANK_GAP);
    nodes.push({ node, x, y });
    if (depth > maxDepth) maxDepth = depth;

    const kids = visibleChildren(node);
    if (kids.length === 0) return;

    let span = SIBLING_GAP * (kids.length - 1);
    for (const child of kids) span += widths.get(child.id) ?? NODE_W;

    let cursor = left + (width - span) / 2;
    for (const child of kids) {
      const childWidth = widths.get(child.id) ?? NODE_W;
      edges.push({
        fromX: x + NODE_W / 2,
        fromY: y + NODE_H,
        toX: cursor + childWidth / 2,
        toY: PADDING + (depth + 1) * (NODE_H + RANK_GAP),
      });
      place(child, cursor, depth + 1);
      cursor += childWidth + SIBLING_GAP;
    }
  };

  let total = ROOT_GAP * (roots.length - 1);
  for (const root of roots) total += measure(root);

  let cursor = PADDING;
  for (const root of roots) {
    place(root, cursor, 0);
    cursor += (widths.get(root.id) ?? NODE_W) + ROOT_GAP;
  }

  return {
    nodes,
    edges,
    bounds: {
      width: total + PADDING * 2,
      height: (maxDepth + 1) * NODE_H + maxDepth * RANK_GAP + PADDING * 2,
    },
  };
}
