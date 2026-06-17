import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  Announcement,
  AnnouncementResponse,
  AnnouncementsResponse,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
} from 'shared';
import { api } from './client';
import { queryKeys } from '../lib/query';

/**
 * Announcement / 信息 hooks. Every logged-in user can read the list; create/edit/
 * delete are admin-only (the server re-enforces it, the UI hides the controls).
 * Mutations invalidate the list, and SSE refreshes peers via the `announcement`
 * channel (§6.5).
 */

export const announcementsApi = {
  list: (signal?: AbortSignal): Promise<AnnouncementsResponse> =>
    api.get<AnnouncementsResponse>('/announcements', { signal }),
  create: (input: CreateAnnouncementInput): Promise<AnnouncementResponse> =>
    api.post<AnnouncementResponse>('/announcements', input),
  update: (id: string, input: UpdateAnnouncementInput): Promise<AnnouncementResponse> =>
    api.patch<AnnouncementResponse>(`/announcements/${id}`, input),
  remove: (id: string): Promise<void> => api.delete<void>(`/announcements/${id}`),
};

/** All notices, newest first (§ GET /announcements). */
export function useAnnouncements(): UseQueryResult<Announcement[]> {
  return useQuery<Announcement[]>({
    queryKey: queryKeys.announcements(),
    queryFn: async ({ signal }) => (await announcementsApi.list(signal)).announcements,
  });
}

/** Publish a notice (admin). */
export function useCreateAnnouncement(): UseMutationResult<
  Announcement,
  Error,
  CreateAnnouncementInput
> {
  const queryClient = useQueryClient();
  return useMutation<Announcement, Error, CreateAnnouncementInput>({
    mutationFn: async (input) => (await announcementsApi.create(input)).announcement,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.announcements() });
    },
  });
}

/** Variables for an announcement edit. */
export interface UpdateAnnouncementVars {
  id: string;
  input: UpdateAnnouncementInput;
}

/** Edit a notice (admin). */
export function useUpdateAnnouncement(): UseMutationResult<
  Announcement,
  Error,
  UpdateAnnouncementVars
> {
  const queryClient = useQueryClient();
  return useMutation<Announcement, Error, UpdateAnnouncementVars>({
    mutationFn: async ({ id, input }) => (await announcementsApi.update(id, input)).announcement,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.announcements() });
    },
  });
}

/** Delete a notice (admin). */
export function useDeleteAnnouncement(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => announcementsApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.announcements() });
    },
  });
}
