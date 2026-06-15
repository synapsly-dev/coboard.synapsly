import type { ProjectMemberWithUser } from 'shared';

/**
 * Resolve @mentions in a comment body to user ids (§5 comments.mentions). A
 * mention is `@<displayName>`; we match the longest member name that the text
 * after an `@` starts with. Returns the unique set of mentioned user ids so the
 * server can store them and (in v2) notify.
 */
export function extractMentions(
  body: string,
  members: ProjectMemberWithUser[],
): string[] {
  if (members.length === 0) return [];
  // Sort by name length desc so longer names win over prefixes.
  const sorted = [...members].sort(
    (a, b) => b.user.displayName.length - a.user.displayName.length,
  );

  const ids = new Set<string>();
  const atPositions: number[] = [];
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === '@') atPositions.push(i);
  }

  for (const pos of atPositions) {
    const rest = body.slice(pos + 1);
    for (const member of sorted) {
      const name = member.user.displayName;
      if (rest.startsWith(name)) {
        // Ensure the mention isn't a substring of a longer word boundary issue:
        // accept if followed by end / whitespace / punctuation.
        const nextChar = rest[name.length];
        if (nextChar === undefined || /[\s,.，。!！?？:：;；)）]/.test(nextChar)) {
          ids.add(member.userId);
        }
        break;
      }
    }
  }
  return [...ids];
}
