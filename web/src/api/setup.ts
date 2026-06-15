import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { SetupStatusResponse } from 'shared';
import { api } from './client';
import { queryKeys } from '../lib/query';

/**
 * Setup-status hook (§7 GET /setup/status, §8). Drives the first-run redirect:
 * when `needsSetup` is true and no user is authenticated, the app routes to
 * `/setup` to create the first admin. The auth/setup feature agent adds the
 * `POST /setup` mutation hook here.
 */
export function useSetupStatus(options?: { enabled?: boolean }): UseQueryResult<SetupStatusResponse> {
  return useQuery<SetupStatusResponse>({
    queryKey: queryKeys.setupStatus(),
    queryFn: ({ signal }) => api.get<SetupStatusResponse>('/setup/status', { signal }),
    // Setup state changes at most once (first admin created); cache it firmly.
    staleTime: Infinity,
    enabled: options?.enabled ?? true,
  });
}
