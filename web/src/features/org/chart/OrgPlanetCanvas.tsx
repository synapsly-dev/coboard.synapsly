import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Crown, MoreHorizontal, Pencil, Users } from 'lucide-react';
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
import { isPositionFull, occupancyLabel } from '../labels';
import { OrgAddNodeButton } from '../OrgAddNodeButton';
import type { OrgTreeNode } from '../tree';
import {
  FOCUS_R,
  orbitLayout,
  resolveFocusPath,
  subtreePeople,
  type OrbitItem,
  type OrbitItemKind,
} from './orbit-layout';
import { useCanvas } from './useCanvas';
import { ZoomControls } from './ZoomControls';

/**
 * Org planet canvas (团队架构 星系模式) — an orbital focus+context view. State is
 * a single `focusPath` (id chain); orbit-layout.ts derives every scene from it:
 * overview (departments as planets around the 团队 core), focus (the node as a
 * local star, unit children as moons, direct members as avatar leaves, everything
 * else pushed out as ghost planets), and recursive drill-down.
 *
 * The 挤开 effect: item keys are stable, every item is an absolutely-positioned
 * element moved with `translate`, and transform/size/opacity transition over
 * 400ms — so a focus change simply GLIDES all surviving items to their new
 * orbits while the camera fitTo()s the new bounds. Items are DOM-ordered by key
 * (never reordered, which would restart transitions) and stacked with z-index.
 *
 * Same outer contract as OrgChartCanvas: {roots, editable, onAddChild, onEdit,
 * onMembers}. `modeToggle` is the 星系/树形 switch slot in the zoom cluster.
 */
interface OrgPlanetCanvasProps {
  roots: OrgTreeNode[];
  editable?: boolean;
  onAddChild?: (node: OrgNode, kind: OrgNodeKind) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
  modeToggle?: ReactNode;
}

/** Shared 400ms glide for position/size/opacity (motion-safe gated). */
const GLIDE =
  'motion-safe:transition-[transform,width,height,opacity] motion-safe:duration-[400ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]';

/** Circle fill + border per kind (hue at ~10% like the tree-mode accents). */
const KIND_CIRCLE: Record<OrgNodeKind, string> = {
  department: 'border-primary/50 bg-primary/10',
  group: 'border-sky-500/50 bg-sky-500/10',
  position: 'border-violet-500/50 bg-violet-500/10',
};

/** Kind-colored glow; the focused star gets the brighter variant. */
const KIND_GLOW: Record<OrgNodeKind, string> = {
  department: 'shadow-[0_0_20px_-2px_hsl(var(--primary)/0.35)]',
  group: 'shadow-[0_0_20px_-2px_rgba(14,165,233,0.4)]',
  position: 'shadow-[0_0_20px_-2px_rgba(139,92,246,0.4)]',
};
const KIND_GLOW_FOCUS: Record<OrgNodeKind, string> = {
  department: 'shadow-[0_0_44px_-4px_hsl(var(--primary)/0.55)]',
  group: 'shadow-[0_0_44px_-4px_rgba(14,165,233,0.6)]',
  position: 'shadow-[0_0_44px_-4px_rgba(139,92,246,0.6)]',
};

/** Stacking per kind — DOM order is key-stable, so depth comes from z-index. */
const KIND_Z: Record<OrbitItemKind, string> = {
  ring: 'z-0',
  ghost: 'z-10',
  moon: 'z-20',
  core: 'z-30',
  planet: 'z-30',
  leaf: 'z-40',
};

/** Tree-canvas hover-gating pattern: always visible on touch, hover/focus on sm+. */
const HOVER_GATED =
  'opacity-100 transition-opacity duration-base ease-standard sm:pointer-events-none sm:opacity-0 sm:group-hover/item:pointer-events-auto sm:group-hover/item:opacity-100 sm:group-focus-within/item:pointer-events-auto sm:group-focus-within/item:opacity-100';

