import { useState } from 'react';
import { HandMetal } from 'lucide-react';
import type { Task } from 'shared';
import { Button } from '../../components/ui';
import { useAuth } from '../../lib/auth-context';
import { isApiClientError } from '../../api/client';
import { useClaimTask } from '../../api/tasks';

/**
 * Claim control (§6.2). Shown on unassigned `open` cards. Any project member may
 * claim → server sets assignee=self, status=in_progress, records `claimed`.
 *
 * A lost race (two members claim at once) surfaces as a 409 from the server; the
 * optimistic update in {@link useClaimTask} rolls back automatically, and we show
 * a brief inline notice.
 */
export interface ClaimButtonProps {
  task: Task;
  projectId: string;
  /** Visual size — compact on cards, default in the detail drawer. */
  size?: 'sm' | 'md';
  className?: string;
  /** Optional fired after a successful claim (e.g. close a menu). */
  onClaimed?: () => void;
}

export function ClaimButton({
  task,
  projectId,
  size = 'sm',
  className,
  onClaimed,
}: ClaimButtonProps): JSX.Element | null {
  const { user } = useAuth();
  const claim = useClaimTask(projectId, user?.id ?? '');
  const [conflict, setConflict] = useState(false);

  // Only meaningful for an unassigned, open task and a logged-in user.
  if (!user || task.assigneeId !== null || task.status !== 'open') {
    return null;
  }

  const handleClaim = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setConflict(false);
    claim.mutate(task.id, {
      onSuccess: () => onClaimed?.(),
      onError: (err) => {
        if (isApiClientError(err) && err.isConflict) {
          setConflict(true);
        }
      },
    });
  };

  return (
    <div className={className}>
      <Button
        type="button"
        variant="secondary"
        size={size}
        loading={claim.isPending}
        onClick={handleClaim}
        aria-label="认领任务"
      >
        {!claim.isPending && <HandMetal className="h-3.5 w-3.5" aria-hidden />}
        认领
      </Button>
      {conflict && (
        <p className="mt-1 text-xs text-destructive">该任务已被他人认领</p>
      )}
    </div>
  );
}
