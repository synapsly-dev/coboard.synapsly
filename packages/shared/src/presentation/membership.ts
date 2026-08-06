import type { MembershipTier } from '../enums.js';

/**
 * Display names for the read-only Syna membership tiers.
 *
 * The `none | plus | pro | max` enum is owned by Syna ID; Coboard mirrors it and
 * never writes it. This table is presentation-only — it exists so the admin user
 * list, the web profile page, and the mini program profile all render the same
 * wording instead of each hand-rolling its own ternary.
 *
 * Renaming a tier is the ONLY thing an app may do with `membership_tier` (Syna
 * App Spec §4.1/§4.6.1). It must never feed a permission check, a price, a quota
 * or a rate limit, and nothing here may describe what a tier unlocks — what a
 * tier gives is defined once by Syna ID and explained at MEMBERSHIP_URL.
 */
export const MEMBERSHIP_TIER_LABELS: Record<MembershipTier, string> = {
  none: '免费版',
  plus: 'Syna Plus',
  pro: 'Syna Pro',
  max: 'Syna Max',
};

/** Where Syna ID explains what each tier includes. Apps link, never restate. */
export const MEMBERSHIP_URL = 'https://accounts.synapsly.org/membership';

/** Label for a possibly-absent tier; an unknown/missing tier reads as free. */
export function membershipTierLabel(tier: MembershipTier | null | undefined): string {
  return MEMBERSHIP_TIER_LABELS[tier ?? 'none'] ?? MEMBERSHIP_TIER_LABELS.none;
}
