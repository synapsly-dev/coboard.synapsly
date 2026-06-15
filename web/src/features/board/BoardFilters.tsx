import { Check, Filter, UserCircle2 } from 'lucide-react';
import type { ProjectMemberWithUser } from 'shared';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui';
import { cn } from '../../lib/utils';

/**
 * Board filters (§6.1, §11 "我的任务" cross-project view as a filter). Two quick
 * filters: "我的任务" (assignee = current user) and a per-assignee dropdown.
 * State is lifted to the board page so it can filter the cached task list.
 */

/** Special filter sentinel values. */
export const FILTER_ALL = '__all__';
export const FILTER_ME = '__me__';
/** Concrete filter value: a member user id, FILTER_ALL, or FILTER_ME. */
export type AssigneeFilter = string;

export interface BoardFiltersProps {
  value: AssigneeFilter;
  onChange: (value: AssigneeFilter) => void;
  members: ProjectMemberWithUser[];
  /** Current user id, to label/enable "我的任务". */
  currentUserId: string | undefined;
}

export function BoardFilters({
  value,
  onChange,
  members,
  currentUserId,
}: BoardFiltersProps): JSX.Element {
  const isMine = value === FILTER_ME;
  const selectedMember =
    value !== FILTER_ALL && value !== FILTER_ME
      ? members.find((m) => m.userId === value)
      : undefined;

  const dropdownLabel = selectedMember ? selectedMember.user.displayName : '全部成员';

  return (
    <div className="flex items-center gap-2">
      {/* "我的任务" quick toggle */}
      <Button
        type="button"
        variant={isMine ? 'primary' : 'outline'}
        size="sm"
        disabled={!currentUserId}
        onClick={() => onChange(isMine ? FILTER_ALL : FILTER_ME)}
        aria-pressed={isMine}
      >
        <UserCircle2 className="h-3.5 w-3.5" aria-hidden />
        我的任务
      </Button>

      {/* Per-assignee dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Filter className="h-3.5 w-3.5" aria-hidden />
            <span className="max-w-[8rem] truncate">{dropdownLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
          <DropdownMenuLabel>按负责人筛选</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onChange(FILTER_ALL)}>
            <span className="flex-1">全部成员</span>
            {value === FILTER_ALL && <Check className="h-3.5 w-3.5" aria-hidden />}
          </DropdownMenuItem>
          {members.map((m) => (
            <DropdownMenuItem
              key={m.userId}
              onSelect={() => onChange(m.userId)}
              className={cn(value === m.userId && 'bg-accent text-accent-foreground')}
            >
              <span className="flex-1 truncate">
                {m.user.displayName}
                {m.userId === currentUserId && (
                  <span className="ml-1 text-xs text-muted-foreground">（我）</span>
                )}
              </span>
              {value === m.userId && <Check className="h-3.5 w-3.5" aria-hidden />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
