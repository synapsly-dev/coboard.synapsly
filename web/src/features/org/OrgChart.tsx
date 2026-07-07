import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, ChevronRight, Crown } from 'lucide-react';
import type { OrgNodeMember } from 'shared';
import { Avatar } from '../../components/ui';
import { avatarUrl, cn } from '../../lib/utils';
import { ORG_KIND_BADGE, ORG_KIND_LABELS } from './labels';
import type { OrgTreeNode } from './tree';

/**
 * Read-only org chart (团队架构 图谱视图). The viewport behaves like a draggable
 * canvas: wheel/trackpad scrolling still works, and pointer-drag pans the whole
 * diagram. Unit cards show one负责人; ordinary members are rendered as connected
 * person leaf nodes underneath the unit.
 */
export function OrgChart({ roots }: { roots: OrgTreeNode[] }): JSX.Element {
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
        <ul>
          {roots.map((root) => (
            <ChartNode key={root.id} node={root} collapsed={collapsed} onToggle={toggle} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ChartNode({
  node,
  collapsed,
  onToggle,
}: {
  node: OrgTreeNode;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
}): JSX.Element {
  const people = peopleChildren(node);
  const childCount = node.children.length + people.length;
  const hasChildren = childCount > 0;
  const isCollapsed = collapsed.has(node.id);

  return (
    <li>
      <div className="inline-flex flex-col items-center">
        <NodeCard node={node} />
        {hasChildren && (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            className="mt-1.5 inline-flex items-center gap-0.5 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
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

      {hasChildren && !isCollapsed && (
        <ul>
          {node.children.map((child) => (
            <ChartNode key={child.id} node={child} collapsed={collapsed} onToggle={onToggle} />
          ))}
          {people.map((person) => (
            <PersonNode key={person.userId} person={person} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A single unit card — kind badge, title, and the one负责人. Purely presentational. */
function NodeCard({ node }: { node: OrgTreeNode }): JSX.Element {
  const lead = node.leads[0];
  return (
    <div className="inline-flex min-w-[9rem] max-w-[15rem] flex-col items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-center shadow-sm">
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
      <div className="inline-flex min-w-[7.5rem] max-w-[12rem] items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2 text-left shadow-sm">
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
