import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAdminRole } from 'shared';
import type {
  AuthUserResponse,
  CompleteJoinInput,
  DevLoginInput,
  UpdateProfileInput,
  User,
} from 'shared';
import { api, isApiClientError } from '../api/client';
import { queryKeys } from './query';

/**
 * Auth context. Source of truth for the current session: a TanStack query against
 * `GET /auth/me`. Identity now comes from Synapsly ID SSO — `loginWithSynapsly`
 * hands off to the server-driven OIDC flow (a full-page redirect), while
 * `completeJoin` finishes first-time provisioning and `devLogin` is the local
 * escape hatch. `logout` clears the local session and, when single logout is on,
 * follows the server-provided end-session URL.
 */

interface AuthContextValue {
  user: User | null;
  /** True while the initial `me` query is in flight. */
  loading: boolean;
  /** True once the `me` query has settled (success or known-unauthenticated). */
  isAuthenticated: boolean;
  /** Begin Synapsly ID SSO by navigating to the server start endpoint. */
  loginWithSynapsly: (returnTo?: string) => void;
  /** Finish first-time member provisioning with the admin invite code. */
  completeJoin: (input: CompleteJoinInput) => Promise<User>;
  /** Local dev fake-login (only works when the server has DEV_LOGIN enabled). */
  devLogin: (input: DevLoginInput) => Promise<User>;
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

  const loginWithSynapsly = useCallback((returnTo?: string): void => {
    // Full-page navigation into the server-driven OIDC flow. The `?returnTo`
    // lands the user back where they came from after login.
    const suffix = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
    window.location.assign(`/api/auth/synapsly/start${suffix}`);
  }, []);

  const completeJoin = useCallback(
    async (input: CompleteJoinInput): Promise<User> => {
      const res = await api.post<AuthUserResponse>(
        '/auth/synapsly/complete-join',
        input,
      );
      queryClient.setQueryData(queryKeys.me(), res.user);
      return res.user;
    },
    [queryClient],
  );

  const devLogin = useCallback(
    async (input: DevLoginInput): Promise<User> => {
      const res = await api.post<AuthUserResponse>('/auth/dev-login', input);
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
    let endSessionUrl: string | undefined;
    // Never throw: a failed logout request must not block clearing local state.
    try {
      const res = await api.post<{ ok: true; endSessionUrl?: string }>('/auth/logout');
      endSessionUrl = res?.endSessionUrl;
    } catch {
      // ignore — the session is cleared locally below.
    }
    queryClient.setQueryData(queryKeys.me(), null);
    queryClient.removeQueries();
    // If the server asked for RP-initiated single logout, follow it so the
    // Synapsly session ends too; it redirects back to the app root.
    if (endSessionUrl) {
      window.location.assign(endSessionUrl);
    }
  }, [queryClient]);

  const user = meQuery.data ?? null;

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading: meQuery.isLoading,
      isAuthenticated: user !== null,
      isAdmin: isAdminRole(user?.role),
      loginWithSynapsly,
      completeJoin,
      devLogin,
      updateProfile,
      updateAvatar,
      removeAvatar,
      logout,
    }),
    [
      user,
      meQuery.isLoading,
      loginWithSynapsly,
      completeJoin,
      devLogin,
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
