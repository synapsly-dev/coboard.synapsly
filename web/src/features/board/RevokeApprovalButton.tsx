import { Undo2 } from 'lucide-react';
import type { Task } from 'shared';
import { Button, useConfirm } from '../../components/ui';
import { isApiClientError } from '../../api/client';
import { useRevokeApproval } from '../../api/tasks';

/**
 * 撤销通过 control for a `done` task (manager only). Sends the task back to
 * 待审阅 (pending_review) so it can be re-reviewed — re-approved, or 驳回'd to
 * 进行中 via the normal review flow. Confirms first since it un-completes the task.
 * Used on the board card and in the detail drawer.
 */
export interface RevokeApprovalButtonProps {
  task: Task;
  projectId: string;
  size?: 'sm' | 'md';
  className?: string;
  /** Fired after a successful revoke (e.g. to close a menu). */
  onRevoked?: () => void;
}

export function RevokeApprovalButton({
  task,
  projectId,
  size = 'sm',
  className,
  onRevoked,
}: RevokeApprovalButtonProps): JSX.Element {
  const revoke = useRevokeApproval(projectId);
  const confirm = useConfirm();

  return (
    <div className={className} onClick={(e) => e.stopPropagation()}>
      <Button
        type="button"
        variant="outline"
        size={size}
        className="w-full sm:w-auto"
        loading={revoke.isPending}
        aria-label="撤销通过"
        onClick={async () => {
          const ok = await confirm({
            title: '撤销通过',
            description: `确定撤销「${task.title}」的通过？任务将退回「待审阅」重新审阅。`,
            confirmText: '撤销通过',
            destructive: false,
          });
          if (ok) {
            revoke.mutate(task.id, { onSuccess: () => onRevoked?.() });
          }
        }}
      >
        {!revoke.isPending && <Undo2 className="h-3.5 w-3.5" aria-hidden />}
        撤销通过
      </Button>
      {revoke.isError && (
        <p className="mt-1 text-xs text-destructive">
          {isApiClientError(revoke.error) ? revoke.error.message : '操作失败，请重试'}
        </p>
      )}
    </div>
  );
}
