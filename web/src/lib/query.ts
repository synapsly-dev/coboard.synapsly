import { QueryClient } from '@tanstack/react-query';
import { isApiClientError } from '../api/client';
export { queryKeys } from 'client-core';

/** Browser QueryClient policy. Cache key vocabulary lives in client-core. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if (isApiClientError(error) && error.status >= 400 && error.status < 500) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});
