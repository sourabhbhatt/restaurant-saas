import { z } from "zod";

import { tableService } from "@/composition/tables";
import { route } from "@ros/application/http/route";

const params = z.object({ tableId: z.uuid() });

/** Current QR `{ url, svg, createdAt }`. `tables.manage` */
export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const svc = tableService(c);
  const scope = await svc.scopeForTable(actor, params.tableId);
  return { data: await svc.getQr(scope, params.tableId) };
});

/** Generate or regenerate (revokes the previous active token). */
export const POST = route({ auth: "user", params }, async ({ actor, params, meta, c }) => {
  const svc = tableService(c);
  const scope = await svc.scopeForTable(actor, params.tableId);
  return { status: 201, data: await svc.generateQr(scope, params.tableId, meta) };
});

/** Revoke: printed codes stop working immediately. */
export const DELETE = route({ auth: "user", params }, async ({ actor, params, meta, c }) => {
  const svc = tableService(c);
  const scope = await svc.scopeForTable(actor, params.tableId);
  return { data: await svc.revokeQr(scope, params.tableId, meta) };
});
