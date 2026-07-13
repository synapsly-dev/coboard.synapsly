import { useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Crown,
  MoreHorizontal,
  Pencil,
  Plus,
  UserPlus,
  Users,
} from 'lucide-react';
import type { OrgNode, OrgNodeKind } from 'shared';
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
import { InlineExpandablePeople } from '../ExpandablePeople';
import { occupancyLabel, ORG_KIND_ACCENT, ORG_KIND_BADGE, ORG_KIND_LABELS } from '../labels';
import { NodeMembershipAction } from '../NodeMembershipAction';
import type { OrgTreeNode } from '../tree';

/**
 * 树形 mode, rebuilt as a horizontal indented OUTLINE (2026-07-13). The previous
 * pan/zoom tidy-tree of fixed 224×112 cards grew unreadably tall AND wide; an
 * outline reads top-to-bottom like a file tree, stays compact, and scales to deep
 * orgs. Each row: connector guides · collapse chevron · kind badge · title ·
 * 负责人(✦) + 成员 avatars · headcount · the shared membership affordance · admin
 * controls. Collapse state is local; structure edits (新增子级 / 编辑 / 负责人·成员)
 * live in the row's ⋯ menu, matching the other chart views.
 */
interface OrgOutlineTreeProps {
  roots: OrgTreeNode[];
  editable?: boolean;
  onAddChild?: (node: OrgNode, kind: OrgNodeKind) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
  onAddMembers?: (node: OrgNode) => void;
  canManageMembers?: (node: OrgNode) => boolean;
  /** 星系/树形 switch, mounted top-right (mirrors the canvas ZoomControls slot). */
  modeToggle?: ReactNode;
}

interface OutlineRow {
  node: OrgTreeNode;
  depth: number;
  /** One flag per column 0..depth-1: does the ancestor in that lane continue? */
  ancestorLines: boolean[];
  isLast: boolean;
}

/** Pre-order flatten honoring collapse, carrying the connector-guide flags. */
function flattenOutline(roots: OrgTreeNode[], collapsed: Set<string>): OutlineRow[] {
  const out: OutlineRow[] = [];
  const walk = (nodes: OrgTreeNode[], ancestorLines: boolean[]): void => {
    nodes.forEach((node, i) => {
      const isLast = i === nodes.length - 1;
      out.push({ node, depth: ancestorLines.length, ancestorLines, isLast });
      if (node.children.length > 0 && !collapsed.has(node.id)) {
        walk(node.children, [...ancestorLines, !isLast]);
      }
    });
  };
  walk(roots, []);
  return out;
}

/** One connector-guide column: a continuation line, an elbow, or blank. */
function GuideCell({ variant }: { variant: 'blank' | 'line' | 'tee' | 'end' }): JSX.Element {
  return (
    <span className="relative block w-4 shrink-0 self-stretch" aria-hidden>
      {variant !== 'blank' && (
        <span
          className={cn(
            'absolute left-1/2 w-px -translate-x-1/2 bg-border',
            variant === 'end' ? 'top-0 h-1/2' : 'inset-y-0',
          )}
        />
      )}
      {(variant === 'tee' || variant === 'end') && (
        <span className="absolute left-1/2 top-1/2 h-px w-1/2 -translate-y-1/2 bg-border" />
      )}
    </span>
  );
}

