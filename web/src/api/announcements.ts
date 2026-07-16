import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { Announcement, CreateAnnouncementInput, UpdateAnnouncementInput } from 'shared';
import { queryKeys } from 'client-core';
import { coboardClient } from '../platform/coboard-client';

/**
 * Announcement / 信息 hooks. Every logged-in user can read the list; create/edit/
 * delete are admin-only (the server re-enforces it, the UI hides the controls).
 * Mutations invalidate the list, and SSE refreshes peers via the `announcement`
 * channel (§6.5).
 */

/** All notices, newest first (§ GET /announcements). */
export function useAnnouncements(): UseQueryResult<Announcement[]> {
  return useQuery<Announcement[]>({
    queryKey: queryKeys.announcements(),
    queryFn: async ({ signal }) => (await coboardClient.announcements.list(signal)).announcements,
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
    mutationFn: async (input) => (await coboardClient.announcements.create(input)).announcement,
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
    mutationFn: async ({ id, input }) =>
      (await coboardClient.announcements.update(id, input)).announcement,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.announcements() });
    },
  });
}

/** Delete a notice (admin). */
export function useDeleteAnnouncement(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => coboardClient.announcements.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.announcements() });
    },
  });
}
