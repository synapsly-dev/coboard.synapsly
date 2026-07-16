import Taro from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { queryKeys } from 'client-core';
import type { User } from 'shared';
import type { MiniappAuthExchangeResponse } from 'shared';
import { coboardClient } from '../platform/coboard-client';
import { sessionStore } from '../platform/session';
import { queryClient } from './query';

export function useCurrentUser(): ReturnType<typeof useQuery<User>> {
  const token = useSessionToken();
  return useQuery<User>({
    queryKey: queryKeys.me(),
    enabled: token !== null,
    queryFn: async () => {
      const response = await coboardClient.auth.me();
      return response.user;
    },
  });
}

export function useSessionToken(): string | null {
  const [token, setToken] = useState(() => sessionStore.token());
  useEffect(() => sessionStore.subscribe(() => setToken(sessionStore.token())), []);
  return token;
}

export function acceptNativeSession(response: MiniappAuthExchangeResponse): void {
  sessionStore.set({ token: response.token, expiresAt: response.expiresAt });
  // Drop any anonymous/expired-session cache entries before hydrating the new identity.
  queryClient.clear();
  queryClient.setQueryData(queryKeys.me(), response.user);
}

export async function logout(): Promise<void> {
  try {
    await coboardClient.auth.logout();
  } finally {
    sessionStore.clear();
    queryClient.clear();
  }
}

export function requireSession(): boolean {
  if (sessionStore.token()) return true;
  void Taro.showModal({
    title: '尚未登录',
    content: '请先在“我的”页面使用 Syna ID 登录。',
    showCancel: false,
  });
  return false;
}
