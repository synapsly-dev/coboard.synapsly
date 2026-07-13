import { useMemo, useState } from 'react';
import {
  BriefcaseBusiness,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  UserPlus,
  Users,
} from 'lucide-react';
import type { OrgNode, OrgNodeKind } from 'shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui';
import { cn } from '../../../lib/utils';
import { PeopleHoverCard } from '../ExpandablePeople';
import { ORG_KIND_LABELS } from '../labels';
import { OrgAddNodeButton } from '../OrgAddNodeButton';
import { NodeMembershipAction } from '../NodeMembershipAction';
import type { OrgTreeNode } from '../tree';
import { buildOrgRoleIndex, peopleOnNode, type OrgRoleIndex } from './org-role-selectors';
import {
  BRANCH_CARD_H,
  layoutRoleChart,
  POSITION_CARD_H,
  ROLE_CARD_W,
  type RoleEdgeLayout,
} from './role-layout';
import { useCanvas } from './useCanvas';
import { ZoomControls } from './ZoomControls';

interface OrgRoleChartCanvasProps {
  roots: OrgTreeNode[];
  editable?: boolean;
  onAddChild?: (node: OrgNode, kind: OrgNodeKind) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
  onAddMembers?: (node: OrgNode) => void;
  canManageMembers?: (node: OrgNode) => boolean;
}

const EDGE_RADIUS = 8;
const MAX_AVATARS = 3;
const BRANCH_ACCENTS = [
  'bg-primary/70',
  'bg-sky-500/65 dark:bg-sky-400/65',
  'bg-violet-500/65 dark:bg-violet-400/65',
  'bg-amber-500/65 dark:bg-amber-400/65',
  'bg-emerald-500/65 dark:bg-emerald-400/65',
  'bg-rose-500/65 dark:bg-rose-400/65',
] as const;

function stableAccent(id: string): string {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) | 0;
  }
  return BRANCH_ACCENTS[Math.abs(hash) % BRANCH_ACCENTS.length]!;
}