export function OrgPlanetCanvas({
  roots,
  editable = false,
  onAddChild,
  onEdit,
  onMembers,
  modeToggle,
}: OrgPlanetCanvasProps): JSX.Element {
  const [focusPath, setFocusPath] = useState<string[]>([]);

  // Resolve the path against the CURRENT data; a stale chain (node deleted /
  // moved meanwhile) resets to the overview so state and scene stay coherent.
  const chain = useMemo(() => resolveFocusPath(roots, focusPath), [roots, focusPath]);
  const stale = focusPath.length > 0 && chain.length !== focusPath.length;
  useEffect(() => {
    if (stale) setFocusPath([]);
  }, [stale]);

  const layout = useMemo(() => orbitLayout(roots, focusPath), [roots, focusPath]);
  // Key-stable DOM order: reordering children would recreate/interrupt CSS
  // transitions mid-glide, so items are always sorted by key and layered via z.
  const items = useMemo(
    () => [...layout.items].sort((a, b) => (a.key < b.key ? -1 : 1)),
    [layout],
  );
  const focus = chain.length > 0 && !stale ? chain[chain.length - 1] : undefined;
  const focusItem = focus
    ? layout.items.find((i) => i.kind === 'planet' && i.node?.id === focus.id)
    : undefined;

  const focusPathRef = useRef(focusPath);
  focusPathRef.current = focusPath;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // In planet mode, double-click on empty canvas goes UP one level; at the
  // overview it falls back to the hook's fit. (Circles are buttons, so a
  // double-click on a node never reaches this.)
  const fitToRef = useRef<((bounds?: { width: number; height: number }) => void) | null>(null);
  const canvasOptions = useRef({
    onDoubleClick: () => {
      if (focusPathRef.current.length > 0) setFocusPath((p) => p.slice(0, -1));
      else fitToRef.current?.();
    },
  }).current;

  const { viewportRef, transform, dragging, animated, zoomIn, zoomOut, fitTo, reset } = useCanvas(
    layout.bounds,
    canvasOptions,
  );
  fitToRef.current = fitTo;

  // 运镜: every focus change re-frames the camera onto the new scene (animated).
  // Focused scenes frame coreBounds ONLY (ghost arcs stay at the viewport edges)
  // and may zoom past 100% — that's what makes the expanded view read big (可读性).
  // First mount is covered by useCanvas's own pre-paint auto-fit; data refreshes
  // that don't change the path keep the user's viewport, matching tree mode.
  const pathKey = focusPath.join('/');
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    const current = layoutRef.current;
    if (focusPathRef.current.length > 0) {
      fitTo(current.coreBounds, { maxScale: 1.35 });
    } else {
      fitTo(current.bounds);
    }
  }, [pathKey, fitTo]);

  const totalPeople = useMemo(
    () => roots.reduce((sum, root) => sum + subtreePeople(root), 0),
    [roots],
  );

  // Empty roots: OrgPage owns the empty state.
  if (roots.length === 0) return <></>;

  const pop = (): void => setFocusPath((p) => p.slice(0, -1));

  const handleNodeClick = (item: OrbitItem): void => {
    const node = item.node;
    if (!node) return;
    if (item.kind === 'ghost') {
      // Lateral switch at the ghost's own level (spatial-memory arc).
      setFocusPath((p) => [...p.slice(0, item.depth), node.id]);
    } else if (item.kind === 'moon') {
      setFocusPath((p) => [...p, node.id]);
    } else if (item.kind === 'planet') {
      if (focus && node.id === focus.id) pop();
      else setFocusPath([node.id]);
    }
  };

  return (
    <div
      ref={viewportRef}
      tabIndex={0}
      aria-label="组织架构星系图谱"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && focusPathRef.current.length > 0) {
          event.preventDefault();
          pop();
        }
      }}
      className={cn(
        'relative h-full w-full touch-none select-none overflow-hidden bg-background outline-none',
        'ring-inset ring-offset-0',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
    >
      {/* World layer — one shared pan/zoom transform; dot grid weakened to /40. */}
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
          backgroundImage:
            'radial-gradient(circle, hsl(var(--border) / 0.4) 1.5px, transparent 1.5px)',
          backgroundSize: '24px 24px',
        }}
      >
        {items.map((item) => (
          <OrbitItemView
            key={item.key}
            item={item}
            isFocus={focusItem?.key === item.key}
            focusNode={focus}
            editable={editable}
            totalPeople={totalPeople}
            onNodeClick={handleNodeClick}
            onEdit={onEdit}
            onMembers={onMembers}
          />
        ))}

        {/* Editable cluster under the focused star: 编辑 / 成员 / ＋新增子级. */}
        {editable && focus && focusItem && (
          <div
            key={`controls:${focus.id}`}
            className="absolute left-0 top-0 z-50 -translate-x-1/2 motion-safe:animate-fade-in"
            style={{ left: focusItem.x, top: focusItem.y + FOCUS_R + 12 }}
          >
            <div className="flex items-center gap-0.5 rounded-full border border-border bg-card/95 p-0.5 shadow-md backdrop-blur">
              {onEdit && (
                <Tooltip content="编辑">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-full sm:h-7 sm:w-7"
                    aria-label={`编辑${focus.title}`}
                    onClick={(event) => {
                      event.currentTarget.blur();
                      onEdit(focus);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
              )}
              {onMembers && (
                <Tooltip content="负责人 / 成员">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-full sm:h-7 sm:w-7"
                    aria-label={`管理${focus.title}的负责人与成员`}
                    onClick={(event) => {
                      event.currentTarget.blur();
                      onMembers(focus);
                    }}
                  >
                    <Users className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
              )}
              {onAddChild && (
                <OrgAddNodeButton
                  title={`在${focus.title}下新增小组`}
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 rounded-full sm:h-7 sm:w-7"
                  kind="group"
                  onSelectKind={(kind) => onAddChild(focus, kind)}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Breadcrumb (focus mode only): 团队 / … — each segment pops to its depth. */}
      {chain.length > 0 && (
        <nav
          aria-label="架构层级"
          className="absolute left-4 top-4 z-10 flex max-w-[calc(100%-2rem)] items-center gap-1 overflow-hidden rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-xs shadow-md backdrop-blur motion-safe:animate-fade-in"
        >
          <button
            type="button"
            className="shrink-0 rounded text-muted-foreground transition-colors duration-base ease-standard hover:text-foreground"
            onClick={() => setFocusPath([])}
          >
            团队
          </button>
          {chain.map((node, index) => {
            const isLast = index === chain.length - 1;
            return (
              <span key={node.id} className="flex min-w-0 items-center gap-1">
                <span className="text-muted-foreground/60" aria-hidden>
                  /
                </span>
                {isLast ? (
                  <span className="truncate font-semibold text-foreground" aria-current="page">
                    {node.title}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="truncate rounded text-muted-foreground transition-colors duration-base ease-standard hover:text-foreground"
                    onClick={() => setFocusPath(focusPath.slice(0, index + 1))}
                  >
                    {node.title}
                  </button>
                )}
              </span>
            );
          })}
        </nav>
      )}

      {/* Gesture hint — pointless on touch, so only shown for hover devices. */}
      <p className="pointer-events-none absolute bottom-4 left-4 hidden text-[11px] text-muted-foreground [@media(hover:hover)]:block">
        {chain.length > 0 ? '双击空白/Esc 返回上级 · 滚轮缩放' : '点击部门聚焦 · 滚轮缩放'}
      </p>

      <ZoomControls
        scale={transform.scale}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onFit={() => fitTo()}
        onReset={reset}
        extra={modeToggle}
      />
    </div>
  );
}

/**
 * One orbit item. The root is ALWAYS a plain positioned div (stable element type
 * per key, so kind changes — planet↔ghost, moon→focused planet — glide instead
 * of remounting); the interactive circle inside is a real <button>, which also
 * keeps useCanvas from starting pans on it.
 */
function OrbitItemView({
  item,
  isFocus,
  focusNode,
  editable,
  totalPeople,
  onNodeClick,
  onEdit,
  onMembers,
}: {
  item: OrbitItem;
  isFocus: boolean;
  focusNode: OrgTreeNode | undefined;
  editable: boolean;
  totalPeople: number;
  onNodeClick: (item: OrbitItem) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
}): JSX.Element {
  const size = item.r * 2;
  return (
    <div
      className={cn('group/item absolute left-0 top-0', KIND_Z[item.kind], GLIDE)}
      style={{
        width: size,
        height: size,
        transform: `translate(${item.x - item.r}px, ${item.y - item.r}px)`,
      }}
    >
      <OrbitItemBody
        item={item}
        isFocus={isFocus}
        focusNode={focusNode}
        editable={editable}
        totalPeople={totalPeople}
        onNodeClick={onNodeClick}
        onEdit={onEdit}
        onMembers={onMembers}
      />
    </div>
  );
}

function OrbitItemBody({
  item,
  isFocus,
  focusNode,
  editable,
  totalPeople,
  onNodeClick,
  onEdit,
  onMembers,
}: {
  item: OrbitItem;
  isFocus: boolean;
  focusNode: OrgTreeNode | undefined;
  editable: boolean;
  totalPeople: number;
  onNodeClick: (item: OrbitItem) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
}): JSX.Element {
  // Orbit ring: a dashed, non-interactive circle.
  if (item.kind === 'ring') {
    return (
      <div
        className="pointer-events-none h-full w-full rounded-full border border-dashed border-border/40 motion-safe:animate-fade-in"
        aria-hidden
      />
    );
  }

  // 团队 core (恒星).
  if (item.kind === 'core') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-full border border-border bg-card shadow-[0_0_36px_-6px_hsl(var(--primary)/0.35)] motion-safe:animate-fade-in">
        <span className="text-sm font-semibold text-foreground">团队</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">{totalPeople} 人</span>
      </div>
    );
  }

  // Member leaf: avatar + name below; 负责人 get the amber ring + crown.
  if (item.kind === 'leaf' && item.member) {
    return (
      <LeafBody
        member={item.member}
        isLead={item.isLead === true}
        focusNode={focusNode}
        onMembers={onMembers}
      />
    );
  }

  const node = item.node;
  if (!node) return <></>;

  // Ghost planet: small, grayscale, translucent; hover restores color.
  if (item.kind === 'ghost') {
    return (
      <>
        <Tooltip content={node.title}>
          <button
            type="button"
            aria-label={`聚焦${node.title}`}
            onClick={() => onNodeClick(item)}
            className={cn(
              'absolute inset-0 flex items-center justify-center rounded-full border opacity-60 grayscale',
              'transition-[opacity,filter,box-shadow] duration-base ease-standard hover:opacity-100 hover:grayscale-0 hover:shadow-md',
              'motion-safe:animate-fade-in',
              KIND_CIRCLE[node.kind],
            )}
          >
            <span className="text-[9px] font-medium leading-none text-foreground">
              {node.title.slice(0, 2)}
            </span>
          </button>
        </Tooltip>
        <span className="pointer-events-none absolute left-1/2 top-full mt-0.5 -translate-x-1/2 text-[9px] tabular-nums text-muted-foreground">
          {subtreePeople(node)}
        </span>
      </>
    );
  }

  // Planet (overview root or the focused star) / moon.
  const people = subtreePeople(node);
  const full = node.kind === 'position' && isPositionFull(node);
  return (
    <>
      <button
        type="button"
        aria-label={isFocus ? `返回上级（当前 ${node.title}）` : `聚焦${node.title}`}
        title={node.title}
        onClick={() => onNodeClick(item)}
        className={cn(
          'absolute inset-0 flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-full border px-1',
          'transition-[background-color,border-color,box-shadow,filter] duration-base ease-standard hover:brightness-105',
          'motion-safe:animate-fade-in',
          KIND_CIRCLE[node.kind],
          isFocus ? KIND_GLOW_FOCUS[node.kind] : KIND_GLOW[node.kind],
        )}
      >
        <span
          className={cn(
            'max-w-full truncate font-semibold leading-tight text-foreground',
            // Focused scenes are framed tight (coreBounds) so type can be generous.
            isFocus ? 'text-base' : item.kind === 'moon' ? 'text-sm' : 'text-xs',
          )}
        >
          {node.title}
        </span>
        {node.kind === 'position' ? (
          <span
            className={cn(
              'max-w-full truncate rounded-full px-1.5 py-px font-medium leading-tight ring-1 ring-inset',
              item.kind === 'moon' ? 'text-[10px]' : 'text-[9px]',
              full
                ? 'bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300'
                : 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-400',
            )}
          >
            {occupancyLabel(node)}
          </span>
        ) : (
          <span
            className={cn(
              'leading-none tabular-nums text-muted-foreground',
              isFocus || item.kind === 'moon' ? 'text-[11px]' : 'text-[10px]',
            )}
          >
            {people} 人
          </span>
        )}
      </button>

      {/* ⋯ menu on non-focused planets/moons (hover on sm+, always on touch). */}
      {editable && !isFocus && (onEdit || onMembers) && (
        <div className={cn('absolute -right-1 -top-1 z-10', HOVER_GATED)}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 rounded-full border border-border bg-card shadow-sm sm:h-6 sm:w-6"
                title="节点操作"
                aria-label={`${node.title}的操作`}
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
    </>
  );
}

/** Avatar leaf: click opens the members dialog of the owning (focused) unit. */
function LeafBody({
  member,
  isLead,
  focusNode,
  onMembers,
}: {
  member: OrgNodeMember;
  isLead: boolean;
  focusNode: OrgTreeNode | undefined;
  onMembers?: (node: OrgNode) => void;
}): JSX.Element {
  const avatar = (
    <span
      className={cn(
        'relative inline-flex rounded-full',
        isLead && 'ring-2 ring-amber-400 ring-offset-2 ring-offset-background',
      )}
    >
      <Avatar
        name={member.displayName}
        color={member.avatarColor}
        imageUrl={member.hasAvatar ? avatarUrl(member.userId) : undefined}
        size="sm"
        className="h-11 w-11 text-sm"
      />
      {isLead && (
        <Crown className="absolute -right-1.5 -top-2 h-4 w-4 rotate-12 fill-amber-400 text-amber-500" />
      )}
    </span>
  );

  return (
    <>
      {onMembers && focusNode ? (
        <button
          type="button"
          aria-label={`查看${focusNode.title}的负责人与成员`}
          onClick={(event) => {
            event.currentTarget.blur();
            onMembers(focusNode);
          }}
          className="absolute inset-0 rounded-full outline-none transition-transform duration-base ease-standard hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-fade-in"
        >
          {avatar}
        </button>
      ) : (
        <span className="absolute inset-0 motion-safe:animate-fade-in">{avatar}</span>
      )}
      <span className="pointer-events-none absolute left-1/2 top-full mt-1 w-24 -translate-x-1/2 truncate text-center text-xs leading-tight text-foreground">
        {member.displayName}
      </span>
    </>
  );
}
