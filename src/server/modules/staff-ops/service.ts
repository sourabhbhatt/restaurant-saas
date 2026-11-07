import type { NotificationInput } from "@/contracts/notifications";
import type { OrderDto, OrderTransitionInput } from "@/contracts/orders";
import type {
  BranchSessionsDto,
  KitchenFeedDto,
  SessionDetailDto,
  StaffOrderListQuery,
} from "@/contracts/staff-ops";
import type { Permission } from "@/domain/access/permissions";
import {
  canTransitionItem,
  KITCHEN_STATUSES,
  nextOrderStatus,
  ORDER_TRANSITIONS,
  type OrderAction,
  type OrderItemStatus,
  type OrderPriority,
  type OrderStatus,
} from "@/domain/orders/order-status";
import { DomainError, forbidden, notFound } from "@/domain/shared/errors";
import { assertFeature } from "@/domain/subscriptions/entitlements";
import { deriveTableStatus } from "@/domain/tables/table-status";
import type { TransactionRunner } from "@/infrastructure/database/interfaces/transaction";
import type { RealtimePublisher } from "@/infrastructure/realtime/interfaces/realtime";

import { recordAudit } from "../../audit/audit-service";
import type { AccessService, BranchScope } from "../../authz/access-service";
import { auditActorFor, type RequestMeta, type UserActor } from "../../context";
import type { Clock, Logger } from "../../ports/observability";
import type { BranchTarget, OrderRecord, OrderTransitionPatch, StaffOpsRepos } from "./ports";

export interface StaffOpsServiceDeps {
  tx: TransactionRunner<StaffOpsRepos>;
  access: AccessService;
  clock: Clock;
  realtime: RealtimePublisher;
  logger?: Logger;
}

/** Recently finished tickets stay on the kitchen "Completed" tab this long. */
export const KITCHEN_RECENT_WINDOW_MS = 2 * 60 * 60_000;

const STALE_MESSAGE = "This order was already updated by someone else";

type StaffAction = Exclude<OrderAction, "complete">;

/** Item status each order transition moves the lines to (and from which states). */
const ITEM_EFFECT: Record<StaffAction, { to: OrderItemStatus; from?: readonly OrderItemStatus[] }> =
  {
    accept: { to: "PENDING", from: ["PENDING", "PREPARING", "READY"] },
    start: { to: "PREPARING", from: ["PENDING"] },
    ready: { to: "READY", from: ["PENDING", "PREPARING"] },
    serve: { to: "SERVED", from: ["PENDING", "PREPARING", "READY"] },
    reject: { to: "CANCELLED", from: ["PENDING", "PREPARING", "READY"] },
    cancel: { to: "CANCELLED", from: ["PENDING", "PREPARING", "READY"] },
  };

function targetOf(scope: BranchScope): BranchTarget {
  return {
    workspaceId: scope.workspaceId,
    restaurantId: scope.restaurantId,
    branchId: scope.branchId,
  };
}

function patchFor(action: StaffAction, now: Date, userId: string, reason: string | null) {
  const patch: OrderTransitionPatch = {};
  switch (action) {
    case "accept":
      patch.acceptedAt = now;
      patch.acceptedBy = userId;
      break;
    case "start":
      patch.preparingAt = now;
      break;
    case "ready":
      patch.readyAt = now;
      break;
    case "serve":
      patch.servedAt = now;
      patch.servedBy = userId;
      break;
    case "reject":
      patch.rejectedAt = now;
      patch.rejectionReason = reason ?? undefined;
      break;
    case "cancel":
      patch.cancelledAt = now;
      patch.cancellationReason = reason ?? undefined;
      break;
  }
  return patch;
}

/** Require the first permission the actor holds out of several alternatives. */
function requireAny(scope: BranchScope, permissions: readonly Permission[]): Permission {
  const held = permissions.find((p) => scope.can(p));
  if (!held) throw forbidden();
  scope.require(held);
  return held;
}

interface ChangedOrder {
  orderId: string;
  orderNumber: number;
  sessionId: string;
  tableId: string;
  status: OrderStatus;
  action: string;
}

