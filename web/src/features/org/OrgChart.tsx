import { useState } from 'react';
import { ChevronDown, ChevronRight, Crown } from 'lucide-react';
import type { OrgNodeMember } from 'shared';
import { Avatar } from '../../components/ui';
import { avatarUrl, cn } from '../../lib/utils';
import { ORG_KIND_BADGE, ORG_KIND_LABELS } from './labels';
import type { OrgTreeNode } from './tree';

/**
 * Read-only top-down org chart (团队架构 图谱视图). Renders the forest as a classic
 * org chart — each unit centered above its children, connected by CSS lines (see the
 * `.org-tree` rules in index.css). A card shows only the kind badge, the unit name,
 * and its people (负责人 crowned, then 成员 avatars) — no editing, so the structure
 * reads at a glance. Subtrees can be collapsed; wide charts scroll horizontally.
 */
export function OrgChart({ roots }: { roots: OrgTreeNode[] }): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-x-auto pb-4">
      <div className="org-tree inline-block min-w-full px-2">
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
  const hasChildren = node.children.length > 0;
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
                {node.children.length}
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
        </ul>
      )}
    </li>
  );
}

/** A single unit card — kind badge, title, and its people. Purely presentational. */
function NodeCard({ node }: { node: OrgTreeNode }): JSX.Element {
  const hasPeople = node.leads.length > 0 || node.members.length > 0;
  return (
    <div className="inline-flex min-w-[9rem] max-w-[15rem] flex-col items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-center shadow-sm">
      <span
        className={cn(
          'rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none',
          ORG_KIND_BADGE[node.kind],
        )}
      >
        {ORG_KIND_LABELS[node.kind]}
      </span>
      <span className="text-sm font-semibold leading-snug text-foreground">{node.title}</span>

      {hasPeople && (
        <div className="mt-0.5 flex flex-col items-center gap-1.5">
          {node.leads.length > 0 && (
            <div className="flex flex-wrap justify-center gap-x-2 gap-y-1">
              {node.leads.map((p) => (
                <span key={p.userId} className="inline-flex items-center gap-1">
                  <PersonAvatar person={p} lead />
                  <span className="text-[11px] font-medium text-foreground">{p.displayName}</span>
                </span>
              ))}
            </div>
          )}
          {node.members.length > 0 && (
            <div className="flex items-center">
              <div className="flex -space-x-1.5">
                {node.members.slice(0, 8).map((p) => (
                  <PersonAvatar key={p.userId} person={p} ring />
                ))}
              </div>
              {node.members.length > 8 && (
                <span className="ml-1.5 text-[11px] text-muted-foreground">
                  +{node.members.length - 8}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PersonAvatar({
  person,
  lead = false,
  ring = false,
}: {
  person: OrgNodeMember;
  lead?: boolean;
  ring?: boolean;
}): JSX.Element {
  return (
    <span className="relative inline-flex">
      <Avatar
        name={person.displayName}
        color={person.avatarColor}
        imageUrl={person.hasAvatar ? avatarUrl(person.userId) : undefined}
        size="xs"
        className={ring ? 'ring-2 ring-card' : undefined}
      />
      {lead && (
        <Crown className="absolute -right-1 -top-1.5 h-3 w-3 rotate-12 fill-amber-400 text-amber-500" />
      )}
    </span>
  );
}
