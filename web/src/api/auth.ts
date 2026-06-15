import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { RegisterInput, RegistrationStatus } from 'shared';
import { api } from './client';
import { queryKeys } from '../lib/query';

/**
 * Public auth hooks for self-registration (§8). `useRegistrationStatus` reads the
 * code-free public probe GET /auth/registration; `registerApi.register` posts to
 * POST /auth/register (the server logs the new member in by setting the session
 * cookie). Login/logout/me live in the auth context; these complement them.
 */

/** Low-level fetchers — shared by hooks and components. */
export const registerApi = {
  status: (signal?: AbortSignal): Promise<RegistrationStatus> =>
    api.get<RegistrationStatus>('/auth/registration', { signal }),
};

/**
 * Whether self-registration is currently open (§8). Public; safe to call without
 * a session. Never returns the code — only `{ enabled }`.
 */
export function useRegistrationStatus(options?: {
  enabled?: boolean;
}): UseQueryResult<RegistrationStatus> {
  return useQuery<RegistrationStatus>({
    queryKey: queryKeys.registrationStatus(),
    queryFn: ({ signal }) => registerApi.status(signal),
    // Toggled rarely by an admin; keep it fresh for a short window.
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}

export type { RegisterInput };
