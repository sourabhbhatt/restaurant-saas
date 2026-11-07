import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "@ros/api-client";

/** Client errors (4xx) won't succeed on retry; network errors and 5xx might. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return error.status === 408 || error.status === 429 ? failureCount < 2 : false;
  }
  return failureCount < 2;
}

/**
 * Server state cache defaults for an offline-first app.
 *
 * `offlineFirst` runs a query once and only pauses retries when the device is
 * offline, instead of failing immediately. Selected queries are persisted to
 * IndexedDB by the offline layer (see `src/features/offline/persist-queries.ts`)
 * and restored on startup; `gcTime` keeps them in memory for a working day.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "offlineFirst",
        staleTime: 30_000,
        gcTime: 24 * 60 * 60_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        networkMode: "offlineFirst",
        retry: 0,
      },
    },
  });
}
