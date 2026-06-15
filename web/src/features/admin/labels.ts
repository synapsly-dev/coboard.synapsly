import type { ProjectRole, UserRole } from 'shared';

/**
 * Chinese display labels and constants for the admin console (§12 — UI is
 * Chinese; code identifiers stay English). Centralized so the Users/Projects
 * tabs and their dialogs render role names consistently.
 */

/** Global account role labels (§6.3 users.role). */
export const userRoleLabels: Record<UserRole, string> = {
  admin: '管理员',
  member: '成员',
};

/** Per-project membership role labels (§6.3 project_members.role). */
export const projectRoleLabels: Record<ProjectRole, string> = {
  lead: '负责人',
  member: '成员',
};

/**
 * Default avatar background palette for new accounts (§5 users.avatar_color).
 * Hex `#RRGGBB` values — validated by `avatarColorSchema`. The create dialog
 * offers these as quick picks; the server may also default one.
 */
export const avatarColorPalette: readonly string[] = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#10b981', // emerald
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#64748b', // slate
];

/** Deterministically pick a palette color from a seed string (e.g. email). */
export function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return avatarColorPalette[hash % avatarColorPalette.length] as string;
}
