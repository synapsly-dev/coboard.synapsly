import { Crown } from 'lucide-react';
import type { OrgNodeMember } from 'shared';
import { Avatar } from '../../components/ui';
import { avatarUrl, cn } from '../../lib/utils';

interface PeopleProps {
  people: readonly OrgNodeMember[];
  max?: number;
  className?: string;
}

/**
 * List-view people: compact member avatars fan out in place on hover. Expanded
 * entries deliberately match the always-visible lead style: plain avatar + name,
 * without pills, borders, or a secondary surface.
 */
export function InlineExpandablePeople({ people, max = 8, className }: PeopleProps): JSX.Element {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <span
      className={cn(
        'group/people inline-flex min-w-0 items-center -space-x-2 transition-[column-gap] duration-base ease-standard hover:space-x-4',
        className,
      )}
      aria-label={people.map((person) => person.displayName).join('、')}
    >
      {shown.map((person) => (
        <span
          key={person.userId}
          title={person.displayName}
          className="inline-flex max-w-6 items-center gap-0 transition-[max-width,column-gap] duration-base ease-standard group-hover/people:max-w-40 group-hover/people:gap-1.5"
        >
          <span className="relative inline-flex shrink-0">
            <Avatar
              name={person.displayName}
              color={person.avatarColor}
              imageUrl={person.hasAvatar ? avatarUrl(person.userId) : undefined}
              size="xs"
              className="ring-2 ring-card group-hover/people:ring-0"
            />
            {person.role === 'lead' && (
              <Crown className="absolute -right-1 -top-1 h-2.5 w-2.5 fill-amber-400 text-amber-500" />
            )}
          </span>
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-medium text-foreground opacity-0 transition-[max-width,opacity] duration-base ease-standard group-hover/people:max-w-28 group-hover/people:opacity-100">
            {person.displayName}
          </span>
        </span>
      ))}
      {overflow > 0 && (
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-medium tabular-nums text-muted-foreground ring-2 ring-card"
          title={people
            .slice(max)
            .map((person) => person.displayName)
            .join('、')}
        >
          +{overflow}
        </span>
      )}
    </span>
  );
}
