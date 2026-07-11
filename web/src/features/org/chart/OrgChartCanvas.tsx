import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Crown,
  Maximize2,
  MoreHorizontal,
  Pencil,
  Users,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { OrgNode, OrgNodeKind, OrgNodeMember } from 'shared';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
} from '../../../components/ui';
import { avatarUrl, cn } from '../../../lib/utils';
import {
  isPositionFull,
  occupancyLabel,
  ORG_KIND_ACCENT,
  ORG_KIND_BADGE,
  ORG_KIND_LABELS,
} from '../labels';
import { OrgAddNodeButton } from '../OrgAddNodeButton';
import type { OrgTreeNode } from '../tree';
import { layoutTree, NODE_H, NODE_W, type Edge } from './layout';
import { useCanvas } from './useCanvas';

/**
 * Org chart canvas (团队架构 图谱视图) — a real pan/zoom canvas in the spirit of
 * Figma / 飞书组织架构. Three layers: a pure tidy-tree layout (layout.ts), a
 * transform-based viewport (useCanvas.ts), and this renderer — a dot-grid world
 * with an SVG layer of rounded orthogonal connectors below absolutely-positioned
 * node cards. People live INSIDE the cards (lead + member avatar stack); there
 * are no person leaf nodes. Same prop contract as the old OrgChart.
 */
interface OrgChartCanvasProps {
  roots: OrgTreeNode[];
  editable?: boolean;
  onAddChild?: (node: OrgNode, kind: OrgNodeKind) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
}

/** Corner radius of the orthogonal connectors. */
const EDGE_RADIUS = 8;
/** Avatars shown in a card's member stack before the "+N" bubble. */
const MAX_STACK = 5;

