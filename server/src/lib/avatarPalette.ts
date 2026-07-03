/**
 * Avatar palette (§5 users.avatar_color) — single source of truth.
 *
 * A curated, desaturated set tuned to the Synapsly "quiet-luxe" monochrome theme
 * (warm off-white canvas, ink primary). The previous defaults were the saturated
 * Tailwind rainbow (#3b82f6 etc.), which read as loud and off-brand against the
 * near-neutral surfaces. These muted clay/sage/dusty tones keep per-person colour
 * recognition (useful on the board's stacked claimant avatars) while sitting
 * quietly inside the palette. Every colour lands in a mid luminance band so the
 * contrast-safe foreground (see readableTextColor) resolves to white initials.
 *
 * Order is stable and is relied upon by migration 0013, which remaps existing
 * accounts from the old rainbow positionally (old[i] -> new[i]) — do not reorder
 * without a matching migration.
 */
export const AVATAR_COLORS = [
  '#96604e', // clay / terracotta
  '#4f7377', // teal-grey / eucalyptus
  '#5e6e8c', // dusty indigo
  '#8f7440', // ochre / bronze
  '#6f5a78', // plum / mauve
  '#97606a', // mulberry rose
  '#557165', // deep sage
  '#7e6e4f', // taupe / olive
] as const;

/** Pick a deterministic-but-spread avatar colour for a new account, keyed by a
 * stable seed (e.g. the account email). */
export function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index]!;
}