export function createStaffOpsService(deps: StaffOpsServiceDeps) {
  const { tx, access, clock, realtime, logger } = deps;

  /** Realtime is a refetch hint; failures never affect the committed change. */
  async function publish(branchId: string, changes: ChangedOrder[]): Promise<void> {
    for (const ch of changes) {
      const event = {
        type: "order.updated",
        data: {
          orderId: ch.orderId,
          orderNumber: ch.orderNumber,
          status: ch.status,
          action: ch.action,
          sessionId: ch.sessionId,
          tableId: ch.tableId,
        },
      };
      try {
        await realtime.publish(`branch:${branchId}`, event);
        await realtime.publish(`session:${ch.sessionId}`, event);
      } catch (error) {
        logger?.warn("realtime_publish_failed", { branchId, error: String(error) });
      }
    }
  }

  /**
   * Resolve the branch scope for an order. The order's branch is looked up
   * first, then the actor is authorized against that branch; an order the
   * actor cannot see is reported as not found (no cross-tenant probing).
   */
  async function scopeForOrder(actor: UserActor, orderId: string): Promise<BranchScope> {
    const branchId = await tx.read((r) => r.staffOps.findOrderBranchId(orderId));
    if (!branchId) throw notFound("Order");
    try {
      return await access.forBranch(actor, branchId);
    } catch (error) {
      if (error instanceof DomainError && error.code === "NOT_FOUND") throw notFound("Order");
      throw error;
    }
  }

  /**
   * Apply one validated transition inside a transaction: conditional update,
   * item statuses, history, audit and in-app notifications. Returns null when
   * the conditional update lost a race.
   */
  async function applyTransition(
    r: StaffOpsRepos,
    scope: BranchScope,
    order: OrderRecord,
    action: StaffAction,
    to: OrderStatus,
    reason: string | null,
    meta: RequestMeta,
    auto = false,
  ): Promise<OrderRecord | null> {
    const target = targetOf(scope);
    const now = clock.now();
    const userId = scope.actor.userId;
    const updated = await r.staffOps.transitionOrder(target, order.id, {
      from: order.status,
      to,
      expectedVersion: order.version,
      patch: patchFor(action, now, userId, reason),
    });
    if (!updated) return null;

    const effect = ITEM_EFFECT[action];
    await r.staffOps.setItemStatuses(target, order.id, effect.to, effect.from);
    await r.staffOps.insertStatusHistory({
      workspaceId: scope.workspaceId,
      orderId: order.id,
      fromStatus: order.status,
      toStatus: to,
      actorUserId: userId,
      reason,
    });
    await recordAudit(
      r.audit,
      auditActorFor(scope.actor, meta),
      `order.${action}`,
      {
        workspaceId: scope.workspaceId,
        branchId: scope.branchId,
        targetType: "order",
        targetId: order.id,
      },
      {
        orderNumber: order.orderNumber,
        from: order.status,
        to,
        ...(reason ? { reason } : {}),
        ...(auto ? { auto: true } : {}),
      },
    );

    const notification = notificationFor(action, order);
    if (notification) {
      await r.staffOps.notifyBranch(target, notification.permission, notification.input, [userId]);
    }
    return updated;
  }

  function notificationFor(
    action: StaffAction,
    order: OrderRecord,
  ): { permission: Permission; input: NotificationInput } | null {
    const data = { orderId: order.id, branchId: order.branchId, orderNumber: order.orderNumber };
    if (action === "accept") {
      return {
        permission: "kitchen.view",
        input: {
          type: "order.accepted",
          title: `New ticket: order #${order.orderNumber}`,
          body: "A waiter accepted this order. Start preparing.",
          data,
        },
      };
    }
    if (action === "ready") {
      return {
        permission: "orders.serve",
        input: {
          type: "order.ready",
          title: `Order #${order.orderNumber} is ready to serve`,
          body: "Pick it up from the kitchen pass.",
          data,
        },
      };
    }
    // Rejections reach guests through their session polling, not notifications.
    return null;
  }

  async function loadDto(scope: BranchScope, orderId: string): Promise<OrderDto> {
    const dto = await tx.read((r) =>
      r.staffOps.getOrderDto(targetOf(scope), orderId, { timeline: true }),
    );
    if (!dto) throw notFound("Order");
    return dto;
  }

  function changeOf(order: OrderRecord, action: string): ChangedOrder {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      sessionId: order.sessionId,
      tableId: order.tableId,
      status: order.status,
      action,
    };
  }

  return {
    scopeForOrder,

    /** POST /orders/:orderId/transition */
    async transition(
      actor: UserActor,
      orderId: string,
      input: OrderTransitionInput,
      meta: RequestMeta,
    ): Promise<OrderDto> {
      const scope = await scopeForOrder(actor, orderId);
      const action = input.action;
      const permission = ORDER_TRANSITIONS[action].permission;
      if (!permission) throw forbidden();
      scope.require(permission);
      const reason = input.reason?.trim() || null;

      const updated = await tx.run(async (r) => {
        const order = await r.staffOps.findOrder(targetOf(scope), orderId);
        if (!order) throw notFound("Order");
        if (order.version !== input.expectedVersion) {
          throw new DomainError("STALE_VERSION", STALE_MESSAGE, {
            details: { status: order.status, version: order.version },
          });
        }
        const to = nextOrderStatus(order.status, action, reason);
        const result = await applyTransition(r, scope, order, action, to, reason, meta);
        if (!result) {
          const current = await r.staffOps.findOrder(targetOf(scope), orderId);
          throw new DomainError("STALE_VERSION", STALE_MESSAGE, {
            details: { status: current?.status ?? null, version: current?.version ?? null },
          });
        }
        return result;
      });

      await publish(scope.branchId, [changeOf(updated, action)]);
      return loadDto(scope, orderId);
    },

    /** PATCH /orders/:orderId/priority (orders.approve or kitchen.update). */
    async setPriority(
      actor: UserActor,
      orderId: string,
      input: { priority: OrderPriority; expectedVersion: number },
      meta: RequestMeta,
    ): Promise<OrderDto> {
      const scope = await scopeForOrder(actor, orderId);
      requireAny(scope, ["orders.approve", "kitchen.update"]);
      const updated = await tx.run(async (r) => {
        const target = targetOf(scope);
        const order = await r.staffOps.findOrder(target, orderId);
        if (!order) throw notFound("Order");
        if (!["PENDING", ...KITCHEN_STATUSES].includes(order.status)) {
          throw new DomainError(
            "INVALID_STATE_TRANSITION",
            `Priority cannot be changed on a ${order.status.toLowerCase()} order`,
          );
        }
        if (order.priority === input.priority && order.version === input.expectedVersion) {
          return null;
        }
        const result = await r.staffOps.updatePriority(
          target,
          orderId,
          input.priority,
          input.expectedVersion,
        );
        if (!result) throw new DomainError("STALE_VERSION", STALE_MESSAGE);
        await recordAudit(
          r.audit,
          auditActorFor(actor, meta),
          "order.priority_changed",
          {
            workspaceId: scope.workspaceId,
            branchId: scope.branchId,
            targetType: "order",
            targetId: orderId,
          },
          { orderNumber: order.orderNumber, from: order.priority, to: input.priority },
        );
        return result;
      });
      if (updated) await publish(scope.branchId, [changeOf(updated, "priority")]);
      return loadDto(scope, orderId);
    },

    /**
     * PATCH /orders/:orderId/items/:itemId — kitchen marks a line PREPARING or
     * READY. The first line started moves an ACCEPTED order to PREPARING; when
     * every line is READY the order itself becomes READY (same transition path).
     */
    async setItemStatus(
      actor: UserActor,
      orderId: string,
      itemId: string,
      input: { status: "PREPARING" | "READY" },
      meta: RequestMeta,
    ): Promise<OrderDto> {
      const scope = await scopeForOrder(actor, orderId);
      scope.require("kitchen.update");
      assertFeature(scope.entitlements, "kitchen_display");
      const changes = await tx.run(async (r) => {
        const target = targetOf(scope);
        // Row lock serializes concurrent item updates of the same order, so the
        // "all items ready" check cannot be missed by two parallel requests.
        let order = await r.staffOps.findOrder(target, orderId, { lock: true });
        if (!order) throw notFound("Order");
        if (order.status !== "ACCEPTED" && order.status !== "PREPARING") {
          throw new DomainError(
            "INVALID_STATE_TRANSITION",
            `Items can only be updated while the order is in the kitchen (it is ${order.status.toLowerCase()})`,
          );
        }
        const items = await r.staffOps.listOrderItems(target, orderId);
        const item = items.find((i) => i.id === itemId);
        if (!item) throw notFound("Order item");
        if (item.status === input.status) return [];
        if (!canTransitionItem(item.status, input.status)) {
          throw new DomainError(
            "INVALID_STATE_TRANSITION",
            `Cannot mark a ${item.status.toLowerCase()} item as ${input.status.toLowerCase()}`,
          );
        }
        const ok = await r.staffOps.updateItemStatus(
          target,
          orderId,
          itemId,
          item.status,
          input.status,
        );
        if (!ok) throw new DomainError("STALE_VERSION", "This item was already updated");

        const out: ChangedOrder[] = [];
        if (order.status === "ACCEPTED" && input.status === "PREPARING") {
          const started = await applyTransition(
            r,
            scope,
            order,
            "start",
            "PREPARING",
            null,
            meta,
            true,
          );
          if (!started) throw new DomainError("STALE_VERSION", STALE_MESSAGE);
          order = started;
          out.push(changeOf(order, "start"));
        }
        const statuses = items.map((i) => (i.id === itemId ? input.status : i.status));
        const live = statuses.filter((s) => s !== "CANCELLED");
        if (live.length > 0 && live.every((s) => s === "READY")) {
          const to = nextOrderStatus(order.status, "ready");
          const ready = await applyTransition(
            r,
            scope,
            order,
            "ready",
            to,
            "All items ready",
            meta,
            true,
          );
          if (!ready) throw new DomainError("STALE_VERSION", STALE_MESSAGE);
          order = ready;
          out.push(changeOf(order, "ready"));
        }
        if (out.length === 0) out.push(changeOf(order, "item"));
        return out;
      });
      if (changes.length) await publish(scope.branchId, changes);
      return loadDto(scope, orderId);
    },

    /** GET /orders/:orderId — detail with timeline. */
    async getOrder(actor: UserActor, orderId: string): Promise<OrderDto> {
      const scope = await scopeForOrder(actor, orderId);
      requireAny(scope, ["orders.view", "kitchen.view"]);
      return loadDto(scope, orderId);
    },

    /** GET /branches/:branchId/orders */
    async listOrders(scope: BranchScope, filter: StaffOrderListQuery): Promise<OrderDto[]> {
      scope.require("orders.view");
      return tx.read((r) => r.staffOps.listOrders(targetOf(scope), filter));
    },

    /** GET /branches/:branchId/kitchen */
    async kitchenFeed(scope: BranchScope): Promise<KitchenFeedDto> {
      scope.require("kitchen.view");
      assertFeature(scope.entitlements, "kitchen_display");
      const target = targetOf(scope);
      const now = clock.now();
      return tx.read(async (r) => {
        const settings = await r.staffOps.branchSettings(target);
        const feed = await r.staffOps.kitchenFeed(
          target,
          new Date(now.getTime() - KITCHEN_RECENT_WINDOW_MS),
          settings.kitchenDelayMinutes,
        );
        return {
          ...feed,
          kitchenDelayMinutes: settings.kitchenDelayMinutes,
          kitchenSoundEnabled: settings.kitchenSoundEnabled,
          serverTime: now.toISOString(),
        };
      });
    },

    /** GET /branches/:branchId/sessions */
    async listSessions(scope: BranchScope): Promise<BranchSessionsDto> {
      scope.require("tables.view");
      const target = targetOf(scope);
      return tx.read(async (r) => {
        const [settings, tables] = await Promise.all([
          r.staffOps.branchSettings(target),
          r.staffOps.listBranchTables(target),
        ]);
        return {
          currency: scope.branch.currency,
          waiterSoundEnabled: settings.waiterSoundEnabled,
          tables: tables.map((t) => ({
            ...t,
            status: deriveTableStatus({
              isActive: t.isActive,
              session: t.session,
              bill: t.bill,
            }),
          })),
        };
      });
    },

    /** GET /branches/:branchId/sessions/:sessionId */
    async getSession(scope: BranchScope, sessionId: string): Promise<SessionDetailDto> {
      scope.require("tables.view");
      const target = targetOf(scope);
      return tx.read(async (r) => {
        const session = await r.staffOps.findSession(target, sessionId);
        if (!session) throw notFound("Session");
        const orders = await r.staffOps.listSessionOrders(target, sessionId);
        return {
          table: {
            id: session.tableId,
            name: session.tableName,
            section: session.tableSection,
            capacity: session.tableCapacity,
          },
          session: session.summary,
          status: deriveTableStatus({
            isActive: session.tableIsActive,
            session: session.summary,
            bill: session.bill,
          }),
          orders,
          bill: session.bill,
        };
      });
    },
  };
}

export type StaffOpsService = ReturnType<typeof createStaffOpsService>;
