/**
 * Lexicographic fractional ranking for intra-column ordering (§5 tasks.rank,
 * §6.1). Tasks within a column are sorted by their `rank` string; to move a task
 * between neighbours we compute a new key that sorts strictly between them,
 * without renumbering siblings.
 *
 * The alphabet is base-62-ish but we only need ordering, not density guarantees,
 * so a simple midpoint-string algorithm over a fixed alphabet is sufficient for
 * the data volumes here (§6.4 — "数据量级毫无压力").
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const MIN_CHAR = ALPHABET[0]!;
const MAX_CHAR = ALPHABET[ALPHABET.length - 1]!;

function charIndex(ch: string): number {
  const idx = ALPHABET.indexOf(ch);
  return idx === -1 ? 0 : idx;
}

/**
 * Compute a rank string strictly between `before` and `after` (lexicographic).
 * Pass `null` for an open end (start/end of list).
 */
export function rankBetween(before: string | null, after: string | null): string {
  const lo = before ?? '';
  const hi = after ?? '';

  if (hi && lo >= hi) {
    // Degenerate input (equal/inverted) — fall back to appending after `lo`.
    return lo + 'm';
  }

  let result = '';
  let i = 0;
  for (;;) {
    const loChar = i < lo.length ? lo[i]! : MIN_CHAR;
    const hiChar = i < hi.length ? hi[i]! : MAX_CHAR;

    if (loChar === hiChar) {
      result += loChar;
      i += 1;
      continue;
    }

    const loIdx = charIndex(loChar);
    const hiIdx = charIndex(hiChar);
    const mid = Math.floor((loIdx + hiIdx) / 2);

    if (mid > loIdx) {
      // There's room for a character strictly between.
      result += ALPHABET[mid]!;
      return result;
    }

    // Adjacent characters: keep the low char and descend one level deeper,
    // appending after `lo`'s remaining suffix.
    result += loChar;
    i += 1;
    // From here `after`'s bound no longer constrains us (we've already gone
    // below it), so we just need something greater than lo's tail.
    const tail = lo.slice(i);
    if (tail) {
      result += tail;
    }
    result += 'm';
    return result;
  }
}

/** Initial rank for the very first task in an empty column. */
export function firstRank(): string {
  return 'm';
}
