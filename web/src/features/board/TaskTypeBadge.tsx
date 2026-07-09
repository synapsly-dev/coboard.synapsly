import type { TaskType } from 'shared';
import { cn } from '../../lib/utils';
import { TASK_TYPE_META } from './labels';

/**
 * Task-type (A/B/C/D) chip (P0 §2). Renders a prominent letter code plus the
 * Chinese label in a tokenized, theme-aware hue (see {@link TASK_TYPE_META}).
 * Renders nothing when the task has no type (未分类). The marquee visual for a
 * task's responsibility/claim model — kept to the same weight as the priority pill.
 */
export interface TaskTypeBadgeProps {
  taskType: TaskType | null;
  /** Hide the Chinese label, showing only the letter code (compact contexts). */
  codeOnly?: boolean;
  className?: string;
}

export function TaskTypeBadge({
  taskType,
  codeOnly = false,
  className,
}: TaskTypeBadgeProps): JSX.Element | null {
  if (!taskType) return null;
  const meta = TASK_TYPE_META[taskType];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none',
        meta.className,
        className,
      )}
      title={meta.label}
      aria-label={meta.label}
    >
      <span className="text-[0.8125rem] font-bold leading-none tracking-tight">{meta.code}</span>
      {!codeOnly && <span className="leading-none">{meta.name}</span>}
    </span>
  );
}
