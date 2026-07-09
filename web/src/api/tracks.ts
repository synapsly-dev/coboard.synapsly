import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  CreateTrackInput,
  SetTrackMembersInput,
  Track,
  TrackResponse,
  TracksResponse,
  UpdateTrackInput,
} from 'shared';
import { api } from './client';
import { queryKeys } from '../lib/query';

/**
 * Track (赛道, P0 §2) data + mutation hooks. A 赛道 is the top operational grouping
 * above projects, carrying 赛道运营经理(managers) + members. The listing is readable
 * by any logged-in user; create / edit / delete / set-members are global-admin only
 * (enforced server-side, §3).
 *
 * Conventions mirror {@link projectsApi}:
 * - Low-level fetchers live on {@link tracksApi}; hooks compose them.
 * - Mutations invalidate `queryKeys.tracks()`; those that can change a project's
 *   owning track (or a track's projectCount) also invalidate `queryKeys.projects()`.
 *   SSE (`track` channel) refreshes peers too (§6.5).
 */

/** Low-level fetchers — shared by hooks and mutation onSuccess refetches. */
export const tracksApi = {
  list: (signal?: AbortSignal): Promise<TracksResponse> =>
    api.get<TracksResponse>('/tracks', { signal }),
  create: (input: CreateTrackInput): Promise<TrackResponse> =>
    api.post<TrackResponse>('/tracks', input),
  update: (id: string, input: UpdateTrackInput): Promise<TrackResponse> =>
    api.patch<TrackResponse>(`/tracks/${id}`, input),
  remove: (id: string): Promise<void> => api.delete<void>(`/tracks/${id}`),
  setMembers: (id: string, input: SetTrackMembersInput): Promise<TrackResponse> =>
    api.put<TrackResponse>(`/tracks/${id}/members`, input),
};

/** All tracks visible to the current user (§7 GET /tracks). */
export function useTracks(): UseQueryResult<Track[]> {
  return useQuery<Track[]>({
    queryKey: queryKeys.tracks(),
    queryFn: async ({ signal }) => {
      const res = await tracksApi.list(signal);
      return res.tracks;
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations — admin track management (P0 §2, §3)
// ---------------------------------------------------------------------------

/** Create a track (admin) — POST /tracks (409 on duplicate key). */
export function useCreateTrack(): UseMutationResult<Track, Error, CreateTrackInput> {
  const queryClient = useQueryClient();
  return useMutation<Track, Error, CreateTrackInput>({
    mutationFn: async (input) => {
      const res = await tracksApi.create(input);
      return res.track;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tracks() });
    },
  });
}

interface UpdateTrackVariables {
  id: string;
  input: UpdateTrackInput;
}

/** Edit / archive a track (admin) — PATCH /tracks/:id. */
export function useUpdateTrack(): UseMutationResult<Track, Error, UpdateTrackVariables> {
  const queryClient = useQueryClient();
  return useMutation<Track, Error, UpdateTrackVariables>({
    mutationFn: async ({ id, input }) => {
      const res = await tracksApi.update(id, input);
      return res.track;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tracks() });
    },
  });
}

/** Delete a track (admin) — DELETE /tracks/:id (409 if it still owns projects). */
export function useDeleteTrack(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (id) => tracksApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tracks() });
      // Deleting a track can change which track projects render under.
      void queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
    },
  });
}

interface SetTrackMembersVariables {
  id: string;
  input: SetTrackMembersInput;
}

/** Replace a track's 赛道运营经理(managers) + members — PUT /tracks/:id/members. */
export function useSetTrackMembers(): UseMutationResult<Track, Error, SetTrackMembersVariables> {
  const queryClient = useQueryClient();
  return useMutation<Track, Error, SetTrackMembersVariables>({
    mutationFn: async ({ id, input }) => {
      const res = await tracksApi.setMembers(id, input);
      return res.track;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tracks() });
    },
  });
}
