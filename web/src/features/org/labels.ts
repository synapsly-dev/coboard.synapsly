import type { OrgNodeKind } from 'shared';

/**
 * Display metadata for org-node kinds (团队架构). `label` is the Chinese UI name;
 * `badge` is a Tailwind class pair for the kind chip, using the app's token palette
 * so it reads coherently in light and dark. Kinds are purely visual — the tree nests
 * to any depth regardless.
 */
export const ORG_KIND_LABELS: Record<OrgNodeKind, string> = {
  department: '部门',
  group: '小组',
  unit: '单元',
};

/** Ordered kinds for the kind <Select> (department → group → unit). */
export const ORG_KIND_OPTIONS: OrgNodeKind[] = ['department', 'group', 'unit'];

/** Badge classes per kind (subtle, tokenized; distinct hue per level). */
export const ORG_KIND_BADGE: Record<OrgNodeKind, string> = {
  department:
    'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20',
  group:
    'bg-sky-500/10 text-sky-600 ring-1 ring-inset ring-sky-500/20 dark:text-sky-400',
  unit:
    'bg-secondary text-muted-foreground ring-1 ring-inset ring-border',
};
