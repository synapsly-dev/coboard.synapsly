import type { Asset } from 'shared';

/**
 * Client-side refinement of the server-filtered asset list (P3 §1). The server
 * handles `kind`/`trackId`; two filters can only happen here:
 * - 通用 (track = null) — the API's `trackId` param can't express "no track";
 * - the search box — a cheap title+body contains match over the small list.
 */

/** Sentinel for the 通用 (no-track) choice in the track filter select. */
export const TRACK_NONE = '__none__';
/** Sentinel for "all tracks" in the track filter select. */
export const TRACK_ALL = 'all';

/** Apply the 通用 track choice + search text to an already-fetched list. */
export function filterAssets(
  assets: readonly Asset[],
  { trackFilter, search }: { trackFilter: string; search: string },
): Asset[] {
  const needle = search.trim().toLowerCase();
  return assets.filter((a) => {
    if (trackFilter === TRACK_NONE && a.trackId !== null) return false;
    if (!needle) return true;
    return (
      a.title.toLowerCase().includes(needle) || a.body.toLowerCase().includes(needle)
    );
  });
}
