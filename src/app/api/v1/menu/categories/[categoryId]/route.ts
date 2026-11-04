import { z } from "zod";

import { updateCategorySchema } from "@/contracts/menu";
import { menuService } from "@/server/composition/menu";
import { route } from "@/server/http/route";

const params = z.object({ categoryId: z.uuid() });

/** Edit name/description/visibility; `sortOrder` moves the category to that position. */
export const PATCH = route(
  { auth: "user", params, body: updateCategorySchema },
  async ({ actor, params, body, meta, c }) => {
    const svc = menuService(c);
    const scope = await svc.scopeForCategory(actor, params.categoryId);
    return { data: await svc.updateCategory(scope, params.categoryId, body, meta) };
  },
);

export const DELETE = route({ auth: "user", params }, async ({ actor, params, meta, c }) => {
  const svc = menuService(c);
  const scope = await svc.scopeForCategory(actor, params.categoryId);
  await svc.deleteCategory(scope, params.categoryId, meta);
  return { data: { id: params.categoryId, deleted: true } };
});
