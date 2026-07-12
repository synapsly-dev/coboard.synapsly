import type { IdeaStatus } from 'shared';
import type { BadgeVariant } from '../../components/ui';

/**
 * Idea-domain display constants (§7.1, §12 i18n) — the single home for idea
 * status presentation, consumed by the task drawer's 想法 section, the 灵感区
 * cards, and the 想法详情 dialog.
 */

/** Chinese labels + badge variant per idea status. */
export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  pending: '待处理',
  adopted: '已采纳',
  rejected: '已驳回',
};

export const IDEA_STATUS_VARIANT: Record<IdeaStatus, BadgeVariant> = {
  pending: 'neutral',
  adopted: 'success',
  rejected: 'destructive',
};
