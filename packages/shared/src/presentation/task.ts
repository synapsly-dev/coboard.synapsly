import type {
  ActivityType,
  Priority,
  QualityGrade,
  ReviewStage,
  TaskStatus,
  TaskType,
} from '../enums.js';

export type ColorRole = 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'danger';

export const TASK_STATUS_ORDER: readonly TaskStatus[] = [
  'open',
  'in_progress',
  'pending_review',
  'done',
];

export const TASK_STATUS_META: Record<TaskStatus, { label: string; colorRole: ColorRole }> = {
  open: { label: '待认领', colorRole: 'neutral' },
  in_progress: { label: '进行中', colorRole: 'primary' },
  pending_review: { label: '待审阅', colorRole: 'warning' },
  done: { label: '已完成', colorRole: 'success' },
};

export const PRIORITY_META: Record<Priority, { label: string; colorRole: ColorRole }> = {
  low: { label: '低', colorRole: 'neutral' },
  medium: { label: '中', colorRole: 'primary' },
  high: { label: '高', colorRole: 'warning' },
  urgent: { label: '紧急', colorRole: 'danger' },
};

export const TASK_TYPE_META: Record<
  TaskType,
  { code: 'A' | 'B' | 'C' | 'D'; name: string; label: string; colorRole: ColorRole }
> = {
  critical: { code: 'A', name: '关键任务', label: 'A · 关键任务', colorRole: 'danger' },
  baseline: { code: 'B', name: '底线任务', label: 'B · 底线任务', colorRole: 'warning' },
  claimable: { code: 'C', name: '认领任务', label: 'C · 认领任务', colorRole: 'info' },
  collab: { code: 'D', name: '协作任务', label: 'D · 协作任务', colorRole: 'neutral' },
};

export const QUALITY_GRADE_META: Record<
  QualityGrade,
  { letter: string; name: string; colorRole: ColorRole }
> = {
  a: { letter: 'A', name: '超预期', colorRole: 'success' },
  b: { letter: 'B', name: '合格', colorRole: 'info' },
  c: { letter: 'C', name: '需修改', colorRole: 'warning' },
  d: { letter: 'D', name: '无效', colorRole: 'danger' },
};

export const REVIEW_STAGE_LABELS: Record<ReviewStage, string> = { first: '初审', final: '复核' };

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
