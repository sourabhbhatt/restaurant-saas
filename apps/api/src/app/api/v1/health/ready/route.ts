import { getContainer, type Container } from "@/composition/container";
import { UNAVAILABLE_RETRY_AFTER_SECONDS } from "@ros/application/http/errors";
import { json, requestIdFrom } from "@ros/application/http/route";

/** Readiness: the database answers `select 1` and every migration is applied. */
export async function GET(req: Request): Promise<Response> {
  const requestId = requestIdFrom(req);
  let c: Container | null = null;
  let cause = "pending_migrations";
  let ready = false;
  try {
    c = await getContainer();
    ready = await c.isReady();
  } catch (error) {
    cause = String(error);
  }
  if (ready) return json(200, { data: { status: "ready" } }, requestId);
  // The cause stays in the server log; probes only need the status.
  if (c) c.logger.warn("not_ready", { requestId, cause });
  else console.warn(JSON.stringify({ level: "warn", msg: "not_ready", requestId, cause }));
  return json(
    503,
    {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "not ready",
        details: { retryAfterSeconds: UNAVAILABLE_RETRY_AFTER_SECONDS },
        requestId,
      },
    },
    requestId,
    { "retry-after": String(UNAVAILABLE_RETRY_AFTER_SECONDS) },
  );
}
