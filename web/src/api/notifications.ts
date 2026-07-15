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
  NotificationCountsResponse,
  NotificationPreferencesResponse,
  NotificationsResponse,
  SetNotificationPreferenceInput,
} from 'shared';
import { queryKeys } from '../lib/query';
import { api } from './client';

export type NotificationFilter = 'all' | 'unread' | 'action';

export const notificationsApi = {
  list: (
    filter: NotificationFilter,
    limit: number,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<NotificationsResponse> =>
    api.get<NotificationsResponse>('/notifications', {
      query: { filter, limit, ...(cursor ? { cursor } : {}) },
      signal,
    }),
  counts: (signal?: AbortSignal): Promise<NotificationCountsResponse> =>
    api.get<NotificationCountsResponse>('/notifications/counts', { signal }),
  preferences: (signal?: AbortSignal): Promise<NotificationPreferencesResponse> =>
    api.get<NotificationPreferencesResponse>('/notifications/preferences', { signal }),
  setPreference: (input: SetNotificationPreferenceInput): Promise<void> =>
    api.put<void>('/notifications/preferences', input),
  read: (id: string): Promise<void> => api.post<void>(`/notifications/${id}/read`),
  readAll: (): Promise<void> => api.post<void>('/notifications/read-all'),
  archive: (id: string): Promise<void> => api.delete<void>(`/notifications/${id}`),
};

export function useNotifications(
  filter: NotificationFilter = 'all',
  limit = 30,
): UseQueryResult<NotificationsResponse> {
  return useQuery({
    queryKey: queryKeys.notifications(filter),
    queryFn: ({ signal }) => notificationsApi.list(filter, limit, undefined, signal),
  });
}

export function useInfiniteNotifications(filter: NotificationFilter = 'all', limit = 30) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.notifications(filter), 'infinite'],
    queryFn: ({ pageParam, signal }) => notificationsApi.list(filter, limit, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useNotificationCounts(): UseQueryResult<NotificationCounts> {
  return useQuery({
    queryKey: queryKeys.notificationCounts(),
    queryFn: async ({ signal }) => (await notificationsApi.counts(signal)).counts,
  });
}

export function useNotificationPreferences(): UseQueryResult<NotificationPreferencesResponse> {
  return useQuery({
    queryKey: queryKeys.notificationPreferences(),
    queryFn: ({ signal }) => notificationsApi.preferences(signal),
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
  return useNotificationMutation((id) => notificationsApi.read(id));
}

export function useMarkAllNotificationsRead(): UseMutationResult<void, Error, void> {
  return useNotificationMutation(() => notificationsApi.readAll());
}

export function useArchiveNotification(): UseMutationResult<void, Error, string> {
  return useNotificationMutation((id) => notificationsApi.archive(id));
}

export function useSetNotificationPreference(): UseMutationResult<
  void,
  Error,
  SetNotificationPreferenceInput
> {
  return useNotificationMutation((input) => notificationsApi.setPreference(input));
}
