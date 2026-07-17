import Taro, { useDidShow } from '@tarojs/taro';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
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
  const readToken = useCallback(() => {
    return sessionStore.token();
  }, []);
  const [token, setToken] = useState(readToken);
  const sync = useCallback(() => setToken(readToken()), [readToken]);

  useEffect(() => {
    sync();
    return sessionStore.subscribe(sync);
  }, [sync]);
  useDidShow(sync);

  return token;
}

export function acceptNativeSession(response: MiniappAuthExchangeResponse): void {
  // Clear the previous identity before publishing the new token. Clearing after
  // sessionStore.set() cancels the queries that mounted pages start immediately.
  queryClient.clear();
  sessionStore.set({ token: response.token, expiresAt: response.expiresAt });
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
    content: '请先进入“更多 → 个人资料”登录；开发环境需填写与 Web 端完全相同的邮箱。',
    showCancel: false,
  });
  return false;
}
