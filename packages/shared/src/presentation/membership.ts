import type { MembershipTier } from '../enums.js';

/**
 * Display names for the read-only Syna membership tiers.
 *
 * The `none | plus | pro` enum is owned by Syna ID; Coboard mirrors it and never
 * writes it. This table is presentation-only — it exists so the admin user list,
 * the web profile page, and the mini program profile all render the same wording
 * instead of each hand-rolling its own ternary.
 */
export const MEMBERSHIP_TIER_LABELS: Record<MembershipTier, string> = {
  none: '免费版',
  plus: 'Syna Plus',
  pro: 'Syna Pro',
};

/** Label for a possibly-absent tier; an unknown/missing tier reads as free. */
export function membershipTierLabel(tier: MembershipTier | null | undefined): string {
  return MEMBERSHIP_TIER_LABELS[tier ?? 'none'] ?? MEMBERSHIP_TIER_LABELS.none;
}
