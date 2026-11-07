import { getContainer } from "@/server/container";
import { json, requestIdFrom } from "@/server/http/route";

/** Readiness: the database answers `select 1` and every migration is applied. */
export async function GET(req: Request): Promise<Response> {
  const requestId = requestIdFrom(req);
  let ready = false;
  try {
    ready = await (await getContainer()).isReady();
  } catch {
    // A database that cannot be reached is simply not ready; the probe retries.
  }
  if (ready) return json(200, { data: { status: "ready" } }, requestId);
  return json(
    503,
    { error: { code: "INTERNAL_ERROR", message: "not ready", requestId } },
    requestId,
  );
}
