import { QueryClient } from '@tanstack/react-query';
import { isCoboardClientError } from 'client-core';
import { ensureAbortController } from '../platform/abort-controller';

ensureAbortController();

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

// TanStack Query detects the WeChat logic layer as a server environment because
// it has no browser `window`, so an observer can mount without running queryFn.
// Once the observer is committed, explicitly start its first active request.
queryClient.getQueryCache().subscribe((event) => {
  if (
    event.type === 'observerAdded' &&
    event.query.isActive() &&
    event.query.state.status === 'pending' &&
    event.query.state.fetchStatus === 'idle'
  ) {
    setTimeout(() => {
      if (event.query.isActive() && event.query.state.status === 'pending') {
        void event.query.fetch();
      }
    }, 0);
  }
});



