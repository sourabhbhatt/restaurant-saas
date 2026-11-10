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
 * GET /api/v1/public/plans on the internal API. Throws on an error status, a
 * body that is not the plans contract, a network failure or a timeout.
 */
export async function requestPublicPlans(
  apiBase: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<ServerPlans> {
  const fetchImpl = options.fetch ?? fetch;
  const res = await fetchImpl(`${apiBase.replace(/\/$/, "")}/api/v1/public/plans`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GET /public/plans answered ${res.status}`);
  const body = (await res.json()) as { data?: unknown };
  return { data: parsePublicPlans(body.data), fetchedAt: Date.now() };
}

/**
 * Public plans fetched from the API on the server and cached for a minute, so
 * pricing is part of the HTML (search engines and AI crawlers that do not run
 * JavaScript see real prices) and the structured data matches what is shown.
 * Errors are thrown, so they are not cached.
 */
async function fetchPublicPlans(apiBase: string): Promise<ServerPlans> {
  "use cache";
  cacheLife("minutes");
  return requestPublicPlans(apiBase);
}

/**
 * Call at request time only (after `connection()`). Null when the API is
 * unavailable: the page still renders and the plans load in the browser.
 */
export async function loadPublicPlans(): Promise<ServerPlans | null> {
  try {
    return await fetchPublicPlans(process.env.API_INTERNAL_URL || DEFAULT_API_INTERNAL_URL);
  } catch {
    return null;
  }
}
