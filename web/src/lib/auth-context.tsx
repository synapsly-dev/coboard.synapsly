import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuthUserResponse,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
  User,
} from 'shared';
import { api, isApiClientError } from '../api/client';
import { queryKeys } from './query';

/**
 * Auth context (§8). Source of truth for the current session: a TanStack query
 * against `GET /api/auth/me`. `login`/`logout` call the API then sync the cache,
 * so the whole tree re-renders with the new auth state. A 401 from `me` simply
 * means "not logged in" (user = null), not an error to surface.
 */

interface AuthContextValue {
  user: User | null;
  /** True while the initial `me` query is in flight. */
  loading: boolean;
  /** True once the `me` query has settled (success or known-unauthenticated). */
  isAuthenticated: boolean;
  login: (input: LoginInput) => Promise<User>;
  /** Self-register a member account; logs in on success (§8). */
  register: (input: RegisterInput) => Promise<User>;
  /** Update the current user's own profile (e.g. display name). */
  updateProfile: (input: UpdateProfileInput) => Promise<User>;
  /** Upload the current user's avatar (a `data:image/...;base64,...` URL). */
  updateAvatar: (image: string) => Promise<User>;
  /** Remove the current user's avatar. */
  removeAvatar: () => Promise<User>;
  logout: () => Promise<void>;
  /** Convenience: is the current user a global admin (§6.3). */
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<User | null> {
  try {
    const res = await api.get<AuthUserResponse>('/auth/me');
    return res.user;
  } catch (err) {
    // Not logged in is an expected state, not a failure.
    if (isApiClientError(err) && err.isUnauthorized) {
      return null;
    }
    throw err;
  }
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const queryClient = useQueryClient();

  const meQuery = useQuery<User | null>({
    queryKey: queryKeys.me(),
    queryFn: fetchMe,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const login = useCallback(
    async (input: LoginInput): Promise<User> => {
      const res = await api.post<AuthUserResponse>('/auth/login', input);
      queryClient.setQueryData(queryKeys.me(), res.user);
      return res.user;
    },
    [queryClient],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<User> => {
      // The server creates a member, mints a session cookie, and returns the
      // user. Prime the `me` cache so the app reflects the new session at once.
      const res = await api.post<AuthUserResponse>('/auth/register', input);
      queryClient.setQueryData(queryKeys.me(), res.user);
      return res.user;
    },
    [queryClient],
  );

  const updateProfile = useCallback(
    async (input: UpdateProfileInput): Promise<User> => {
      const res = await api.patch<AuthUserResponse>('/auth/profile', input);
      queryClient.setQueryData(queryKeys.me(), res.user);
      return res.user;
    },
    [queryClient],
  );

  const updateAvatar = useCallback(
    async (image: string): Promise<User> => {
      const res = await api.post<AuthUserResponse>('/auth/avatar', { image });
      queryClient.setQueryData(queryKeys.me(), res.user);
      return res.user;
    },
    [queryClient],
  );

  const removeAvatar = useCallback(async (): Promise<User> => {
    const res = await api.delete<AuthUserResponse>('/auth/avatar');
    queryClient.setQueryData(queryKeys.me(), res.user);
    return res.user;
  }, [queryClient]);

  const logout = useCallback(async (): Promise<void> => {
    // Never throw: a failed logout request must not block clearing local state
    // (callers navigate to /login afterwards regardless).
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore — the session is cleared locally below.
    }
    // Drop the session and remove all cached (now-stale) data WITHOUT triggering
    // a refetch storm that could hang the caller's `await`.
    queryClient.setQueryData(queryKeys.me(), null);
    queryClient.removeQueries();
  }, [queryClient]);

  const user = meQuery.data ?? null;

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading: meQuery.isLoading,
      isAuthenticated: user !== null,
      isAdmin: user?.role === 'admin',
      login,
      register,
      updateProfile,
      updateAvatar,
      removeAvatar,
      logout,
    }),
    [
      user,
      meQuery.isLoading,
      login,
      register,
      updateProfile,
      updateAvatar,
      removeAvatar,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access the auth context. Throws if used outside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 <AuthProvider> 内部使用');
  }
  return ctx;
}
