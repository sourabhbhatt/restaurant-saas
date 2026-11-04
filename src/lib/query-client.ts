import { QueryClient } from "@tanstack/react-query";

/**
 * Server state cache defaults for an offline-first app.
 *
 * `offlineFirst` runs a query once (so the service worker / local cache can answer)
 * and only pauses retries when the device is offline, instead of failing immediately.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "offlineFirst",
        staleTime: 30_000,
        gcTime: 24 * 60 * 60_000,
        retry: 2,
        refetchOnWindowFocus: true,
      },
      mutations: {
        networkMode: "offlineFirst",
        retry: 0,
      },
    },
  });
}
