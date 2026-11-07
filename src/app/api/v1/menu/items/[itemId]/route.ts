import { z } from "zod";

import { updateItemSchema } from "@ros/contracts/menu";
import { menuService } from "@/composition/menu";
import { route } from "@ros/application/http/route";

const params = z.object({ itemId: z.uuid() });

export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const svc = menuService(c);
  const scope = await svc.scopeForItem(actor, params.itemId);
  return { data: await svc.getItem(scope, params.itemId) };
});

/** Partial update; `variants` / `addonGroups` when present replace the nested lists. */
export const PATCH = route(
  { auth: "user", params, body: updateItemSchema },
  async ({ actor, params, body, meta, c }) => {
    const svc = menuService(c);
    const scope = await svc.scopeForItem(actor, params.itemId);
    return { data: await svc.updateItem(scope, params.itemId, body, meta) };
  },
);

/** Soft delete: historical orders keep their references. */
export const DELETE = route({ auth: "user", params }, async ({ actor, params, meta, c }) => {
  const svc = menuService(c);
  const scope = await svc.scopeForItem(actor, params.itemId);
  await svc.deleteItem(scope, params.itemId, meta);
  return { data: { id: params.itemId, deleted: true } };
});
