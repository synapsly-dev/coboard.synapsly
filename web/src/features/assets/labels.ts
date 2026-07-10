import type { AssetKind } from 'shared';
import { assetKinds } from 'shared';

/**
 * Centralized Chinese labels + presentation metadata for the 资产库 kinds (P3 §1,
 * 运营需求 §9). Same theme-aware chip recipe as the task-type / quality-grade chips
 * (`bg-{c}/10 text + ring`, with a `dark:` text bump) so the four libraries read
 * apart at a glance in both themes: 内容库=sky / 反馈库=emerald / 资源库=amber /
 * 问题清单=rose.
 */
export interface AssetKindMeta {
  /** Full Chinese label, e.g. "内容库". */
  label: string;
  /** Tokenized chip classes (background tint + text + ring), theme-aware. */
  className: string;
}

export const ASSET_KIND_META: Record<AssetKind, AssetKindMeta> = {
  content: {
    label: '内容库',
    className: 'bg-sky-500/10 text-sky-600 ring-1 ring-inset ring-sky-500/20 dark:text-sky-400',
  },
  feedback: {
    label: '反馈库',
    className:
      'bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400',
  },
  resource: {
    label: '资源库',
    className:
      'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400',
  },
  issue: {
    label: '问题清单',
    className:
      'bg-rose-500/10 text-rose-600 ring-1 ring-inset ring-rose-500/20 dark:text-rose-400',
  },
};

/** Ordered kinds for tabs/selectors (mirrors the shared enum order). */
export const ASSET_KIND_OPTIONS: readonly AssetKind[] = assetKinds;
