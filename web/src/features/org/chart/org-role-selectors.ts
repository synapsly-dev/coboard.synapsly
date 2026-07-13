import type { OrgNodeMember } from 'shared';
import type { OrgTreeNode } from '../tree';

/** Derived read model shared by the role-chart desktop and mobile renderers. */
export interface OrgRoleIndex {
  /** Unique people in each node's complete subtree. */
  subtreeMemberCounts: ReadonlyMap<string, number>;
  /** Position node ids held by each person; length > 1 means concurrent roles. */
  positionIdsByUser: ReadonlyMap<string, readonly string[]>;
  /** Open seats for finite positions; null means unlimited headcount. */
  vacanciesByPosition: ReadonlyMap<string, number | null>;
  /** Unique people across the complete organization. */
  totalMemberCount: number;
}

/** Leads first, then members, de-duplicated defensively by user id. */
export function peopleOnNode(node: OrgTreeNode): OrgNodeMember[] {
  const seen = new Set<string>();
  const people: OrgNodeMember[] = [];
  for (const person of [...node.leads, ...node.members]) {
    if (seen.has(person.userId)) continue;
    seen.add(person.userId);
    people.push(person);
  }
  return people;
}

export function buildOrgRoleIndex(roots: OrgTreeNode[]): OrgRoleIndex {
  const subtreeMemberCounts = new Map<string, number>();
  const positionIdsByUser = new Map<string, string[]>();
  const vacanciesByPosition = new Map<string, number | null>();
  const allPeople = new Set<string>();

  const walk = (node: OrgTreeNode): Set<string> => {
    const subtreePeople = new Set(peopleOnNode(node).map((person) => person.userId));
    for (const userId of subtreePeople) allPeople.add(userId);

    if (node.kind === 'position') {
      for (const userId of subtreePeople) {
        const positions = positionIdsByUser.get(userId) ?? [];
        positions.push(node.id);
        positionIdsByUser.set(userId, positions);
      }
      vacanciesByPosition.set(
        node.id,
        node.headcount == null ? null : Math.max(0, node.headcount - subtreePeople.size),
      );
    }

    for (const child of node.children) {
      for (const userId of walk(child)) subtreePeople.add(userId);
    }
    subtreeMemberCounts.set(node.id, subtreePeople.size);
    return subtreePeople;
  };

  for (const root of roots) walk(root);

  return {
    subtreeMemberCounts,
    positionIdsByUser,
    vacanciesByPosition,
    totalMemberCount: allPeople.size,
  };
}
