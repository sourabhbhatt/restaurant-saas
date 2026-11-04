import type { SyncPingDto } from "@/contracts/notifications-api";
import { route } from "@/server/http/route";

/**
 * Connectivity probe for the offline sync engine (navigator.onLine can report
 * "online" on a captive portal or dead Wi-Fi). Public and never cached.
 */
export const GET = route({ auth: "public" }, async ({ c }) => {
  const data: SyncPingDto = { ok: true, serverTime: c.clock.now().toISOString() };
  return { data };
});
