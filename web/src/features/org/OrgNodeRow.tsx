import {
  ChevronDown,
  ChevronRight,
  Crown,
  IndentDecrease,
  IndentIncrease,
  MoreHorizontal,
  MoveDown,
  MoveUp,
  Pencil,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import type { MoveOrgNodeInput, OrgNode } from 'shared';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui';
import { avatarUrl, cn } from '../../lib/utils';
import { ORG_KIND_BADGE, ORG_KIND_LABELS } from './labels';
import { indentInput, moveDownInput, moveUpInput, outdentInput, type OrgTreeNode } from './tree';

interface OrgNodeRowProps {
  node: OrgTreeNode;
  /** Flat node list — used to derive the up/down/indent/outdent moves. */
  nodes: OrgNode[];
  editable: boolean;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onAddChild: (node: OrgNode) => void;
  onEdit: (node: OrgNode) => void;
  onMembers: (node: OrgNode) => void;
  onDelete: (node: OrgTreeNode) => void;
  onMove: (id: string, input: MoveOrgNodeInput) => void;
}

/**
 * One row of the org tree (团队架构). Presentational: indentation reflects depth, a
 * kind badge + title + optional description lead, then 负责人 (crowned) and 成员
 * avatars. In edit mode a collapse chevron, a quick 「加子节点」 button, and a ⋯ menu
 * (edit / members / reorder / delete) appear. All structural changes are emitted as
 * callbacks; the page owns the mutations.
 */
export function OrgNodeRow({
  node,
  nodes,
  editable,
  collapsed,
  onToggleCollapse,
  onAddChild,
  onEdit,
  onMembers,
  onDelete,
  onMove,
}: OrgNodeRowProps): JSX.Element {
  const hasChildren = node.children.length > 0;
  const up = moveUpInput(nodes, node);
  const down = moveDownInput(nodes, node);
  const indent = indentInput(nodes, node);
  const outdent = outdentInput(nodes, node);

  return (
    <div
      className="group/node relative flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-sm transition-colors hover:border-border/80 hover:bg-accent/30"
      style={{ marginLeft: `${node.depth * 1.5}rem` }}
    >
      {/* Collapse toggle (or a spacer to keep titles aligned). */}
      {hasChildren ? (
        <button
          type="button"
          onClick={() => onToggleCollapse(node.id)}
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={collapsed ? '展开' : '收起'}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      ) : (
        <span className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn(
              'rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none',
              ORG_KIND_BADGE[node.kind],
            )}
          >
            {ORG_KIND_LABELS[node.kind]}
          </span>
          <span className="truncate text-sm font-semibold text-foreground">{node.title}</span>
          {collapsed && hasChildren && (
            <span className="text-xs text-muted-foreground">（{node.children.length} 个下级）</span>
          )}
        </div>

        {node.description && (
          <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
            {node.description}
          </p>
        )}

        {(node.leads.length > 0 || node.members.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {node.leads.map((p) => (
              <span key={p.userId} className="inline-flex items-center gap-1.5">
                <span className="relative">
                  <Avatar
                    name={p.displayName}
                    color={p.avatarColor}
                    imageUrl={p.hasAvatar ? avatarUrl(p.userId) : undefined}
                    size="xs"
                  />
                  <Crown className="absolute -right-1 -top-1.5 h-3 w-3 rotate-12 fill-amber-400 text-amber-500" />
                </span>
                <span className="text-xs font-medium text-foreground">{p.displayName}</span>
              </span>
            ))}
            {node.members.length > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="flex -space-x-2">
                  {node.members.slice(0, 6).map((p) => (
                    <Avatar
                      key={p.userId}
                      name={p.displayName}
                      color={p.avatarColor}
                      imageUrl={p.hasAvatar ? avatarUrl(p.userId) : undefined}
                      size="xs"
                      className="ring-2 ring-card"
                    />
                  ))}
                </span>
                {node.members.length > 6 && (
                  <span className="text-xs text-muted-foreground">+{node.members.length - 6}</span>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {editable && (
        <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover/node:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="加子节点"
            onClick={() => onAddChild(node)}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="更多操作">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[10rem]">
              <DropdownMenuItem onSelect={() => onEdit(node)}>
                <Pencil className="h-4 w-4 text-muted-foreground" /> 编辑
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onMembers(node)}>
                <Users className="h-4 w-4 text-muted-foreground" /> 负责人 / 成员
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!up} onSelect={() => up && onMove(node.id, up)}>
                <MoveUp className="h-4 w-4 text-muted-foreground" /> 上移
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!down} onSelect={() => down && onMove(node.id, down)}>
                <MoveDown className="h-4 w-4 text-muted-foreground" /> 下移
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!indent} onSelect={() => indent && onMove(node.id, indent)}>
                <IndentIncrease className="h-4 w-4 text-muted-foreground" /> 缩进（成为上一项的子级）
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!outdent}
                onSelect={() => outdent && onMove(node.id, outdent)}
              >
                <IndentDecrease className="h-4 w-4 text-muted-foreground" /> 取消缩进
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => onDelete(node)}
              >
                <Trash2 className="h-4 w-4" /> 删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