export function OrgOutlineTree({
  roots,
  editable = false,
  onAddChild,
  onEdit,
  onMembers,
  onAddMembers,
  canManageMembers,
  modeToggle,
}: OrgOutlineTreeProps): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => flattenOutline(roots, collapsed), [roots, collapsed]);

  const toggle = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allBranchIds = useMemo(() => {
    const ids: string[] = [];
    const walk = (nodes: OrgTreeNode[]): void => {
      for (const n of nodes) {
        if (n.children.length > 0) {
          ids.push(n.id);
          walk(n.children);
        }
      }
    };
    walk(roots);
    return ids;
  }, [roots]);
  const allCollapsed = allBranchIds.length > 0 && allBranchIds.every((id) => collapsed.has(id));

  return (
    <div className="relative h-full">
      {/* Sticky toolbar: 全部展开/收起 + the 星系/树形 toggle. */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 flex items-center gap-1.5">
        {allBranchIds.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="pointer-events-auto h-8 bg-card/95 text-xs shadow-sm backdrop-blur"
            onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(allBranchIds))}
          >
            {allCollapsed ? '全部展开' : '全部收起'}
          </Button>
        )}
        {modeToggle && (
          <div className="pointer-events-auto rounded-md border border-border bg-card/95 shadow-sm backdrop-blur">
            {modeToggle}
          </div>
        )}
      </div>

      <div className="h-full overflow-y-auto scrollbar-thin bg-background px-3 pb-10 pt-4 sm:px-5">
        <div className="mx-auto w-full max-w-3xl">
          {/* 团队 root header */}
          <div className="mb-1 flex items-center gap-2 px-1 pb-2">
            <span className="flex h-6 items-center rounded-md bg-secondary px-2 text-xs font-semibold text-foreground">
              团队
            </span>
            <span className="text-xs text-muted-foreground">组织架构大纲</span>
          </div>

          <div className="space-y-0.5">
            {rows.map((row) => (
              <OutlineRowView
                key={row.node.id}
                row={row}
                collapsed={collapsed.has(row.node.id)}
                editable={editable}
                onToggle={toggle}
                onAddChild={onAddChild}
                onEdit={onEdit}
                onMembers={onMembers}
                onAddMembers={onAddMembers}
                canManageMembers={canManageMembers}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OutlineRowView({
  row,
  collapsed,
  editable,
  onToggle,
  onAddChild,
  onEdit,
  onMembers,
  onAddMembers,
  canManageMembers,
}: {
  row: OutlineRow;
  collapsed: boolean;
  editable: boolean;
  onToggle: (id: string) => void;
  onAddChild?: (node: OrgNode, kind: OrgNodeKind) => void;
  onEdit?: (node: OrgNode) => void;
  onMembers?: (node: OrgNode) => void;
  onAddMembers?: (node: OrgNode) => void;
  canManageMembers?: (node: OrgNode) => boolean;
}): JSX.Element {
  const { node, depth, ancestorLines, isLast } = row;
  const hasChildren = node.children.length > 0;
  const canManageThis = canManageMembers?.(node) ?? false;
  const nodeOnMembers = onMembers && canManageThis ? onMembers : undefined;
  const nodeOnAddMembers = onAddMembers && canManageThis ? onAddMembers : undefined;

  return (
    <div className="group/row flex min-h-[2.5rem] items-stretch rounded-lg pr-1.5 transition-colors hover:bg-accent/40">
      {/* Connector guides */}
      {Array.from({ length: depth }).map((_, j) => (
        <GuideCell
          key={j}
          variant={j === depth - 1 ? (isLast ? 'end' : 'tee') : ancestorLines[j] ? 'line' : 'blank'}
        />
      ))}

      {/* Collapse chevron (or spacer) */}
      {hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          className="flex w-6 shrink-0 items-center justify-center self-center rounded text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? `展开${node.title}` : `收起${node.title}`}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      ) : (
        <span className="w-6 shrink-0" aria-hidden />
      )}

      {/* Body */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
        <span
          className={cn('h-4 w-1 shrink-0 rounded-full', ORG_KIND_ACCENT[node.kind])}
          aria-hidden
        />
        <span
          className={cn(
            'rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none',
            ORG_KIND_BADGE[node.kind],
          )}
        >
          {ORG_KIND_LABELS[node.kind]}
        </span>
        <span className="truncate text-sm font-semibold text-foreground" title={node.title}>
          {node.title}
        </span>
        {node.kind === 'position' && (
          <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground">
            {occupancyLabel(node)}
          </span>
        )}
        {collapsed && hasChildren && (
          <span className="text-[11px] text-muted-foreground">
            （{node.children.length} 个下级）
          </span>
        )}

        {/* People */}
        {node.leads.map((person) => (
          <span key={person.userId} className="inline-flex items-center gap-1">
            <span className="relative inline-flex">
              <Avatar
                name={person.displayName}
                color={person.avatarColor}
                imageUrl={person.hasAvatar ? avatarUrl(person.userId) : undefined}
                size="xs"
              />
              <Crown className="absolute -right-1 -top-1.5 h-3 w-3 rotate-12 fill-amber-400 text-amber-500" />
            </span>
            <span className="text-xs font-medium text-foreground">{person.displayName}</span>
          </span>
        ))}
        {node.members.length > 0 && <InlineExpandablePeople people={node.members} max={6} />}
      </div>

      {/* Trailing controls */}
      <div className="flex shrink-0 items-center gap-1 self-center pl-1">
        <NodeMembershipAction node={node} canManage={canManageThis} compact />

        {nodeOnAddMembers && (
          <div className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover/row:opacity-100 sm:group-focus-within/row:opacity-100">
            <Tooltip content={node.trackId ? '加入赛道成员' : '加入成员'}>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={node.trackId ? '加入赛道成员' : '加入成员'}
                onClick={(event) => {
                  event.currentTarget.blur();
                  nodeOnAddMembers(node);
                }}
              >
                <UserPlus className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>
        )}

        {(editable || nodeOnMembers) && (
          <div className="opacity-100 transition-opacity sm:opacity-0 sm:group-hover/row:opacity-100 sm:group-focus-within/row:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="更多操作">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[10rem]">
                {editable && onEdit && node.trackId === null && (
                  <DropdownMenuItem onSelect={() => onEdit(node)}>
                    <Pencil className="h-4 w-4 text-muted-foreground" /> 编辑
                  </DropdownMenuItem>
                )}
                {editable && onAddChild && (
                  <DropdownMenuItem onSelect={() => onAddChild(node, 'group')}>
                    <Plus className="h-4 w-4 text-muted-foreground" /> 新增子级
                  </DropdownMenuItem>
                )}
                {nodeOnMembers && (
                  <DropdownMenuItem onSelect={() => nodeOnMembers(node)}>
                    <Users className="h-4 w-4 text-muted-foreground" /> 负责人 / 成员
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  );
}
