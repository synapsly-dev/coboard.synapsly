import type { UseMutationResult } from '@tanstack/react-query';
import type { DeleteIdeaVars } from '../../api/ideas';
import type { ConfirmOptions } from '../../components/ui';

/**
 * The ONE confirm-then-delete flow for ideas (§7.1), shared by the task drawer's
 * 想法 section, the 灵感区 card overlay, and the 想法详情 dialog — so the
 * confirmation copy and the mutate-vars shape can't drift across surfaces. Takes the
 * `confirm` fn from {@link useConfirm} so no surface falls back to a native dialog.
 */
export async function confirmDeleteIdea(
  confirm: (options: ConfirmOptions) => Promise<boolean>,
  deleteIdea: UseMutationResult<void, Error, DeleteIdeaVars>,
  idea: { id: string; taskId: string | null },
  callbacks?: { onSuccess?: () => void; onError?: (err: Error) => void },
): Promise<void> {
  const ok = await confirm({ title: '删除想法', description: '确定删除这个想法？此操作不可撤销。' });
  if (!ok) return;
  deleteIdea.mutate({ ideaId: idea.id, taskId: idea.taskId ?? undefined }, callbacks);
}
