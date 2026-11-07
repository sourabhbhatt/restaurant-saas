import { connection } from "next/server";

/** Liveness probe for the container HEALTHCHECK and the load balancer. */
export async function GET() {
  // Rendered per request so APP_VERSION comes from the runtime environment.
  await connection();
  return Response.json({ status: "ok", version: process.env.APP_VERSION ?? "dev" });
}
