import { z } from "zod";

import { generateBillSchema } from "@ros/contracts/billing";
import { billListQuerySchema } from "@ros/contracts/billing-extra";
import { billingService } from "@/composition/billing";
import { route } from "@ros/application/http/route";

const params = z.object({ branchId: z.uuid() });

/** List bills of a branch (bills.view). Filters: paymentStatus, status, from/to (branch-local dates). */
export const GET = route(
  { auth: "user", params, query: billListQuerySchema },
  async ({ actor, params, query, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await billingService(c).list(scope, query) };
  },
);

/** Generate (issue) the bill for a table session (bills.generate; idempotent). */
export const POST = route(
  {
    auth: "user",
    params,
    body: generateBillSchema,
    idempotency: ({ params }) => `bill:${params.branchId}`,
  },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    const { bill, created } = await billingService(c).generate(scope, body, meta);
    return { status: created ? 201 : 200, data: bill };
  },
);
