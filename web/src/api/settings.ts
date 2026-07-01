import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  RegistrationSettings,
  UpdateRegistrationSettingsInput,
} from 'shared';
import { api } from './client';
import { queryKeys } from '../lib/query';

/**
 * Admin settings hooks (§8 GET/PATCH /settings; §6.3). Admin-only on the server.
 * Unlike the public GET /auth/registration probe, GET /settings returns the
 * secret invite code so an admin can view/edit it. After a successful update we
 * refresh both the admin settings cache and the public registration-status cache
 * (the toggle/code change can flip whether registration is open).
 */

/** Low-level fetchers — shared by hooks and mutation refetch/invalidation. */
export const settingsApi = {
  get: (signal?: AbortSignal): Promise<RegistrationSettings> =>
    api.get<RegistrationSettings>('/settings', { signal }),
  update: (input: UpdateRegistrationSettingsInput): Promise<RegistrationSettings> =>
    api.patch<RegistrationSettings>('/settings', input),
};

/** Read the registration settings, including the code (admin) — §8 GET /settings. */
export function useAdminSettings(): UseQueryResult<RegistrationSettings> {
  return useQuery<RegistrationSettings>({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => settingsApi.get(signal),
  });
}

/** Persist a partial settings update (admin) — §8 PATCH /settings. */
export function useUpdateSettings(): UseMutationResult<
  RegistrationSettings,
  Error,
  UpdateRegistrationSettingsInput
> {
  const queryClient = useQueryClient();
  return useMutation<RegistrationSettings, Error, UpdateRegistrationSettingsInput>({
    mutationFn: (input) => settingsApi.update(input),
    onSuccess: (settings) => {
      queryClient.setQueryData<RegistrationSettings>(queryKeys.settings(), settings);
    },
  });
}
