import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronRight, Crown, MoreHorizontal, Pencil, Users } from 'lucide-react';
import type { OrgNode, OrgNodeKind, OrgNodeMember } from 'shared';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui';
import { avatarUrl, cn } from '../../lib/utils';
import { ORG_KIND_BADGE, ORG_KIND_LABELS } from './labels';
import { OrgAddNodeButton } from './OrgAddNodeButton';
import type { OrgTreeNode } from './tree';

/**
 * Org chart (团队架构 图谱视图). The viewport behaves like a draggable
 * canvas: wheel/trackpad scrolling still works, and pointer-drag pans the whole
 * diagram. Unit cards show one负责人; ordinary members are rendered as connected
 * person leaf nodes underneath the unit.
 */
interface OrgChartProps {
  roots: OrgTreeNode[];
  editable?: boolean;
  onAddRoot?: (kind: OrgNodeKind) => void;
  onAddChild?: (node: OrgNode, kind: OrgNodeKind) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
}

export function OrgChart({
  roots,
  editable = false,
  onAddRoot,
  onAddChild,
  onEdit,
  onMembers,
}: OrgChartProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const toggle = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const frame = window.requestAnimationFrame(() => {
      viewport.scrollLeft = Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2);
      viewport.scrollTop = 0;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [roots]);

  const startPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;

    const viewport = viewportRef.current;
    if (!viewport) return;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const pan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.x);
    viewport.scrollTop = drag.scrollTop - (event.clientY - drag.y);
  };

  const stopPan = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (viewport?.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div
      ref={viewportRef}
      className={cn(
        'h-full w-full overflow-auto overscroll-contain px-4 pb-6 pt-2 scrollbar-thin',
        'select-none touch-none',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
      onPointerDown={startPan}
      onPointerMove={pan}
      onPointerUp={stopPan}
      onPointerCancel={stopPan}
    >
      <div className="org-tree inline-block min-h-full min-w-full px-10 py-8">
        {editable && onAddRoot && (
          <div className="mb-5 flex justify-center">
            <OrgAddNodeButton
              label="新建根节点"
              variant="outline"
              onSelectKind={onAddRoot}
              align="center"
            />
          </div>
        )}
        <ul>
          {roots.map((root) => (
            <ChartNode
              key={root.id}
              node={root}
              collapsed={collapsed}
              editable={editable}
              onToggle={toggle}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onMembers={onMembers}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ChartNode({
  node,
  collapsed,
  editable,
  onToggle,
  onAddChild,
  onEdit,
  onMembers,
}: {
  node: OrgTreeNode;
  collapsed: Set<string>;
  editable: boolean;
  onToggle: (id: string) => void;
  onAddChild?: (node: OrgNode, kind: OrgNodeKind) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
}): JSX.Element {
  const people = peopleChildren(node);
  const childCount = node.children.length + people.length;
  const hasChildren = childCount > 0;
  const isCollapsed = collapsed.has(node.id);

  return (
    <li>
      <div className="group/chart-node inline-flex flex-col items-center">
        <NodeCard node={node} editable={editable} onEdit={onEdit} onMembers={onMembers} />
        {(editable || hasChildren) && (
          <div className="mt-1.5 inline-flex min-h-7 items-center gap-1">
            {editable && onAddChild && (
              <OrgAddNodeButton
                title={`在${node.title}下新增`}
                variant="outline"
                size="icon"
                align="center"
                className="h-7 w-7 border-border bg-card shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-base ease-standard hover:-translate-y-0.5 hover:shadow-md"
                onSelectKind={(kind) => onAddChild(node, kind)}
              />
            )}
            {hasChildren && (
              <button
                type="button"
                onClick={() => onToggle(node.id)}
                className="inline-flex h-7 items-center gap-0.5 rounded-full border border-border bg-card px-2 text-[11px] text-muted-foreground shadow-sm transition-[background-color,color,box-shadow,transform] duration-base ease-standard hover:-translate-y-0.5 hover:bg-accent hover:text-foreground hover:shadow-md"
                aria-label={isCollapsed ? '展开下级' : '收起下级'}
              >
                {isCollapsed ? (
                  <>
                    <ChevronRight className="h-3 w-3" />
                    {childCount}
                  </>
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {hasChildren && !isCollapsed && (
        <ul>
          {node.children.map((child) => (
            <ChartNode
              key={child.id}
              node={child}
              collapsed={collapsed}
              editable={editable}
              onToggle={onToggle}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onMembers={onMembers}
            />
          ))}
          {people.map((person) => (
            <PersonNode key={person.userId} person={person} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A single unit card — kind badge, title, and the one负责人. */
function NodeCard({
  node,
  editable,
  onEdit,
  onMembers,
}: {
  node: OrgTreeNode;
  editable: boolean;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
}): JSX.Element {
  const lead = node.leads[0];
  return (
    <div className="group/card relative inline-flex min-w-[9rem] max-w-[15rem] flex-col items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-center shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-base ease-standard hover:-translate-y-1 hover:border-border/80 hover:shadow-md">
      {editable && (onEdit || onMembers) && (
        <div className="absolute -right-2 -top-2 opacity-100 transition-[opacity,transform] duration-base ease-standard sm:translate-y-1 sm:opacity-0 sm:group-hover/card:translate-y-0 sm:group-hover/card:opacity-100 sm:group-focus-within/card:translate-y-0 sm:group-focus-within/card:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 rounded-full bg-card shadow-sm"
                title="节点操作"
                aria-label="节点操作"
              >
                <MoreHorizontal className="h-4 w-4" />
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
      <span
        className={cn(
          'rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none',
          ORG_KIND_BADGE[node.kind],
        )}
      >
        {ORG_KIND_LABELS[node.kind]}
      </span>
      <span className="text-sm font-semibold leading-snug text-foreground">{node.title}</span>

      {lead && (
        <span className="mt-0.5 inline-flex max-w-full items-center gap-1.5">
          <PersonAvatar person={lead} lead />
          <span className="truncate text-[11px] font-medium text-foreground">
            {lead.displayName}
          </span>
        </span>
      )}
    </div>
  );
}

function PersonNode({ person }: { person: OrgNodeMember }): JSX.Element {
  return (
    <li>
      <div className="inline-flex min-w-[7.5rem] max-w-[12rem] items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-left shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-base ease-standard hover:-translate-y-0.5 hover:shadow-md">
        <PersonAvatar person={person} />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{person.displayName}</p>
          <p className="text-[11px] text-muted-foreground">成员</p>
        </div>
      </div>
    </li>
  );
}

function PersonAvatar({
  person,
  lead = false,
}: {
  person: OrgNodeMember;
  lead?: boolean;
}): JSX.Element {
  return (
    <span className="relative inline-flex">
      <Avatar
        name={person.displayName}
        color={person.avatarColor}
        imageUrl={person.hasAvatar ? avatarUrl(person.userId) : undefined}
        size="xs"
      />
      {lead && (
        <Crown className="absolute -right-1 -top-1.5 h-3 w-3 rotate-12 fill-amber-400 text-amber-500" />
      )}
    </span>
  );
}

function peopleChildren(node: OrgTreeNode): OrgNodeMember[] {
  return [...node.leads.slice(1), ...node.members];
}

function isInteractiveTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement && target.closest('button, a, input, textarea, select') !== null
  );
}
