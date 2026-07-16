import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  EmailNotificationSettings,
  RegistrationSettings,
  UpdateEmailNotificationSettingsInput,
  UpdateRegistrationSettingsInput,
} from 'shared';
import { api } from './client';
import { queryKeys } from 'client-core';
import { coboardClient } from '../platform/coboard-client';

/**
 * Admin settings hooks (§8 GET/PATCH /settings; §6.3). Admin-only on the server.
 * Unlike the public GET /auth/registration probe, GET /settings returns the
 * secret invite code so an admin can view/edit it. After a successful update we
 * refresh both the admin settings cache and the public registration-status cache
 * (the toggle/code change can flip whether registration is open).
 */

/** Low-level fetchers — shared by hooks and mutation refetch/invalidation. */
/** Read the registration settings, including the code (admin) — §8 GET /settings. */
export function useAdminSettings(): UseQueryResult<RegistrationSettings> {
  return useQuery<RegistrationSettings>({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => coboardClient.settings.get(signal),
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
    mutationFn: (input) => coboardClient.settings.update(input),
    onSuccess: (settings) => {
      queryClient.setQueryData<RegistrationSettings>(queryKeys.settings(), settings);
    },
  });
}

/** 邮件提醒 fetchers — GET/PATCH /settings/email-notifications (admin). */
export const emailNotificationSettingsApi = {
  get: (signal?: AbortSignal): Promise<EmailNotificationSettings> =>
    api.get<EmailNotificationSettings>('/settings/email-notifications', { signal }),
  update: (input: UpdateEmailNotificationSettingsInput): Promise<EmailNotificationSettings> =>
    api.patch<EmailNotificationSettings>('/settings/email-notifications', input),
};

/** Read the 邮件提醒 settings (admin). */
export function useEmailNotificationSettings(): UseQueryResult<EmailNotificationSettings> {
  return useQuery<EmailNotificationSettings>({
    queryKey: queryKeys.emailNotificationSettings(),
    queryFn: ({ signal }) => emailNotificationSettingsApi.get(signal),
  });
}

/** Persist a partial 邮件提醒 update (admin). */
export function useUpdateEmailNotificationSettings(): UseMutationResult<
  EmailNotificationSettings,
  Error,
  UpdateEmailNotificationSettingsInput
> {
  const queryClient = useQueryClient();
  return useMutation<EmailNotificationSettings, Error, UpdateEmailNotificationSettingsInput>({
    mutationFn: (input) => emailNotificationSettingsApi.update(input),
    onSuccess: (settings) => {
      queryClient.setQueryData<EmailNotificationSettings>(
        queryKeys.emailNotificationSettings(),
        settings,
      );
    },
  });
}
