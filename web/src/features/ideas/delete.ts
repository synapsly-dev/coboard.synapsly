import type { UseMutationResult } from '@tanstack/react-query';
import type { DeleteIdeaVars } from '../../api/ideas';

/**
 * The ONE confirm-then-delete flow for ideas (§7.1), shared by the task drawer's
 * 想法 section, the 灵感区 card overlay, and the 想法详情 dialog — so the
 * confirmation copy and the mutate-vars shape can't drift across surfaces.
 */
export function confirmDeleteIdea(
  deleteIdea: UseMutationResult<void, Error, DeleteIdeaVars>,
  idea: { id: string; taskId: string | null },
  callbacks?: { onSuccess?: () => void; onError?: (err: Error) => void },
): void {
  if (!window.confirm('确定删除这个想法？')) return;
  deleteIdea.mutate({ ideaId: idea.id, taskId: idea.taskId ?? undefined }, callbacks);
}
