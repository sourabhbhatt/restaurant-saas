import { getEnv } from "@ros/application/config/env";
import { json, requestIdFrom } from "@ros/application/http/route";

/** Liveness: answers without the container, so it never touches the database. */
export async function GET(req: Request): Promise<Response> {
  const requestId = requestIdFrom(req);
  return json(200, { data: { status: "ok", version: getEnv().APP_VERSION ?? "dev" } }, requestId);
}
