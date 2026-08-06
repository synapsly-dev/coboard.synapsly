/**
 * Syna ID entry points used by the mini program. Kept in one place so the
 * account web view and the profile page cannot drift apart, and so the embedded
 * web view has a single origin to validate against.
 */
export const SYNA_ACCOUNT_ORIGIN = 'https://accounts.synapsly.org';
export const SYNA_ACCOUNT_URL = `${SYNA_ACCOUNT_ORIGIN}/`;
/** Where Syna ID explains what each membership tier includes (Syna App Spec §4.1). */
export const SYNA_MEMBERSHIP_URL = `${SYNA_ACCOUNT_ORIGIN}/membership`;

/** Navigate the in-app web view to a Syna ID page. */
export function synaAccountRoute(url: string = SYNA_ACCOUNT_URL): string {
  return `/pages/syna-account/index?url=${encodeURIComponent(url)}`;
}
