import type { OrgNodeMember } from 'shared';
import type { OrgTreeNode } from '../tree';

/** Derived read model shared by the role-chart desktop and mobile renderers. */
export interface OrgRoleIndex {
  /** Unique people in each node's complete subtree. */
  subtreeMemberCounts: ReadonlyMap<string, number>;
  /** The same subtree rollup with display data, ordered by tree/direct-member order. */
  subtreePeopleByNode: ReadonlyMap<string, readonly OrgNodeMember[]>;
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
  const subtreePeopleByNode = new Map<string, OrgNodeMember[]>();
  const positionIdsByUser = new Map<string, string[]>();
  const vacanciesByPosition = new Map<string, number | null>();
  const allPeople = new Map<string, OrgNodeMember>();

  const addPerson = (target: Map<string, OrgNodeMember>, person: OrgNodeMember): void => {
    const current = target.get(person.userId);
    if (!current || (current.role !== 'lead' && person.role === 'lead')) {
      target.set(person.userId, person);
    }
  };

  const walk = (node: OrgTreeNode): Map<string, OrgNodeMember> => {
    const directPeople = peopleOnNode(node);
    const subtreePeople = new Map<string, OrgNodeMember>();
    for (const person of directPeople) {
      addPerson(subtreePeople, person);
      addPerson(allPeople, person);
    }

    if (node.kind === 'position') {
      for (const person of directPeople) {
        const positions = positionIdsByUser.get(person.userId) ?? [];
        positions.push(node.id);
        positionIdsByUser.set(person.userId, positions);
      }
      vacanciesByPosition.set(
        node.id,
        node.headcount == null ? null : Math.max(0, node.headcount - directPeople.length),
      );
    }

    for (const child of node.children) {
      for (const person of walk(child).values()) addPerson(subtreePeople, person);
    }
    subtreeMemberCounts.set(node.id, subtreePeople.size);
    subtreePeopleByNode.set(node.id, [...subtreePeople.values()]);
    return subtreePeople;
  };

  for (const root of roots) walk(root);

  return {
    subtreeMemberCounts,
    subtreePeopleByNode,
    positionIdsByUser,
    vacanciesByPosition,
    totalMemberCount: allPeople.size,
  };
}
