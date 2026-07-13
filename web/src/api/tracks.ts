import { useMemo } from 'react';
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
  TrackMemberCandidatesResponse,
  TrackResponse,
  TracksResponse,
  UpdateTrackInput,
  UserSummary,
} from 'shared';
import { api } from './client';
import { queryKeys } from '../lib/query';
import { useAuth } from '../lib/auth-context';

/**
 * Track (赛道, P0 §2) data + mutation hooks. A 赛道 is the top operational grouping
 * above projects, carrying 赛道运营经理(managers) + members. The listing is readable
 * by any logged-in user; create / edit / delete are global-admin only, while a
 * track's current managers may also edit that track's roster (enforced server-side).
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
  memberCandidates: (id: string, signal?: AbortSignal): Promise<TrackMemberCandidatesResponse> =>
    api.get<TrackMemberCandidatesResponse>(`/tracks/${id}/member-candidates`, { signal }),
  setMembers: (id: string, input: SetTrackMembersInput): Promise<TrackResponse> =>
    api.put<TrackResponse>(`/tracks/${id}/members`, input),
  join: (id: string): Promise<TrackResponse> => api.post<TrackResponse>(`/tracks/${id}/join`),
  leave: (id: string): Promise<TrackResponse> => api.post<TrackResponse>(`/tracks/${id}/leave`),
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

/** Active users available to a global admin or this track's current manager. */
export function useTrackMemberCandidates(
  trackId: string | null,
  enabled: boolean,
): UseQueryResult<UserSummary[]> {
  return useQuery<UserSummary[]>({
    queryKey: queryKeys.trackMemberCandidates(trackId ?? 'none'),
    queryFn: async ({ signal }) => {
      if (trackId === null) return [];
      return (await tracksApi.memberCandidates(trackId, signal)).users;
    },
    enabled: enabled && trackId !== null,
  });
}

/**
 * The non-archived tracks a user manages (赛道运营经理). Pure helper behind the
 * manager-scoped affordances (e.g. the 「新建项目」 赛道 picker, spec 2026-07-11 §2)
 * — the server remains the real gate for the actual operations.
 */
export function managedActiveTracks(
  tracks: readonly Track[] | undefined,
  userId: string | undefined,
): Track[] {
  if (!tracks || !userId) return [];
  return tracks.filter((t) => !t.archived && t.managers.some((m) => m.userId === userId));
}

/**
 * Client-side heuristic: is the current user a 赛道运营经理 on ANY track? Used to
 * decide whether to SHOW manager-tier affordances (资产 edit/delete menu, 统计
 * 导出下拉, P3) — the server remains the real gate for the actual operations.
 */
export function useIsAnyTrackManager(): boolean {
  const { user } = useAuth();
  const { data: tracks } = useTracks();
  return useMemo(() => {
    if (!user || !tracks) return false;
    return tracks.some((t) => t.managers.some((m) => m.userId === user.id));
  }, [tracks, user]);
}

// ---------------------------------------------------------------------------
// Mutations — track management (structural writes are admin-only; roster writes
// also permit a current manager of that track) (P0 §2, §3)
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgTree('all') });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgTree('all') });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgTree('all') });
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgTree('all') });
    },
  });
}

/** Join an active Track as the current user. */
export function useJoinTrack(): UseMutationResult<Track, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<Track, Error, string>({
    mutationFn: async (id) => (await tracksApi.join(id)).track,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tracks() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgTree('all') });
    },
  });
}

/** Leave a Track as the current user; managers are rejected by the server. */
export function useLeaveTrack(): UseMutationResult<Track, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<Track, Error, string>({
    mutationFn: async (id) => (await tracksApi.leave(id)).track,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tracks() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgTree('all') });
    },
  });
}
