import type { OrgScope, ProjectRole, User } from 'shared';

/**
 * Who may edit an org tree (团队架构) — the client-side mirror of the server's scope
 * guard (UX hiding only; the server is the real boundary):
 * - whole-team tree (`scope: 'all'`): a global admin.
 * - project tree (`scope: <projectId>`): that project's lead, or a global admin.
 *
 * `projectRole` is the caller's role in the scoped project (resolve it from the
 * project members list); pass `undefined` when unknown / not a member.
 */
export function canEditOrgScope(
  user: User | null,
  scope: OrgScope,
  projectRole: ProjectRole | undefined,
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (scope === 'all') return false;
  return projectRole === 'lead';
}