export function OrgChartCanvas({
  roots,
  editable = false,
  onAddChild,
  onEdit,
  onMembers,
}: OrgChartCanvasProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const layout = useMemo(() => layoutTree(roots, collapsed), [roots, collapsed]);
  const descendantCounts = useMemo(() => countDescendants(roots), [roots]);
  const { viewportRef, transform, dragging, animated, zoomIn, zoomOut, fitTo, reset } = useCanvas(
    layout.bounds,
  );

  return (
    <div
      ref={viewportRef}
      tabIndex={0}
      aria-label="组织架构图谱"
      className={cn(
        'relative h-full w-full touch-none select-none overflow-hidden bg-background outline-none',
        // Inset focus ring — the pane is full-bleed, an offset ring would clip.
        'ring-inset ring-offset-0',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
    >
      {/* World layer — everything inside shares one transform, so the dot grid,
          edges and cards zoom together (transform-origin 0 0). */}
      <div
        className={cn(
          'absolute left-0 top-0 origin-top-left will-change-transform',
          // Button zoom steps ease over 150ms; wheel/drag/pinch never transition.
          animated &&
            'motion-safe:transition-transform motion-safe:duration-base motion-safe:ease-standard',
        )}
        style={{
          width: layout.bounds.width,
          height: layout.bounds.height,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          backgroundImage:
            'radial-gradient(circle, hsl(var(--border) / 0.6) 1.5px, transparent 1.5px)',
          backgroundSize: '24px 24px',
        }}
      >
        {/* Edge layer (below cards): one rounded orthogonal path per child. */}
        <svg
          className="absolute left-0 top-0"
          width={layout.bounds.width}
          height={layout.bounds.height}
          aria-hidden="true"
        >
          {layout.edges.map((edge, index) => (
            <path
              key={index}
              d={edgePath(edge)}
              className="stroke-border"
              strokeWidth={1.5}
              strokeLinecap="round"
              fill="none"
            />
          ))}
        </svg>

        {/* Card layer. */}
        {layout.nodes.map(({ node, x, y }) => (
          <NodeCard
            key={node.id}
            node={node}
            x={x}
            y={y}
            editable={editable}
            isCollapsed={collapsed.has(node.id)}
            descendants={descendantCounts.get(node.id) ?? 0}
            onToggle={toggle}
            onAddChild={onAddChild}
            onEdit={onEdit}
            onMembers={onMembers}
          />
        ))}
      </div>

      {/* Gesture hint — pointless on touch, so only shown for hover devices. */}
      <p className="pointer-events-none absolute bottom-4 left-4 hidden text-[11px] text-muted-foreground [@media(hover:hover)]:block">
        拖拽平移 · 滚轮缩放
      </p>

      {/* Floating zoom controls. */}
      <div className="absolute bottom-4 right-4 flex items-center gap-0.5 rounded-lg border border-border bg-card/95 p-1 shadow-md backdrop-blur">
        <Tooltip content="缩小">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 sm:h-8 sm:w-8"
            aria-label="缩小"
            onClick={zoomOut}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
        </Tooltip>
        <Tooltip content="缩放至 100%">
          <button
            type="button"
            className="h-8 min-w-[3rem] rounded-md px-1 text-xs font-medium tabular-nums text-muted-foreground transition-colors duration-base ease-standard hover:bg-accent hover:text-foreground"
            aria-label="缩放至 100%"
            onClick={reset}
          >
            {Math.round(transform.scale * 100)}%
          </button>
        </Tooltip>
        <Tooltip content="放大">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 sm:h-8 sm:w-8"
            aria-label="放大"
            onClick={zoomIn}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </Tooltip>
        <div className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <Tooltip content="适应视图">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 sm:h-8 sm:w-8"
            aria-label="适应视图"
            onClick={() => fitTo()}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

/**
 * One 224×112 node card. Fixed size (the layout depends on it): accent bar,
 * kind/occupancy chips, two-line title, and the people row — lead with a crown
 * plus the member avatar stack. The collapse pill straddles the bottom edge;
 * editable affordances (＋ child, ⋯ menu) appear on hover (always on touch).
 */
function NodeCard({
  node,
  x,
  y,
  editable,
  isCollapsed,
  descendants,
  onToggle,
  onAddChild,
  onEdit,
  onMembers,
}: {
  node: OrgTreeNode;
  x: number;
  y: number;
  editable: boolean;
  isCollapsed: boolean;
  descendants: number;
  onToggle: (id: string) => void;
  onAddChild?: (node: OrgNode, kind: OrgNodeKind) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
}): JSX.Element {
  const lead = node.leads[0];
  const stack = [...node.leads.slice(1), ...node.members];
  const shown = stack.slice(0, MAX_STACK);
  const overflow = stack.length - shown.length;
  const hasChildren = node.children.length > 0;
  const full = node.kind === 'position' && isPositionFull(node);

  // Old-chart hover-gating pattern: always visible on touch, hover/focus on sm+.
  const hoverGated =
    'opacity-100 transition-opacity duration-base ease-standard sm:pointer-events-none sm:opacity-0 sm:group-hover/card:pointer-events-auto sm:group-hover/card:opacity-100 sm:group-focus-within/card:pointer-events-auto sm:group-focus-within/card:opacity-100';

  return (
    <div
      data-org-card
      className="group/card absolute cursor-default rounded-xl border border-border bg-card shadow-sm transition-[box-shadow,transform] duration-base ease-standard hover:-translate-y-px hover:shadow-md"
      style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
    >
      {/* Kind accent bar. */}
      <div
        className={cn('absolute inset-x-0 top-0 h-[3px] rounded-t-xl', ORG_KIND_ACCENT[node.kind])}
        aria-hidden
      />

      <div className="flex h-full min-h-0 flex-col gap-1 overflow-hidden p-3">
        {/* Row 1: kind badge + occupancy chip (positions only, slate when full). */}
        <div className={cn('flex items-center gap-1 overflow-hidden', editable && 'pr-6')}>
          <span
            className={cn(
              'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none',
              ORG_KIND_BADGE[node.kind],
            )}
          >
            {ORG_KIND_LABELS[node.kind]}
          </span>
          {node.kind === 'position' && (
            <span
              className={cn(
                'truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none ring-1 ring-inset',
                full
                  ? 'bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300'
                  : 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400',
              )}
            >
              {occupancyLabel(node)}
            </span>
          )}
        </div>

        {/* Row 2: title. */}
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground" title={node.title}>
          {node.title}
        </p>

        {/* Row 3: people — lead + member stack, clickable when onMembers exists. */}
        <PeopleRow node={node} lead={lead} shown={shown} overflow={overflow} onMembers={onMembers} />
      </div>

      {/* Editable ⋯ menu, top-right in-card. */}
      {editable && (onEdit || onMembers) && (
        <div className={cn('absolute right-2 top-2', hoverGated)}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground sm:h-6 sm:w-6"
                title="节点操作"
                aria-label="节点操作"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[9rem]">
              {onEdit && (
                <DropdownMenuItem onSelect={() => onEdit(node)}>
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                  编辑
                </DropdownMenuItem>
              )}
              {onMembers && (
                <DropdownMenuItem onSelect={() => onMembers(node)}>
                  <Users className="h-4 w-4 text-muted-foreground" />
                  负责人 / 成员
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Bottom-center, straddling the edge: collapse pill + hover ＋ add-child. */}
      {(hasChildren || (editable && onAddChild)) && (
        <div className="absolute inset-x-0 bottom-0 flex translate-y-1/2 items-center justify-center gap-1">
          {hasChildren && (
            <button
              type="button"
              onClick={() => onToggle(node.id)}
              aria-label={isCollapsed ? '展开下级' : '收起下级'}
              aria-expanded={!isCollapsed}
              className="inline-flex h-6 items-center gap-0.5 rounded-full border border-border bg-card px-2 text-[11px] font-medium tabular-nums text-muted-foreground shadow-sm transition-[background-color,color,box-shadow] duration-base ease-standard hover:bg-accent hover:text-foreground hover:shadow-md"
            >
              {isCollapsed ? (
                <ChevronRight className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
              {descendants}
            </button>
          )}
          {editable && onAddChild && (
            <span className={hoverGated}>
              <OrgAddNodeButton
                title={`在${node.title}下新增小组`}
                variant="outline"
                size="icon"
                className="h-6 w-6 rounded-full border-border bg-card shadow-sm hover:shadow-md sm:h-6 sm:w-6"
                kind="group"
                onSelectKind={(kind) => onAddChild(node, kind)}
              />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Lead + member stack row; the whole row opens the members dialog when wired. */
function PeopleRow({
  node,
  lead,
  shown,
  overflow,
  onMembers,
}: {
  node: OrgTreeNode;
  lead: OrgNodeMember | undefined;
  shown: OrgNodeMember[];
  overflow: number;
  onMembers?: (node: OrgNode) => void;
}): JSX.Element {
  const empty = !lead && shown.length === 0;

  const content = (
    <>
      {lead ? (
        <>
          <span className="relative inline-flex shrink-0">
            <Avatar
              name={lead.displayName}
              color={lead.avatarColor}
              imageUrl={lead.hasAvatar ? avatarUrl(lead.userId) : undefined}
              size="xs"
            />
            <Crown className="absolute -right-1 -top-1.5 h-3 w-3 rotate-12 fill-amber-400 text-amber-500" />
          </span>
          <span className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-foreground">
            {lead.displayName}
          </span>
        </>
      ) : (
        <span className="min-w-0 flex-1 text-left text-[11px] text-muted-foreground">
          {empty ? '暂无成员' : ''}
        </span>
      )}
      {shown.length > 0 && (
        <span className="flex shrink-0 -space-x-1.5">
          {shown.map((person) => (
            <Avatar
              key={person.userId}
              name={person.displayName}
              color={person.avatarColor}
              imageUrl={person.hasAvatar ? avatarUrl(person.userId) : undefined}
              size="xs"
              className="ring-2 ring-card"
            />
          ))}
          {overflow > 0 && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-muted-foreground ring-2 ring-card">
              +{overflow}
            </span>
          )}
        </span>
      )}
    </>
  );

  if (!onMembers) {
    return <div className="mt-auto flex min-w-0 items-center gap-1.5">{content}</div>;
  }
  return (
    <button
      type="button"
      onClick={(event) => {
        event.currentTarget.blur();
        onMembers(node);
      }}
      title={`查看${node.title}的负责人与成员`}
      aria-label={`查看${node.title}的负责人与成员`}
      className="-mx-1 mt-auto flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors duration-base ease-standard hover:bg-accent/60"
    >
      {content}
    </button>
  );
}

/**
 * Rounded orthogonal connector: down from the parent's bottom-center, a rounded
 * turn onto the mid rank line, across, and a rounded turn down into the child's
 * top-center. Nearly-vertical edges collapse to a straight line.
 */
function edgePath(edge: Edge): string {
  const { fromX, fromY, toX, toY } = edge;
  const dx = toX - fromX;
  if (Math.abs(dx) < EDGE_RADIUS * 2) {
    return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  }
  const midY = (fromY + toY) / 2;
  const dir = dx > 0 ? 1 : -1;
  return [
    `M ${fromX} ${fromY}`,
    `L ${fromX} ${midY - EDGE_RADIUS}`,
    `Q ${fromX} ${midY} ${fromX + dir * EDGE_RADIUS} ${midY}`,
    `L ${toX - dir * EDGE_RADIUS} ${midY}`,
    `Q ${toX} ${midY} ${toX} ${midY + EDGE_RADIUS}`,
    `L ${toX} ${toY}`,
  ].join(' ');
}

/** Unit-descendant count per node id (children recursively; people don't count). */
function countDescendants(roots: OrgTreeNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  const walk = (node: OrgTreeNode): number => {
    let total = 0;
    for (const child of node.children) total += 1 + walk(child);
    counts.set(node.id, total);
    return total;
  };
  for (const root of roots) walk(root);
  return counts;
}
