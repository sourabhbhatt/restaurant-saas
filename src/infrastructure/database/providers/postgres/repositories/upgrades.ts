import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { UpgradeRepository, UpgradeRow } from "@/server/modules/platform/ports";

import type { Executor } from "../client";
import {
  subscriptionPlans,
  upgradeRequestEvents,
  upgradeRequests,
  users,
  workspaces,
} from "../schema";

const escapeLike = (v: string) => `%${v.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export function upgradeRepository(db: Executor): UpgradeRepository {
  const requester = alias(users, "requester");
  const decider = alias(users, "decider");
  const currentPlan = alias(subscriptionPlans, "current_plan");
  const requestedPlan = alias(subscriptionPlans, "requested_plan");

  const select = () =>
    db
      .select({
        id: upgradeRequests.id,
        workspaceId: upgradeRequests.workspaceId,
        workspaceName: workspaces.name,
        requestedById: upgradeRequests.requestedBy,
        requestedByName: requester.name,
        requestedByEmail: requester.email,
        currentPlanId: upgradeRequests.currentPlanId,
        currentPlanKey: currentPlan.key,
        currentPlanName: currentPlan.name,
        requestedPlanId: upgradeRequests.requestedPlanId,
        requestedPlanKey: requestedPlan.key,
        requestedPlanName: requestedPlan.name,
        requestedPlanMonthlyPrice: requestedPlan.monthlyPrice,
        requestedPlanCurrency: requestedPlan.currency,
        billingCycle: upgradeRequests.billingCycle,
        message: upgradeRequests.message,
        status: upgradeRequests.status,
        decidedByName: decider.name,
        decidedAt: upgradeRequests.decidedAt,
        decisionReason: upgradeRequests.decisionReason,
        createdAt: upgradeRequests.createdAt,
      })
      .from(upgradeRequests)
      .innerJoin(workspaces, eq(workspaces.id, upgradeRequests.workspaceId))
      .innerJoin(requestedPlan, eq(requestedPlan.id, upgradeRequests.requestedPlanId))
      .leftJoin(currentPlan, eq(currentPlan.id, upgradeRequests.currentPlanId))
      .leftJoin(requester, eq(requester.id, upgradeRequests.requestedBy))
      .leftJoin(decider, eq(decider.id, upgradeRequests.decidedBy));

  return {
    async insertUpgradeRequest(input) {
      const [row] = await db
        .insert(upgradeRequests)
        .values({ ...input, status: "PENDING" })
        .returning({ id: upgradeRequests.id });
      return row!.id;
    },
    async findUpgradeRequest(requestId) {
      const [row] = await select().where(eq(upgradeRequests.id, requestId)).limit(1);
      return (row as UpgradeRow | undefined) ?? null;
    },
    async listUpgradeRequests(filter) {
      const conditions: (SQL | undefined)[] = [
        filter.workspaceId ? eq(upgradeRequests.workspaceId, filter.workspaceId) : undefined,
        filter.status ? eq(upgradeRequests.status, filter.status) : undefined,
        filter.search
          ? or(
              ilike(workspaces.name, escapeLike(filter.search)),
              ilike(requester.email, escapeLike(filter.search)),
              ilike(requester.name, escapeLike(filter.search)),
            )
          : undefined,
      ];
      const where = and(...conditions);
      const rows = await select()
        .where(where)
        .orderBy(
          // Pending first (oldest waiting longest), then newest decided.
          sql`case when ${upgradeRequests.status} = 'PENDING' then 0 else 1 end`,
          asc(
            sql`case when ${upgradeRequests.status} = 'PENDING' then ${upgradeRequests.createdAt} end`,
          ),
          desc(upgradeRequests.createdAt),
        )
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize);
      const [total] = await db
        .select({ n: count() })
        .from(upgradeRequests)
        .innerJoin(workspaces, eq(workspaces.id, upgradeRequests.workspaceId))
        .leftJoin(requester, eq(requester.id, upgradeRequests.requestedBy))
        .where(where);
      return { rows: rows as UpgradeRow[], total: total?.n ?? 0 };
    },
    async countPendingUpgradeRequests() {
      const [row] = await db
        .select({ n: count() })
        .from(upgradeRequests)
        .where(eq(upgradeRequests.status, "PENDING"));
      return row?.n ?? 0;
    },
    async decideUpgradeRequest(input) {
      const rows = await db
        .update(upgradeRequests)
        .set({
          status: input.status,
          decidedBy: input.decidedBy,
          decidedAt: input.decidedAt,
          decisionReason: input.reason,
          appliedSubscriptionId: input.appliedSubscriptionId,
        })
        .where(and(eq(upgradeRequests.id, input.requestId), eq(upgradeRequests.status, "PENDING")))
        .returning({ id: upgradeRequests.id });
      return rows.length > 0;
    },
    async insertUpgradeEvent(input) {
      await db.insert(upgradeRequestEvents).values(input);
    },
    async listUpgradeEvents(requestId) {
      return db
        .select({
          id: upgradeRequestEvents.id,
          type: upgradeRequestEvents.type,
          actorName: users.name,
          body: upgradeRequestEvents.body,
          createdAt: upgradeRequestEvents.createdAt,
        })
        .from(upgradeRequestEvents)
        .leftJoin(users, eq(users.id, upgradeRequestEvents.actorUserId))
        .where(eq(upgradeRequestEvents.requestId, requestId))
        .orderBy(asc(upgradeRequestEvents.createdAt));
    },
  };
}
