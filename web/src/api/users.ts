import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  AuthUserResponse,
  CreateUserInput,
  UpdateUserInput,
  User,
  UsersListResponse,
  UserWithProjects,
} from 'shared';
import { api } from './client';
import { queryKeys } from '../lib/query';

/**
 * User-administration data hooks (§7 GET/POST /users, PATCH /users/:id; §6.3).
 *
 * These are admin-only on the server; the front end additionally hides the admin
 * console from non-admins (§6.3 — UX only, not a security boundary).
 *
 * Conventions mirror the rest of `api/*`:
 * - Low-level fetchers live on {@link usersApi}; hooks compose them.
 * - Mutations invalidate `queryKeys.users()` on success so the table refreshes.
 *   (The users domain is admin-local and not part of the SSE project fan-out.)
 */

/** Low-level fetchers — shared by hooks and mutation refetch/invalidation. */
export const usersApi = {
  list: (signal?: AbortSignal): Promise<UsersListResponse> =>
    api.get<UsersListResponse>('/users', { signal }),
  create: (input: CreateUserInput): Promise<AuthUserResponse> =>
    api.post<AuthUserResponse>('/users', input),
  update: (id: string, input: UpdateUserInput): Promise<AuthUserResponse> =>
    api.patch<AuthUserResponse>(`/users/${id}`, input),
};

/**
 * All accounts (admin only) — §7 GET /users. Each user carries their project
 * memberships (`projects`), so the admin console can show per-user project chips
 * and flag orphaned accounts (§6.3).
 */
export function useUsers(): UseQueryResult<UserWithProjects[]> {
  return useQuery<UserWithProjects[]>({
    queryKey: queryKeys.users(),
    queryFn: async ({ signal }) => {
      const res = await usersApi.list(signal);
      return res.users;
    },
  });
}

/** Create an account with an initial password (admin) — §7 POST /users. */
export function useCreateUser(): UseMutationResult<User, Error, CreateUserInput> {
  const queryClient = useQueryClient();
  return useMutation<User, Error, CreateUserInput>({
    mutationFn: async (input) => {
      const res = await usersApi.create(input);
      return res.user;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users() });
    },
  });
}

interface UpdateUserVariables {
  id: string;
  input: UpdateUserInput;
}

/** Edit a user's name / role / active state (admin) — §7 PATCH /users/:id. */
export function useUpdateUser(): UseMutationResult<User, Error, UpdateUserVariables> {
  const queryClient = useQueryClient();
  return useMutation<User, Error, UpdateUserVariables>({
    mutationFn: async ({ id, input }) => {
      const res = await usersApi.update(id, input);
      return res.user;
    },
    onSuccess: (user) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users() });
      // If an admin edits their own account (e.g. renames), keep `me` in sync.
      queryClient.setQueryData<User | null>(queryKeys.me(), (prev) =>
        prev && prev.id === user.id ? user : prev,
      );
    },
  });
}