export function OrgRoleChartCanvas({
  roots,
  editable = false,
  onAddChild,
  onEdit,
  onMembers,
  onAddMembers,
  canManageMembers,
}: OrgRoleChartCanvasProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (id: string): void =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const index = useMemo(() => buildOrgRoleIndex(roots), [roots]);
  const layout = useMemo(() => layoutRoleChart(roots, collapsed), [roots, collapsed]);
  const { viewportRef, transform, dragging, animated, zoomIn, zoomOut, fitTo, reset } = useCanvas(
    layout.bounds,
    { pixelSnapStep: 0.25 },
  );

  return (
    <div className="relative h-full w-full">
      <div className="h-full overflow-y-auto bg-background px-4 pb-8 pt-4 md:hidden">
        <div className="mb-3 flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5">
          <p className="font-semibold">团队</p>
          <span className="text-sm tabular-nums text-muted-foreground">
            {index.totalMemberCount} 人
          </span>
        </div>
        <div className="space-y-2">
          {roots.map((node) => (
            <MobileNode
              key={node.id}
              node={node}
              index={index}
              editable={editable}
              collapsed={collapsed}
              onToggle={toggleCollapsed}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onMembers={onMembers}
              onAddMembers={onAddMembers}
              canManageMembers={canManageMembers}
            />
          ))}
        </div>
      </div>

      <div
        ref={viewportRef}
        tabIndex={0}
        aria-label="岗位组织图"
        className={cn(
          'relative hidden h-full w-full touch-none select-none overflow-hidden bg-background outline-none md:block',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <div
          className={cn(
            'absolute left-0 top-0 origin-top-left will-change-transform',
            animated &&
              'motion-safe:transition-transform motion-safe:duration-base motion-safe:ease-standard',
          )}
          style={{
            width: layout.bounds.width,
            height: layout.bounds.height,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          <svg
            className="absolute left-0 top-0"
            width={layout.bounds.width}
            height={layout.bounds.height}
            aria-hidden="true"
          >
            {layout.edges.map((edge) => (
              <path
                key={edge.key}
                d={edgePath(edge)}
                className="stroke-border"
                strokeWidth={1.5}
                strokeLinecap="round"
                fill="none"
              />
            ))}
          </svg>

          {layout.team && (
            <div
              data-org-card
              className="absolute flex items-center justify-between rounded-xl border border-border bg-card px-4"
              style={{
                left: layout.team.x,
                top: layout.team.y,
                width: layout.team.width,
                height: layout.team.height,
              }}
            >
              <p className="text-base font-semibold">团队</p>
              <span className="text-sm tabular-nums text-muted-foreground">
                {index.totalMemberCount} 人
              </span>
            </div>
          )}

          {layout.branches.map(({ node, x, y }) => (
            <BranchCard
              key={node.id}
              node={node}
              x={x}
              y={y}
              index={index}
              editable={editable}
              collapsed={collapsed.has(node.id)}
              onToggle={toggleCollapsed}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onMembers={onMembers}
              onAddMembers={onAddMembers}
              canManageMembers={canManageMembers}
            />
          ))}

          {layout.positions.map(({ node, x, y }) => (
            <PositionCard
              key={node.id}
              node={node}
              x={x}
              y={y}
              index={index}
              editable={editable}
              onEdit={onEdit}
              onMembers={onMembers}
              onAddMembers={onAddMembers}
              canManageMembers={canManageMembers}
            />
          ))}
        </div>

        <p className="pointer-events-none absolute bottom-4 left-4 hidden text-[11px] text-muted-foreground [@media(hover:hover)]:block">
          拖拽/双指滑动平移 · 捏合或 Ctrl+滚轮缩放
        </p>
        <ZoomControls
          scale={transform.scale}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFit={() => fitTo()}
          onReset={reset}
        />
      </div>
    </div>
  );
}

function BranchCard({
  node,
  x,
  y,
  index,
  editable,
  collapsed,
  onToggle,
  onAddChild,
  onEdit,
  onMembers,
  onAddMembers,
  canManageMembers,
}: {
  node: OrgTreeNode;
  x: number;
  y: number;
  index: OrgRoleIndex;
  editable: boolean;
  collapsed: boolean;
  onToggle: (id: string) => void;
  onAddChild?: (node: OrgNode, kind: OrgNodeKind) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
  onAddMembers?: (node: OrgNode) => void;
  canManageMembers?: (node: OrgNode) => boolean;
}): JSX.Element {
  const people = peopleOnNode(node);
  const subtreePeople = index.subtreePeopleByNode.get(node.id) ?? people;
  const hasChildren = node.children.length > 0;
  const canManageThis = canManageMembers?.(node) ?? true;
  const nodeOnMembers = onMembers && canManageThis ? onMembers : undefined;
  const nodeOnAddMembers = onAddMembers && canManageThis ? onAddMembers : undefined;

  return (
    <div
      data-org-card
      className="group/card absolute rounded-xl border border-border bg-muted/40 transition-[box-shadow,transform] duration-base ease-standard hover:z-20 hover:-translate-y-px hover:shadow-sm"
      style={{ left: x, top: y, width: ROLE_CARD_W, height: BRANCH_CARD_H }}
    >
      <div
        className={cn('absolute inset-x-0 top-0 h-0.5 rounded-t-xl', stableAccent(node.id))}
        aria-hidden
      />
      <div className="flex h-full flex-col justify-center gap-1 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2 pr-14">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', stableAccent(node.id))} />
          <span className="truncate text-sm font-semibold" title={node.title}>
            {node.title}
          </span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
            {index.subtreeMemberCounts.get(node.id) ?? 0} 人
          </span>
        </div>
        <div className="flex min-h-6 items-center gap-1.5 pr-12 text-[11px] text-muted-foreground">
          <span>{ORG_KIND_LABELS[node.kind]}</span>
          {subtreePeople.length > 0 ? (
            <PeopleHoverCard people={subtreePeople} max={MAX_AVATARS} />
          ) : null}
          <NodeMembershipAction node={node} compact canManage={canManageThis} className="ml-auto" />
        </div>
      </div>

      <div className="absolute right-2 top-2 flex items-center gap-0.5">
        {hasChildren && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 sm:h-6 sm:w-6"
            aria-label={collapsed ? `展开${node.title}` : `收起${node.title}`}
            aria-expanded={!collapsed}
            onClick={() => onToggle(node.id)}
          >
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
        {(editable || nodeOnMembers || nodeOnAddMembers) && (
          <NodeActions
            node={node}
            onEdit={editable ? onEdit : undefined}
            onMembers={nodeOnMembers}
            onAddMembers={nodeOnAddMembers}
          />
        )}
      </div>

      {editable && onAddChild && (
        <div className="absolute bottom-0 right-2 translate-y-1/2 opacity-100 transition-opacity sm:pointer-events-none sm:opacity-0 sm:group-hover/card:pointer-events-auto sm:group-hover/card:opacity-100 sm:group-focus-within/card:pointer-events-auto sm:group-focus-within/card:opacity-100">
          <OrgAddNodeButton
            title={`在${node.title}下新增`}
            variant="outline"
            size="icon"
            className="h-6 w-6 rounded-full bg-card shadow-sm sm:h-6 sm:w-6"
            kind="group"
            onSelectKind={(kind) => onAddChild(node, kind)}
          />
        </div>
      )}
    </div>
  );
}

function PositionCard({
  node,
  x,
  y,
  index,
  editable,
  onEdit,
  onMembers,
  onAddMembers,
  canManageMembers,
}: {
  node: OrgTreeNode;
  x: number;
  y: number;
  index: OrgRoleIndex;
  editable: boolean;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
  onAddMembers?: (node: OrgNode) => void;
  canManageMembers?: (node: OrgNode) => boolean;
}): JSX.Element {
  const canManageThis = canManageMembers?.(node) ?? true;
  const nodeOnMembers = onMembers && canManageThis ? onMembers : undefined;
  const nodeOnAddMembers = onAddMembers && canManageThis ? onAddMembers : undefined;
  return (
    <div
      data-org-card
      className="group/card absolute rounded-xl border border-border bg-card transition-[border-color,box-shadow,transform] duration-base ease-standard hover:z-20 hover:-translate-y-px hover:border-foreground/20 hover:shadow-sm"
      style={{ left: x, top: y, width: ROLE_CARD_W, height: POSITION_CARD_H }}
    >
      <PositionContent node={node} index={index} onMembers={nodeOnMembers} />
      <div className="absolute bottom-2 right-2">
        <NodeMembershipAction node={node} compact canManage={canManageThis} />
      </div>
      {(editable || nodeOnMembers || nodeOnAddMembers) && (
        <div className="absolute right-2 top-2">
          <NodeActions
            node={node}
            onEdit={editable ? onEdit : undefined}
            onMembers={nodeOnMembers}
            onAddMembers={nodeOnAddMembers}
          />
        </div>
      )}
    </div>
  );
}

function PositionContent({
  node,
  index,
  onMembers,
}: {
  node: OrgTreeNode;
  index: OrgRoleIndex;
  onMembers?: (node: OrgNode) => void;
}): JSX.Element {
  const people = peopleOnNode(node);
  const vacancy = index.vacanciesByPosition.get(node.id);
  const occupancy =
    node.headcount == null ? `${people.length}/∞` : `${people.length}/${node.headcount}`;
  const hasConcurrentRole = people.some(
    (person) => (index.positionIdsByUser.get(person.userId)?.length ?? 0) > 1,
  );

  const peopleRow = (
    <>
      {people.length > 0 ? (
        <PeopleHoverCard people={people} max={MAX_AVATARS} />
      ) : (
        <span className="min-w-0 flex-1 text-left text-xs text-muted-foreground">暂未任职</span>
      )}
      {people.length > 0 && <span className="min-w-0 flex-1" />}
      {hasConcurrentRole && (
        <span
          className="shrink-0 rounded border border-border px-1 py-0.5 text-[10px] text-muted-foreground"
          title="包含兼任成员"
        >
          兼任
        </span>
      )}
    </>
  );

  return (
    <div className="flex h-full flex-col gap-2 px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2 pr-7">
        <BriefcaseBusiness className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-semibold" title={node.title}>
          {node.title}
        </span>
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          {occupancy}
        </span>
      </div>
      {onMembers ? (
        <button
          type="button"
          onClick={() => onMembers(node)}
          className="-mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-accent/60"
          aria-label={`查看${node.title}任职成员`}
        >
          {peopleRow}
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-2">{peopleRow}</div>
      )}
      <div className="mt-auto text-[11px] text-muted-foreground">
        {vacancy != null && vacancy > 0 ? (
          <span className="inline-flex rounded-md border border-dashed border-border px-1.5 py-0.5">
            空缺 {vacancy} 人
          </span>
        ) : vacancy === 0 ? (
          <span>名额已满</span>
        ) : (
          <span>名额不限</span>
        )}
      </div>
    </div>
  );
}

function NodeActions({
  node,
  onEdit,
  onMembers,
  onAddMembers,
}: {
  node: OrgTreeNode;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
  onAddMembers?: (node: OrgNode) => void;
}): JSX.Element | null {
  if (!onEdit && !onMembers && !onAddMembers) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground sm:h-6 sm:w-6"
          aria-label={`${node.title}操作`}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onAddMembers && (
          <DropdownMenuItem onSelect={() => onAddMembers(node)}>
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            加入成员
          </DropdownMenuItem>
        )}
        {onEdit && node.trackId === null && (
          <DropdownMenuItem onSelect={() => onEdit(node)}>
            <Pencil className="h-4 w-4 text-muted-foreground" />
            编辑
          </DropdownMenuItem>
        )}
        {onMembers && (
          <DropdownMenuItem onSelect={() => onMembers(node)}>
            <Users className="h-4 w-4 text-muted-foreground" />
            {node.trackId ? '赛道经理 / 成员' : '负责人 / 成员'}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileNode({
  node,
  index,
  editable,
  collapsed,
  onToggle,
  onAddChild,
  onEdit,
  onMembers,
  onAddMembers,
  canManageMembers,
}: {
  node: OrgTreeNode;
  index: OrgRoleIndex;
  editable: boolean;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onAddChild?: (node: OrgNode, kind: OrgNodeKind) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
  onAddMembers?: (node: OrgNode) => void;
  canManageMembers?: (node: OrgNode) => boolean;
}): JSX.Element {
  const canManageThis = canManageMembers?.(node) ?? true;
  const nodeOnMembers = onMembers && canManageThis ? onMembers : undefined;
  const nodeOnAddMembers = onAddMembers && canManageThis ? onAddMembers : undefined;
  if (node.kind === 'position') {
    return (
      <div className="relative min-h-[6.5rem] rounded-xl border border-border bg-card">
        <PositionContent node={node} index={index} onMembers={nodeOnMembers} />
        <div className="px-3.5 pb-2">
          <NodeMembershipAction node={node} canManage={canManageThis} />
        </div>
        {(editable || nodeOnMembers || nodeOnAddMembers) && (
          <div className="absolute right-2 top-2">
            <NodeActions
              node={node}
              onEdit={editable ? onEdit : undefined}
              onMembers={nodeOnMembers}
              onAddMembers={nodeOnAddMembers}
            />
          </div>
        )}
      </div>
    );
  }

  const isCollapsed = collapsed.has(node.id);
  const people = peopleOnNode(node);
  const subtreePeople = index.subtreePeopleByNode.get(node.id) ?? people;
  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border border-border bg-muted/40 px-3 py-2.5">
        <div
          className={cn('absolute inset-y-0 left-0 w-0.5 rounded-l-xl', stableAccent(node.id))}
          aria-hidden
        />
        <div className="flex items-center gap-2 pr-14">
          <span className="truncate text-sm font-semibold">{node.title}</span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {index.subtreeMemberCounts.get(node.id) ?? 0} 人
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {ORG_KIND_LABELS[node.kind]}
          {people.length > 0 ? ` · 直属 ${people.length} 人` : ''}
        </p>
        {subtreePeople.length > 0 && (
          <div className="mt-2">
            <PeopleHoverCard people={subtreePeople} max={5} />
          </div>
        )}
        <div className="mt-2">
          <NodeMembershipAction node={node} canManage={canManageThis} />
        </div>
        <div className="absolute right-2 top-2 flex items-center gap-0.5">
          {node.children.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 sm:h-6 sm:w-6"
              aria-label={isCollapsed ? `展开${node.title}` : `收起${node.title}`}
              aria-expanded={!isCollapsed}
              onClick={() => onToggle(node.id)}
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          {(editable || nodeOnMembers || nodeOnAddMembers) && (
            <NodeActions
              node={node}
              onEdit={editable ? onEdit : undefined}
              onMembers={nodeOnMembers}
              onAddMembers={nodeOnAddMembers}
            />
          )}
        </div>
        {editable && onAddChild && (
          <div className="mt-2">
            <OrgAddNodeButton
              title={`在${node.title}下新增`}
              variant="outline"
              size="sm"
              className="h-7"
              kind="group"
              onSelectKind={(kind) => onAddChild(node, kind)}
            />
          </div>
        )}
      </div>
      {!isCollapsed && node.children.length > 0 && (
        <div className="ml-3 space-y-2 border-l border-border pl-3">
          {node.children.map((child) => (
            <MobileNode
              key={child.id}
              node={child}
              index={index}
              editable={editable}
              collapsed={collapsed}
              onToggle={onToggle}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onMembers={onMembers}
              onAddMembers={onAddMembers}
              canManageMembers={canManageMembers}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function edgePath(edge: RoleEdgeLayout): string {
  const { fromX, fromY, toX, toY } = edge;
  const dx = toX - fromX;
  if (Math.abs(dx) < EDGE_RADIUS * 2) return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  const midY = (fromY + toY) / 2;
  const direction = dx > 0 ? 1 : -1;
  return [
    `M ${fromX} ${fromY}`,
    `L ${fromX} ${midY - EDGE_RADIUS}`,
    `Q ${fromX} ${midY} ${fromX + direction * EDGE_RADIUS} ${midY}`,
    `L ${toX - direction * EDGE_RADIUS} ${midY}`,
    `Q ${toX} ${midY} ${toX} ${midY + EDGE_RADIUS}`,
    `L ${toX} ${toY}`,
  ].join(' ');
}
