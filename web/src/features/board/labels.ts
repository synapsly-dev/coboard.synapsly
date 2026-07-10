import type { ActivityType, Priority, QualityGrade, ReviewStage, TaskStatus, TaskType } from 'shared';
import type { BadgeVariant } from '../../components/ui';

/**
 * Centralized Chinese labels and presentation metadata for board enums (§12 i18n).
 * Code identifiers stay English; UI copy is Chinese. Kept feature-local since
 * only the board/task features consume these.
 */

/** Board column order (lifecycle v2 §5): 待认领 → 进行中 → 待审阅 → 已完成. */
export const COLUMN_ORDER: readonly TaskStatus[] = [
  'open',
  'in_progress',
  'pending_review',
  'done',
];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  open: '待认领',
  in_progress: '进行中',
  pending_review: '待审阅',
  done: '已完成',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
};

/** Badge variant + dot color per priority for consistent visual weight. */
export const PRIORITY_BADGE: Record<Priority, { variant: BadgeVariant; dot: string }> = {
  low: { variant: 'outline', dot: 'bg-muted-foreground/50' },
  medium: { variant: 'neutral', dot: 'bg-primary/60' },
  high: { variant: 'warning', dot: 'bg-warning' },
  urgent: { variant: 'destructive', dot: 'bg-destructive' },
};

/**
 * Task-type (A/B/C/D) display metadata (P0 §2). Each entry carries the letter
 * `code`, the full Chinese `label`, and a tokenized `className` for the chip. The
 * four hues are deliberately distinct and legible in both themes (class-based dark
 * mode) — mirroring the org-kind chip pattern (`bg-{c}/10 text + ring`, with a
 * `dark:` text bump). Distinct from the priority badge so both can sit on one card.
 */
export interface TaskTypeMeta {
  code: 'A' | 'B' | 'C' | 'D';
  /** Full label, e.g. "A · 关键任务". */
  label: string;
  /** Short label without the letter, e.g. "关键任务" — for menus/selects. */
  name: string;
  /** Tokenized chip classes (background tint + text + ring), theme-aware. */
  className: string;
}

export const TASK_TYPE_META: Record<TaskType, TaskTypeMeta> = {
  critical: {
    code: 'A',
    label: 'A · 关键任务',
    name: '关键任务',
    className: 'bg-rose-500/10 text-rose-600 ring-1 ring-inset ring-rose-500/20 dark:text-rose-400',
  },
  baseline: {
    code: 'B',
    label: 'B · 底线任务',
    name: '底线任务',
    className:
      'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400',
  },
  claimable: {
    code: 'C',
    label: 'C · 认领任务',
    name: '认领任务',
    className: 'bg-sky-500/10 text-sky-600 ring-1 ring-inset ring-sky-500/20 dark:text-sky-400',
  },
  collab: {
    code: 'D',
    label: 'D · 协作任务',
    name: '协作任务',
    className:
      'bg-slate-500/10 text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:text-slate-300',
  },
};

/** Ordered task types for selectors (A → B → C → D). */
export const TASK_TYPE_OPTIONS: readonly TaskType[] = [
  'critical',
  'baseline',
  'claimable',
  'collab',
];

/** Human-readable, fill-in-the-blanks templates for the activity timeline (§5). */
export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  created: '创建了任务',
  claimed: '认领了任务',
  assigned: '指派了任务',
  unassigned: '取消了指派',
  released: '释放了任务',
  status_changed: '变更了状态',
  completed: '通过了审阅',
  reopened: '撤销了通过（退回待审阅）',
  commented: '发表了评论',
  updated: '更新了任务',
  delivered: '交付了任务',
  rejected: '驳回了交付',
  transferred: '转让了任务',
  due_changed: '修改了截止时间',
};

/** Review stage labels (P2 §3 两级复核): first = 初审, final = 复核. */
export const REVIEW_STAGE_LABELS: Record<ReviewStage, string> = {
  first: '初审',
  final: '复核',
};

/**
 * 交付质量 A/B/C/D display metadata (P2 §2, 运营需求 §4.2). Same chip recipe as the
 * task-type chips (`bg-{c}/10 text + ring`, `dark:` text bump) but a distinct hue
 * ramp — quality is a VERDICT (emerald→rose), not a category. `name` carries the
 * short Chinese verdict for selectors and tooltips.
 */
export interface QualityGradeMeta {
  /** Uppercase display letter, e.g. "A" (the enum value is lowercase). */
  letter: string;
  /** Short verdict, e.g. "超预期". */
  name: string;
  /** Tokenized chip classes (background tint + text + ring), theme-aware. */
  className: string;
}

export const QUALITY_GRADE_META: Record<QualityGrade, QualityGradeMeta> = {
  a: {
    letter: 'A',
    name: '超预期',
    className:
      'bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400',
  },
  b: {
    letter: 'B',
    name: '合格',
    className: 'bg-sky-500/10 text-sky-600 ring-1 ring-inset ring-sky-500/20 dark:text-sky-400',
  },
  c: {
    letter: 'C',
    name: '需修改',
    className:
      'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400',
  },
  d: {
    letter: 'D',
    name: '无效',
    className:
      'bg-rose-500/10 text-rose-600 ring-1 ring-inset ring-rose-500/20 dark:text-rose-400',
  },
};

/**
 * Violet-ish chip for the 待复核 state (P2 §3) — a pending_review task that has
 * passed 初审 and awaits the global admin's 复核. Deliberately distinct from the
 * amber 待审阅 warning badge so the two review stages read apart at a glance.
 */
export const FINAL_REVIEW_CHIP_CLASS =
  'bg-violet-500/10 text-violet-600 ring-1 ring-inset ring-violet-500/20 dark:text-violet-400';
