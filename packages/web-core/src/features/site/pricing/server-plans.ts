import { cacheLife } from "next/cache";

import { DEFAULT_API_INTERNAL_URL } from "../../../api-proxy";
import { parsePublicPlans, type PublicPlans } from "./plan-model";

export interface ServerPlans {
  data: PublicPlans;
  /** When the API answered, for the client query's `initialDataUpdatedAt`. */
  fetchedAt: number;
}

const TIMEOUT_MS = 3_000;

/**
 * Public plans fetched from the API on the server and cached for a minute, so
 * pricing is part of the HTML (search engines and AI crawlers that do not run
 * JavaScript see real prices) and the structured data matches what is shown.
 * Errors are not cached: the caller falls back to the client-side fetch.
 */
async function fetchPublicPlans(apiBase: string): Promise<ServerPlans> {
  "use cache";
  cacheLife("minutes");
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/v1/public/plans`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET /public/plans answered ${res.status}`);
  const body = (await res.json()) as { data?: unknown };
  return { data: parsePublicPlans(body.data), fetchedAt: Date.now() };
}

/** Call at request time only (after `connection()`); null when the API is unavailable. */
export async function loadPublicPlans(): Promise<ServerPlans | null> {
  try {
    return await fetchPublicPlans(process.env.API_INTERNAL_URL || DEFAULT_API_INTERNAL_URL);
  } catch {
    return null;
  }
}
