import {
  ACTIVITY_LABELS as SHARED_ACTIVITY_LABELS,
  PRIORITY_META,
  QUALITY_GRADE_META as SHARED_QUALITY_GRADE_META,
  REVIEW_STAGE_LABELS as SHARED_REVIEW_STAGE_LABELS,
  TASK_STATUS_META,
  TASK_STATUS_ORDER,
  TASK_TYPE_META as SHARED_TASK_TYPE_META,
  taskTypes,
  type ActivityType,
  type Priority,
  type QualityGrade,
  type ReviewStage,
  type TaskStatus,
  type TaskType,
} from 'shared';
import type { BadgeVariant } from '../../components/ui';

/**
 * Centralized Chinese labels and presentation metadata for board enums (§12 i18n).
 * Code identifiers stay English; UI copy is Chinese. Kept feature-local since
 * only the board/task features consume these.
 */

/** Board column order (lifecycle v2 §5): 待认领 → 进行中 → 待审阅 → 已完成. */
export const COLUMN_ORDER = TASK_STATUS_ORDER;

export const STATUS_LABELS: Record<TaskStatus, string> = Object.fromEntries(
  Object.entries(TASK_STATUS_META).map(([status, meta]) => [status, meta.label]),
) as Record<TaskStatus, string>;

/** One column's stage-timestamp spec (板块时间) — see {@link STATUS_TIME}. */
export interface StatusTimeSpec {
  /** Sort-menu label, e.g. "发布时间". */
  label: string;
  /** Card chip verb, e.g. "发布". */
  prefix: string;
  /** Which Task field carries this stage's timestamp. */
  field: 'createdAt' | 'deliveredAt' | 'completedAt';
}

/**
 * The SINGLE source of the status→timestamp mapping — the card chip (format.ts),
 * the time-sort comparators (sort.ts) and the column sort menu (Column.tsx) all
 * read it, so they can never disagree.
 */
export const STATUS_TIME: Record<TaskStatus, StatusTimeSpec> = {
  open: { label: '发布时间', prefix: '发布', field: 'createdAt' },
  in_progress: { label: '发布时间', prefix: '发布', field: 'createdAt' },
  pending_review: { label: '提交时间', prefix: '提交', field: 'deliveredAt' },
  done: { label: '完成时间', prefix: '完成', field: 'completedAt' },
};

export const PRIORITY_LABELS: Record<Priority, string> = Object.fromEntries(
  Object.entries(PRIORITY_META).map(([priority, meta]) => [priority, meta.label]),
) as Record<Priority, string>;

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
    ...SHARED_TASK_TYPE_META.critical,
    className: 'bg-rose-500/10 text-rose-600 ring-1 ring-inset ring-rose-500/20 dark:text-rose-400',
  },
  baseline: {
    ...SHARED_TASK_TYPE_META.baseline,
    className:
      'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400',
  },
  claimable: {
    ...SHARED_TASK_TYPE_META.claimable,
    className: 'bg-sky-500/10 text-sky-600 ring-1 ring-inset ring-sky-500/20 dark:text-sky-400',
  },
  collab: {
    ...SHARED_TASK_TYPE_META.collab,
    className:
      'bg-slate-500/10 text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:text-slate-300',
  },
};

/** Ordered task types for selectors (A → B → C → D). */
export const TASK_TYPE_OPTIONS: readonly TaskType[] = taskTypes;

/** Human-readable, fill-in-the-blanks templates for the activity timeline (§5). */
export const ACTIVITY_LABELS: Record<ActivityType, string> = SHARED_ACTIVITY_LABELS;

/** Review stage labels (P2 §3 两级复核): first = 初审, final = 复核. */
export const REVIEW_STAGE_LABELS: Record<ReviewStage, string> = SHARED_REVIEW_STAGE_LABELS;

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
    ...SHARED_QUALITY_GRADE_META.a,
    className:
      'bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400',
  },
  b: {
    ...SHARED_QUALITY_GRADE_META.b,
    className: 'bg-sky-500/10 text-sky-600 ring-1 ring-inset ring-sky-500/20 dark:text-sky-400',
  },
  c: {
    ...SHARED_QUALITY_GRADE_META.c,
    className:
      'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400',
  },
  d: {
    ...SHARED_QUALITY_GRADE_META.d,
    className: 'bg-rose-500/10 text-rose-600 ring-1 ring-inset ring-rose-500/20 dark:text-rose-400',
  },
};

/**
 * Violet-ish chip for the 待复核 state (P2 §3) — a pending_review task that has
 * passed 初审 and awaits the global admin's 复核. Deliberately distinct from the
 * amber 待审阅 warning badge so the two review stages read apart at a glance.
 */
export const FINAL_REVIEW_CHIP_CLASS =
  'bg-violet-500/10 text-violet-600 ring-1 ring-inset ring-violet-500/20 dark:text-violet-400';
