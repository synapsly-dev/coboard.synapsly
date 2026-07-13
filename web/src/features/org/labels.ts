import type { ApplicationStatus, OrgNode, OrgNodeKind } from 'shared';

/**
 * Display metadata for org-node kinds (团队架构). `label` is the Chinese UI name;
 * `badge` is a Tailwind class pair for the kind chip, using the app's token palette
 * so it reads coherently in light and dark. Kinds are purely visual — the tree nests
 * to any depth regardless — except `position` (岗位, P1), a recruitable leaf that
 * carries a 名额 (headcount) and accepts 申报 (applications).
 */
export const ORG_KIND_LABELS: Record<OrgNodeKind, string> = {
  department: '部门',
  track: '赛道',
  group: '小组',
  position: '岗位',
};

/** Ordered kinds for the kind <Select> (department → group → position). */
export const ORG_KIND_OPTIONS: OrgNodeKind[] = ['department', 'group', 'position'];

/** Badge classes per kind (subtle, tokenized; distinct hue per level). */
export const ORG_KIND_BADGE: Record<OrgNodeKind, string> = {
  department: 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20',
  track: 'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400',
  group: 'bg-sky-500/10 text-sky-600 ring-1 ring-inset ring-sky-500/20 dark:text-sky-400',
  position:
    'bg-violet-500/10 text-violet-600 ring-1 ring-inset ring-violet-500/20 dark:text-violet-400',
};

/**
 * Accent-bar classes per kind — the 3px strip along a chart card's top edge
 * (图谱 node cards). Same hue family as {@link ORG_KIND_BADGE} so badge and bar
 * read as one system; theme-aware (primary flips with the ink token, sky/violet
 * brighten a step in dark).
 */
export const ORG_KIND_ACCENT: Record<OrgNodeKind, string> = {
  department: 'bg-primary/80',
  track: 'bg-amber-500/80 dark:bg-amber-400/80',
  group: 'bg-sky-500/80 dark:bg-sky-400/80',
  position: 'bg-violet-500/80 dark:bg-violet-400/80',
};

/** How many people currently hold a node (负责人 + 成员). */
export function occupiedCount(node: OrgNode): number {
  return node.leads.length + node.members.length;
}

/** Whether a 岗位 has no open slot left (never true when 名额 is 不限/null). */
export function isPositionFull(node: OrgNode): boolean {
  return node.headcount != null && occupiedCount(node) >= node.headcount;
}

/** Compact occupancy copy for a 岗位 chip: 「在岗X/名额Y」, or 「X 人·不限」 when 名额 is null. */
export function occupancyLabel(node: OrgNode): string {
  const count = occupiedCount(node);
  return node.headcount != null ? `在岗${count}/名额${node.headcount}` : `${count} 人·不限`;
}

/** Short occupancy form for the recruit cards: 「X/Y」, or 「X 人」 when 名额 is null. */
export function occupancyShort(node: OrgNode): string {
  const count = occupiedCount(node);
  return node.headcount != null ? `${count}/${node.headcount}` : `${count} 人`;
}

/** 申报 status → Chinese label (岗位申报, P1). */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  pending: '待处理',
  approved: '已录用',
  rejected: '已婉拒',
  withdrawn: '已撤回',
};

/**
 * 申报 status chip classes — the app's tokenized tint-chip pattern
 * (`bg-{c}-500/10 text + ring`, with a `dark:` text bump), theme-aware.
 */
export const APPLICATION_STATUS_CHIP: Record<ApplicationStatus, string> = {
  pending: 'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400',
  approved:
    'bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400',
  rejected: 'bg-rose-500/10 text-rose-600 ring-1 ring-inset ring-rose-500/20 dark:text-rose-400',
  withdrawn:
    'bg-slate-500/10 text-slate-600 ring-1 ring-inset ring-slate-500/20 dark:text-slate-300',
};
