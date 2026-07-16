import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AuthConfigResponse } from 'shared';
import { queryKeys } from 'client-core';
import { coboardClient } from '../platform/coboard-client';

/**
 * Public auth-config hook. `GET /auth/config` is unauthenticated and tells the
 * login page which sign-in affordances to render: whether Synapsly ID SSO is
 * configured, and whether the local dev fake-login is available (non-prod only).
 */
export function useAuthConfig(options?: { enabled?: boolean }): UseQueryResult<AuthConfigResponse> {
  return useQuery<AuthConfigResponse>({
    queryKey: queryKeys.authConfig(),
    queryFn: ({ signal }) => coboardClient.auth.config(signal),
    staleTime: 5 * 60_000,
    enabled: options?.enabled ?? true,
  });
}
