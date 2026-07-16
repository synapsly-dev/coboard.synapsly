import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  NotificationCounts,
  NotificationPreferencesResponse,
  NotificationsResponse,
  SetNotificationPreferenceInput,
} from 'shared';
import { queryKeys, type NotificationFilter } from 'client-core';
import { coboardClient } from '../platform/coboard-client';

export type { NotificationFilter } from 'client-core';

export function useNotifications(
  filter: NotificationFilter = 'all',
  limit = 30,
): UseQueryResult<NotificationsResponse> {
  return useQuery({
    queryKey: queryKeys.notifications(filter),
    queryFn: ({ signal }) => coboardClient.notifications.list(filter, limit, undefined, signal),
  });
}

export function useInfiniteNotifications(filter: NotificationFilter = 'all', limit = 30) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.notifications(filter), 'infinite'],
    queryFn: ({ pageParam, signal }) =>
      coboardClient.notifications.list(filter, limit, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useNotificationCounts(): UseQueryResult<NotificationCounts> {
  return useQuery({
    queryKey: queryKeys.notificationCounts(),
    queryFn: async ({ signal }) => (await coboardClient.notifications.counts(signal)).counts,
  });
}

export function useNotificationPreferences(): UseQueryResult<NotificationPreferencesResponse> {
  return useQuery({
    queryKey: queryKeys.notificationPreferences(),
    queryFn: ({ signal }) => coboardClient.notifications.preferences(signal),
  });
}

function useNotificationMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<void>,
): UseMutationResult<void, Error, TVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkNotificationRead(): UseMutationResult<void, Error, string> {
  return useNotificationMutation((id) => coboardClient.notifications.read(id));
}

export function useMarkAllNotificationsRead(): UseMutationResult<void, Error, void> {
  return useNotificationMutation(() => coboardClient.notifications.readAll());
}

export function useArchiveNotification(): UseMutationResult<void, Error, string> {
  return useNotificationMutation((id) => coboardClient.notifications.archive(id));
}

export function useSetNotificationPreference(): UseMutationResult<
  void,
  Error,
  SetNotificationPreferenceInput
> {
  return useNotificationMutation((input) => coboardClient.notifications.setPreference(input));
}
