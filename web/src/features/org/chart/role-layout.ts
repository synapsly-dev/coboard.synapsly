import type { OrgTreeNode } from '../tree';

/** Width shared by structural headers and position cards. */
export const ROLE_CARD_W = 264;
export const TEAM_CARD_H = 72;
export const BRANCH_CARD_H = 72;
export const POSITION_CARD_H = 104;
export const CARD_GAP = 12;
export const SIBLING_GAP = 40;
export const RANK_GAP = 64;
export const ROLE_PADDING = 48;

export interface RoleTeamLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoleBranchLayout {
  node: OrgTreeNode;
  x: number;
  y: number;
}

export interface RolePositionLayout {
  node: OrgTreeNode;
  x: number;
  y: number;
}

export interface RoleEdgeLayout {
  key: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface RoleChartLayout {
  team: RoleTeamLayout | null;
  branches: RoleBranchLayout[];
  positions: RolePositionLayout[];
  edges: RoleEdgeLayout[];
  bounds: { width: number; height: number };
}

const structuralChildren = (node: OrgTreeNode): OrgTreeNode[] =>
  node.children.filter((child) => child.kind !== 'position');

const directPositions = (node: OrgTreeNode): OrgTreeNode[] =>
  node.children.filter((child) => child.kind === 'position');

/**
 * Role-oriented organization layout. Structural units consume horizontal space;
 * their direct positions stack vertically in the same column and therefore do not
 * make the chart wider. A synthetic team card connects multiple API roots.
 */
export function layoutRoleChart(
  roots: OrgTreeNode[],
  collapsed: ReadonlySet<string> = new Set(),
): RoleChartLayout {
  const branches: RoleBranchLayout[] = [];
  const positions: RolePositionLayout[] = [];
  const edges: RoleEdgeLayout[] = [];
  if (roots.length === 0) {
    return { team: null, branches, positions, edges, bounds: { width: 0, height: 0 } };
  }

  const widths = new Map<string, number>();
  const visibleStructuralChildren = (node: OrgTreeNode): OrgTreeNode[] =>
    collapsed.has(node.id) ? [] : structuralChildren(node);

  const measureBranch = (node: OrgTreeNode): number => {
    const children = visibleStructuralChildren(node);
    let width = ROLE_CARD_W;
    if (children.length > 0) {
      let span = SIBLING_GAP * (children.length - 1);
      for (const child of children) span += measureBranch(child);
      width = Math.max(width, span);
    }
    widths.set(node.id, width);
    return width;
  };

  const topItems = roots.map((node) => ({
    node,
    width: node.kind === 'position' ? ROLE_CARD_W : measureBranch(node),
  }));
  const totalSpan =
    topItems.reduce((sum, item) => sum + item.width, 0) +
    SIBLING_GAP * Math.max(0, topItems.length - 1);

  const team: RoleTeamLayout = {
    x: Math.round(ROLE_PADDING + (totalSpan - ROLE_CARD_W) / 2),
    y: ROLE_PADDING,
    width: ROLE_CARD_W,
    height: TEAM_CARD_H,
  };
  const topY = team.y + team.height + RANK_GAP;
  let maxRight = team.x + team.width;
  let maxBottom = team.y + team.height;

  const placeBranch = (node: OrgTreeNode, left: number, y: number): void => {
    const width = widths.get(node.id) ?? ROLE_CARD_W;
    const x = Math.round(left + (width - ROLE_CARD_W) / 2);
    branches.push({ node, x, y });
    maxRight = Math.max(maxRight, x + ROLE_CARD_W);
    maxBottom = Math.max(maxBottom, y + BRANCH_CARD_H);

    const visiblePositions = collapsed.has(node.id) ? [] : directPositions(node);
    let positionY = y + BRANCH_CARD_H + CARD_GAP;
    for (const position of visiblePositions) {
      positions.push({ node: position, x, y: positionY });
      maxRight = Math.max(maxRight, x + ROLE_CARD_W);
      maxBottom = Math.max(maxBottom, positionY + POSITION_CARD_H);
      positionY += POSITION_CARD_H + CARD_GAP;
    }
    if (visiblePositions.length > 0) {
      edges.push({
        key: `positions:${node.id}`,
        fromX: x + ROLE_CARD_W / 2,
        fromY: y + BRANCH_CARD_H,
        toX: x + ROLE_CARD_W / 2,
        toY: y + BRANCH_CARD_H + CARD_GAP,
      });
    }

    const children = visibleStructuralChildren(node);
    if (children.length === 0) return;

    const ownBottom = visiblePositions.length > 0 ? positionY - CARD_GAP : y + BRANCH_CARD_H;
    const childY = ownBottom + RANK_GAP;
    let childSpan = SIBLING_GAP * (children.length - 1);
    for (const child of children) childSpan += widths.get(child.id) ?? ROLE_CARD_W;
    let childLeft = left + (width - childSpan) / 2;

    for (const child of children) {
      const childWidth = widths.get(child.id) ?? ROLE_CARD_W;
      edges.push({
        key: `branch:${node.id}->${child.id}`,
        fromX: x + ROLE_CARD_W / 2,
        fromY: ownBottom,
        toX: childLeft + childWidth / 2,
        toY: childY,
      });
      placeBranch(child, childLeft, childY);
      childLeft += childWidth + SIBLING_GAP;
    }
  };

  let left = ROLE_PADDING;
  for (const item of topItems) {
    const targetX = Math.round(left + (item.width - ROLE_CARD_W) / 2);
    edges.push({
      key: `team:${item.node.id}`,
      fromX: team.x + team.width / 2,
      fromY: team.y + team.height,
      toX: targetX + ROLE_CARD_W / 2,
      toY: topY,
    });
    if (item.node.kind === 'position') {
      positions.push({ node: item.node, x: targetX, y: topY });
      maxRight = Math.max(maxRight, targetX + ROLE_CARD_W);
      maxBottom = Math.max(maxBottom, topY + POSITION_CARD_H);
    } else {
      placeBranch(item.node, left, topY);
    }
    left += item.width + SIBLING_GAP;
  }

  return {
    team,
    branches,
    positions,
    edges,
    bounds: {
      width: Math.max(totalSpan + ROLE_PADDING * 2, maxRight + ROLE_PADDING),
      height: maxBottom + ROLE_PADDING,
    },
  };
}
