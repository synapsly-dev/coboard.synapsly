import { QueryClient } from '@tanstack/react-query';
import { isCoboardClientError } from 'client-core';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (count, error) =>
        !(isCoboardClientError(error) && error.status >= 400 && error.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});



