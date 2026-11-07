import type { PlaceOrderInput } from "@/contracts/orders";
import type {
  BillRequestResultDto,
  GuestOrderViewDto,
  GuestSessionDto,
  JoinSessionDto,
  PublicQrDto,
} from "@/contracts/ordering";
import type { BranchMenu } from "@/contracts/menu";
import type { OrderDto } from "@/contracts/orders";
import type { OrderPriority } from "@/domain/orders/order-status";
import { priceOrderLines, type MenuCatalogEntry } from "@/domain/orders/order-lines";
import { DomainError, notFound } from "@/domain/shared/errors";
import { formatMoney } from "@/domain/shared/money";
import { generateToken, hashToken, isWellFormedToken } from "@/domain/shared/tokens";
import type { TransactionRunner } from "@/infrastructure/database/interfaces/transaction";
import type { RealtimePublisher } from "@/infrastructure/realtime/interfaces/realtime";

import { recordAudit } from "../../audit/audit-service";
import type { BranchScope } from "../../authz/access-service";
import { auditActorFor, type AuditActor, type RequestMeta } from "../../context";
import { bindWorkspace } from "../../db-context";
import type { RateLimitRepository } from "../../ports/core-repositories";
import type { Clock, Logger } from "../../ports/observability";
import type { EntitlementService } from "../../subscriptions/entitlement-service";
import type {
  BranchTarget,
  GuestRecord,
  OrderingRepos,
  OrderingRepository,
  SessionRecord,
  TableContext,
} from "./ports";

/**
 * Customer (QR) ordering and staff order placement.
 *
 * GUEST VISIBILITY RULES — a guest is identified only by the httpOnly
 * `ros_guest` cookie, which maps (by SHA-256 hash) to exactly one
 * table_session_members row and therefore one table session. Every guest read
 * is filtered by that member's session and workspace; guests never send ids.
 * A guest can see:
 *   1. their OWN orders (lines, prices, status and status timestamps);
 *   2. the session/table status (open, bill requested, billed, closed);
 *   3. the table's bill summary once staff issue a bill (totals, lines and
 *      paid/balance amounts — no staff names, payment methods or references).
 * A guest can never see another guest's orders (even at the same table), staff
 * identities, or any personal data. A CLOSED session stays readable (final
 * bill) but accepts no new orders or bill requests.
 *
 * STAFF ORDERS — placed through the same repricing/snapshot path. Because a
 * staff member keyed them in, they are already approved: they are created as
 * ACCEPTED (accepted_by = the staff member) with history PENDING → ACCEPTED,
 * so they go straight to the kitchen.
 */

export const GUEST_SESSION_HOURS = 12;
export const ORDER_COUNTER = "order";

const QR_INVALID_MESSAGE =
  "This QR code isn't active. Please ask a member of staff for help, or scan the code on your table again.";
const GUEST_REQUIRED_MESSAGE = "Scan the QR code on your table to start ordering.";
const ORDERING_PAUSED_MESSAGE =
  "This restaurant isn't taking orders from the table right now. Please ask a member of staff.";

const qrInvalid = () => new DomainError("QR_INVALID", QR_INVALID_MESSAGE);
const guestRequired = () => new DomainError("UNAUTHENTICATED", GUEST_REQUIRED_MESSAGE);

/** Thrown inside a transaction when the idempotency key was taken concurrently. */
class IdempotencyRace extends Error {
  constructor() {
    super("idempotency race");
  }
}

export interface OrderingServiceDeps {
  tx: TransactionRunner<OrderingRepos>;
  /** Owner-level lookups that resolve QR and guest tokens to their workspace. */
  lookup: Pick<OrderingRepository, "findTableByQrHash" | "findGuestByTokenHash">;
  clock: Clock;
  entitlements: EntitlementService;
  realtime: RealtimePublisher;
  rateLimit: RateLimitRepository;
  fileUrl: (key: string) => string;
  logger: Logger;
}

export function buildCatalog(menu: BranchMenu): Map<string, MenuCatalogEntry> {
  const map = new Map<string, MenuCatalogEntry>();
  for (const category of menu.categories) {
    for (const item of category.items) {
      map.set(item.id, { item, categoryName: category.name, dietary: item.dietary });
    }
  }
  return map;
}

function guestActor(meta: RequestMeta): AuditActor {
  return { type: "GUEST", userId: null, ip: meta.ip, requestId: meta.requestId };
}

function targetOf(t: BranchTarget): BranchTarget {
  return { workspaceId: t.workspaceId, restaurantId: t.restaurantId, branchId: t.branchId };
}

export function createOrderingService(deps: OrderingServiceDeps) {
  const { tx, lookup, clock, entitlements, realtime, rateLimit, fileUrl, logger } = deps;

  /** Workspace may serve QR guests right now (subscription + plan feature). */
  async function guestOrderingAllowed(workspaceId: string): Promise<boolean> {
    try {
      const ent = await entitlements.getWorkspaceEntitlements(workspaceId);
      return (
        (ent.accessLevel === "FULL" || ent.accessLevel === "LIMITED") &&
        ent.features.includes("qr_ordering")
      );
    } catch (error) {
      if (error instanceof DomainError && error.code === "NOT_FOUND") return false;
      throw error;
    }
  }

  /** Resolve a QR token to an operational table, or throw one indistinguishable QR_INVALID. */
  async function resolveTable(token: string): Promise<TableContext> {
    if (!isWellFormedToken(token)) throw qrInvalid();
    const table = await lookup.findTableByQrHash(await hashToken(token));
    if (!table || !table.operational || !table.acceptingOrders) throw qrInvalid();
    bindWorkspace(table.workspaceId);
    if (!(await guestOrderingAllowed(table.workspaceId))) throw qrInvalid();
    return table;
  }

  async function resolveGuest(guestToken: string | null): Promise<GuestRecord> {
    if (!guestToken || !isWellFormedToken(guestToken)) throw guestRequired();
    const guest = await lookup.findGuestByTokenHash(await hashToken(guestToken));
    if (!guest) throw guestRequired();
    bindWorkspace(guest.table.workspaceId);
    return guest;
  }

  async function publish(
    target: BranchTarget,
    sessionId: string,
    type: string,
    data: Record<string, string | number | null>,
  ): Promise<void> {
    try {
      await realtime.publish(`branch:${target.branchId}`, { type, data });
      await realtime.publish(`session:${sessionId}`, { type, data });
    } catch (error) {
      // Realtime is only a refetch hint; clients also poll.
      logger.warn("realtime_publish_failed", { type, error: String(error) });
    }
  }

  /** Find the table's non-closed session or open one (race-safe via the partial unique index). */
  async function findOrOpenSession(
    r: OrderingRepos,
    table: TableContext,
    openedBy: string | null,
  ): Promise<{ session: SessionRecord; created: boolean }> {
    const existing = await r.ordering.findOpenSession(table.workspaceId, table.tableId);
    if (existing) return { session: existing, created: false };
    const inserted = await r.ordering.tryInsertSession({
      target: targetOf(table),
      tableId: table.tableId,
      openedBy,
    });
    if (inserted) return { session: inserted, created: true };
    const winner = await r.ordering.findOpenSession(table.workspaceId, table.tableId);
    if (!winner) throw new DomainError("CONFLICT", "The table is busy. Please try again.");
    return { session: winner, created: false };
  }

  interface CreateOrderInput {
    table: TableContext;
    session: SessionRecord;
    lines: PlaceOrderInput["lines"];
    specialInstructions: string | null;
    idempotencyKey: string;
    priority: OrderPriority;
    placedBy: { kind: "guest"; memberId: string } | { kind: "staff"; userId: string };
  }

  /**
   * Shared order creation (inside a transaction): reprice from the
   * branch-effective menu, allocate the next order number and persist the
   * snapshot. Returns the new order id plus number/totals.
   */
  async function createOrder(r: OrderingRepos, input: CreateOrderInput) {
    const { table, session, placedBy } = input;
    const menu = await r.ordering.loadMenu(targetOf(table), { includeUnavailable: true });
    const priced = priceOrderLines(
      buildCatalog(menu),
      input.lines.map((l) => ({
        menuItemId: l.menuItemId,
        variantId: l.variantId ?? null,
        addonIds: l.addonIds ?? [],
        quantity: l.quantity,
        notes: l.notes ?? null,
      })),
    );
    const orderNumber = await r.ordering.nextCounter(table.branchId, ORDER_COUNTER);
    const now = clock.now();
    const isStaff = placedBy.kind === "staff";
    const orderId = await r.ordering.insertOrder({
      target: targetOf(table),
      tableId: table.tableId,
      sessionId: session.id,
      memberId: placedBy.kind === "guest" ? placedBy.memberId : null,
      placedByUserId: isStaff ? placedBy.userId : null,
      source: isStaff ? "STAFF" : "CUSTOMER",
      orderNumber,
      status: isStaff ? "ACCEPTED" : "PENDING",
      priority: input.priority,
      specialInstructions: input.specialInstructions?.trim() || null,
      currency: table.currency,
      subtotal: priced.subtotal,
      itemCount: priced.itemCount,
      idempotencyKey: input.idempotencyKey,
      acceptedBy: isStaff ? placedBy.userId : null,
      acceptedAt: isStaff ? now : null,
      lines: priced.lines,
      history: isStaff
        ? [
            {
              fromStatus: null,
              toStatus: "PENDING",
              actorType: "USER",
              actorUserId: placedBy.userId,
            },
            {
              fromStatus: "PENDING",
              toStatus: "ACCEPTED",
              actorType: "USER",
              actorUserId: placedBy.userId,
            },
          ]
        : [{ fromStatus: null, toStatus: "PENDING", actorType: "GUEST", actorUserId: null }],
    });
    if (!orderId) throw new IdempotencyRace();
    return { orderId, orderNumber, subtotal: priced.subtotal, itemCount: priced.itemCount };
  }

  function assertSessionAcceptsOrders(session: SessionRecord): void {
    if (session.status === "BILLED") {
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "The bill for this table has been issued, so new orders can't be added. Please ask a member of staff.",
      );
    }
    if (session.status === "CLOSED") {
      throw new DomainError(
        "INVALID_STATE_TRANSITION",
        "This table session has ended. Scan the QR code on your table to start a new one.",
      );
    }
  }

  async function guestCanOrder(guest: GuestRecord): Promise<boolean> {
    return (
      guest.table.operational &&
      guest.table.acceptingOrders &&
      (guest.session.status === "OPEN" || guest.session.status === "BILL_REQUESTED") &&
      (await guestOrderingAllowed(guest.table.workspaceId))
    );
  }

  return {
    /** GET /public/qr/:token — branding, table and the available menu. */
    async resolveQr(token: string): Promise<PublicQrDto> {
      const table = await resolveTable(token);
      const [menu, open] = await tx.read((r) =>
        Promise.all([
          r.ordering.loadMenu(targetOf(table), { includeUnavailable: false }),
          r.ordering.findOpenSession(table.workspaceId, table.tableId),
        ]),
      );
      return {
        branding: {
          restaurantName: table.restaurantName,
          description: table.restaurant.description,
          logoUrl: table.restaurant.logoKey ? fileUrl(table.restaurant.logoKey) : null,
          coverUrl: table.restaurant.coverKey ? fileUrl(table.restaurant.coverKey) : null,
          brandColor: table.restaurant.brandColor,
          welcomeMessage: table.restaurant.welcomeMessage,
          showPrepTime: table.restaurant.showPrepTime,
          showAllergens: table.restaurant.showAllergens,
        },
        branch: { name: table.branchName },
        table: { name: table.tableName },
        currency: table.currency,
        allowBillRequest: table.allowCustomerBillRequest,
        hasOpenSession: open !== null,
        menu,
      };
    },

    /**
     * POST /public/qr/:token/session — join the table's open session (or open
     * one). Returns a new guest token to set as the cookie, or null when the
     * presented cookie already belongs to this session.
     */
    async joinSession(
      token: string,
      currentGuestToken: string | null,
      meta: RequestMeta,
    ): Promise<{ result: JoinSessionDto; guestToken: string | null }> {
      const table = await resolveTable(token);
      const currentHash =
        currentGuestToken && isWellFormedToken(currentGuestToken)
          ? await hashToken(currentGuestToken)
          : null;
      const newToken = generateToken();
      const newHash = await hashToken(newToken);

      const out = await tx.run(async (r) => {
        if (currentHash) {
          const guest = await r.ordering.findGuestByTokenHash(currentHash);
          if (
            guest &&
            guest.session.tableId === table.tableId &&
            guest.session.workspaceId === table.workspaceId &&
            guest.session.status !== "CLOSED"
          ) {
            await r.ordering.touchMember(guest.memberId, clock.now());
            return { session: guest.session, created: false, rejoined: true };
          }
        }
        const { session, created } = await findOrOpenSession(r, table, null);
        if (created) {
          await recordAudit(
            r.audit,
            guestActor(meta),
            "session.opened",
            {
              workspaceId: table.workspaceId,
              branchId: table.branchId,
              targetType: "table_session",
              targetId: session.id,
            },
            { tableId: table.tableId, via: "qr" },
          );
        }
        await r.ordering.insertMember({
          workspaceId: table.workspaceId,
          sessionId: session.id,
          guestTokenHash: newHash,
        });
        return { session, created, rejoined: false };
      });

      if (out.created) {
        await publish(table, out.session.id, "session.opened", {
          sessionId: out.session.id,
          tableId: table.tableId,
        });
      }
      return {
        result: { sessionId: out.session.id, status: out.session.status, rejoined: out.rejoined },
        guestToken: out.rejoined ? null : newToken,
      };
    },

    /** GET /public/session — the guest's view of their table session. */
    async getGuestSession(guestToken: string | null): Promise<GuestSessionDto> {
      const guest = await resolveGuest(guestToken);
      const { session, table } = guest;
      const [orders, bill, hasActiveOrders] = await tx.read((r) =>
        Promise.all([
          r.ordering.listGuestOrders(session.workspaceId, session.id, guest.memberId),
          r.ordering.findLiveBillForSession(session.workspaceId, session.id),
          r.ordering.sessionHasActiveOrders(session.workspaceId, session.id),
        ]),
      );
      const canOrder = await guestCanOrder(guest);
      return {
        session: {
          id: session.id,
          status: session.status,
          openedAt: session.openedAt.toISOString(),
          billRequestedAt: session.billRequestedAt?.toISOString() ?? null,
        },
        restaurantName: table.restaurantName,
        branchName: table.branchName,
        tableName: table.tableName,
        currency: table.currency,
        acceptingOrders: table.acceptingOrders && table.operational,
        allowBillRequest: table.allowCustomerBillRequest,
        canOrder,
        canRequestBill:
          table.allowCustomerBillRequest && session.status === "OPEN" && hasActiveOrders,
        orders,
        bill,
      };
    },

    /** POST /public/session/orders — idempotent via the body's idempotencyKey. */
    async placeGuestOrder(
      guestToken: string | null,
      input: PlaceOrderInput,
      meta: RequestMeta,
    ): Promise<{ order: GuestOrderViewDto; replay: boolean }> {
      const guest = await resolveGuest(guestToken);
      const { table } = guest;

      const replay = async (): Promise<GuestOrderViewDto> => {
        const existing = await tx.read((r) =>
          r.ordering.findOrderByIdempotencyKey(table.branchId, input.idempotencyKey),
        );
        if (!existing || existing.memberId !== guest.memberId) {
          throw new DomainError(
            "IDEMPOTENCY_MISMATCH",
            "This order key was already used. Please try placing your order again.",
          );
        }
        const order = await tx.read((r) =>
          r.ordering.getGuestOrder(
            table.workspaceId,
            existing.sessionId,
            guest.memberId,
            existing.id,
          ),
        );
        if (!order) throw notFound("Order");
        return order;
      };

      // Fast path for retries of a submission that already succeeded.
      const prior = await tx.read((r) =>
        r.ordering.findOrderByIdempotencyKey(table.branchId, input.idempotencyKey),
      );
      if (prior) return { order: await replay(), replay: true };

      assertSessionAcceptsOrders(guest.session);
      if (!(await guestCanOrder(guest))) {
        throw new DomainError("CONFLICT", ORDERING_PAUSED_MESSAGE);
      }

      const hit = await rateLimit.hit(
        `guest-order:${meta.ip ?? "unknown"}:${guest.session.id}`,
        10 * 60_000,
        clock.now(),
      );
      if (hit.count > 20) {
        throw new DomainError(
          "RATE_LIMITED",
          "You've placed a lot of orders in a short time. Please wait a few minutes or ask a member of staff.",
          {
            details: {
              retryAfterSeconds: Math.ceil((hit.resetAt.getTime() - clock.now().getTime()) / 1000),
            },
          },
        );
      }

      let created: Awaited<ReturnType<typeof createOrder>>;
      try {
        created = await tx.run(async (r) => {
          const locked = await r.ordering.lockSession(table.workspaceId, guest.session.id);
          if (!locked) throw guestRequired();
          assertSessionAcceptsOrders(locked);
          const result = await createOrder(r, {
            table,
            session: locked,
            lines: input.lines,
            specialInstructions: input.specialInstructions ?? null,
            idempotencyKey: input.idempotencyKey,
            priority: "NORMAL",
            placedBy: { kind: "guest", memberId: guest.memberId },
          });
          await r.ordering.notifyBranchStaff(targetOf(table), "orders.approve", {
            type: "order.created",
            title: `New order #${result.orderNumber} · ${table.tableName}`,
            body: `${result.itemCount} item${result.itemCount === 1 ? "" : "s"} · ${formatMoney(result.subtotal, table.currency)} — waiting for approval`,
            data: {
              orderId: result.orderId,
              sessionId: locked.id,
              tableId: table.tableId,
              branchId: table.branchId,
            },
          });
          await recordAudit(
            r.audit,
            guestActor(meta),
            "order.created",
            {
              workspaceId: table.workspaceId,
              branchId: table.branchId,
              targetType: "order",
              targetId: result.orderId,
            },
            {
              source: "CUSTOMER",
              orderNumber: result.orderNumber,
              subtotal: result.subtotal,
              itemCount: result.itemCount,
              sessionId: locked.id,
            },
          );
          return result;
        });
      } catch (error) {
        if (error instanceof IdempotencyRace) return { order: await replay(), replay: true };
        throw error;
      }

      await publish(table, guest.session.id, "order.created", {
        orderId: created.orderId,
        sessionId: guest.session.id,
      });
      const order = await tx.read((r) =>
        r.ordering.getGuestOrder(
          table.workspaceId,
          guest.session.id,
          guest.memberId,
          created.orderId,
        ),
      );
      if (!order) throw notFound("Order");
      return { order, replay: false };
    },

    /** POST /public/session/bill-request */
    async requestBill(guestToken: string | null, meta: RequestMeta): Promise<BillRequestResultDto> {
      const guest = await resolveGuest(guestToken);
      const { table, session } = guest;
      if (!table.allowCustomerBillRequest) {
        throw new DomainError("FORBIDDEN", "Please ask a member of staff for your bill.");
      }
      const already = (s: SessionRecord): BillRequestResultDto => ({
        status: s.status,
        billRequestedAt: s.billRequestedAt?.toISOString() ?? null,
        alreadyRequested: true,
      });
      if (session.status === "BILL_REQUESTED" || session.status === "BILLED")
        return already(session);
      if (session.status === "CLOSED") {
        throw new DomainError("INVALID_STATE_TRANSITION", "This table session has already ended.");
      }

      const outcome = await tx.run(async (r) => {
        if (!(await r.ordering.sessionHasActiveOrders(table.workspaceId, session.id))) {
          throw new DomainError("CONFLICT", "Place an order before asking for the bill.");
        }
        const updated = await r.ordering.markBillRequested(session, clock.now());
        if (!updated) {
          const current = await r.ordering.findOpenSession(table.workspaceId, table.tableId);
          if (current && current.id === session.id && current.status !== "OPEN") {
            return { session: current, changed: false };
          }
          throw new DomainError("STALE_VERSION", "The table was just updated. Please try again.");
        }
        await r.ordering.notifyBranchStaff(targetOf(table), "bills.generate", {
          type: "bill.requested",
          title: `Bill requested · ${table.tableName}`,
          body: "A guest asked for the bill.",
          data: { sessionId: session.id, tableId: table.tableId, branchId: table.branchId },
        });
        await recordAudit(
          r.audit,
          guestActor(meta),
          "session.bill_requested",
          {
            workspaceId: table.workspaceId,
            branchId: table.branchId,
            targetType: "table_session",
            targetId: session.id,
          },
          { tableId: table.tableId },
        );
        return { session: updated, changed: true };
      });

      if (!outcome.changed) return already(outcome.session);
      await publish(table, session.id, "session.bill_requested", {
        sessionId: session.id,
        tableId: table.tableId,
      });
      return {
        status: outcome.session.status,
        billRequestedAt: outcome.session.billRequestedAt?.toISOString() ?? null,
        alreadyRequested: false,
      };
    },

    /** POST /branches/:branchId/orders — staff order placement (created ACCEPTED). */
    async placeStaffOrder(
      scope: BranchScope,
      input: PlaceOrderInput & { tableId: string; priority?: OrderPriority },
      meta: RequestMeta,
    ): Promise<{ order: OrderDto; replay: boolean }> {
      scope.require("orders.create");
      const target: BranchTarget = {
        workspaceId: scope.workspaceId,
        restaurantId: scope.restaurantId,
        branchId: scope.branchId,
      };
      const actorId = scope.actor.userId;

      const replay = async (): Promise<OrderDto> => {
        const existing = await tx.read((r) =>
          r.ordering.findOrderByIdempotencyKey(target.branchId, input.idempotencyKey),
        );
        if (!existing || existing.source !== "STAFF" || existing.placedByUserId !== actorId) {
          throw new DomainError(
            "IDEMPOTENCY_MISMATCH",
            "This order key was already used for a different order.",
          );
        }
        const order = await tx.read((r) => r.ordering.getStaffOrder(target, existing.id));
        if (!order) throw notFound("Order");
        return order;
      };

      const prior = await tx.read((r) =>
        r.ordering.findOrderByIdempotencyKey(target.branchId, input.idempotencyKey),
      );
      if (prior) return { order: await replay(), replay: true };

      const table = await tx.read((r) => r.ordering.findTableInBranch(target, input.tableId));
      if (!table) throw notFound("Table");
      if (!table.operational) {
        throw new DomainError("CONFLICT", "This table is out of service. Re-enable it first.");
      }

      let out: { orderId: string; sessionId: string; sessionCreated: boolean };
      try {
        out = await tx.run(async (r) => {
          const { session, created: sessionCreated } = await findOrOpenSession(r, table, actorId);
          const locked = (await r.ordering.lockSession(table.workspaceId, session.id)) ?? session;
          assertSessionAcceptsOrders(locked);
          if (sessionCreated) {
            await recordAudit(
              r.audit,
              auditActorFor(scope.actor, meta),
              "session.opened",
              {
                workspaceId: table.workspaceId,
                branchId: table.branchId,
                targetType: "table_session",
                targetId: session.id,
              },
              { tableId: table.tableId, via: "staff" },
            );
          }
          const result = await createOrder(r, {
            table,
            session: locked,
            lines: input.lines,
            specialInstructions: input.specialInstructions ?? null,
            idempotencyKey: input.idempotencyKey,
            priority: input.priority ?? "NORMAL",
            placedBy: { kind: "staff", userId: actorId },
          });
          await recordAudit(
            r.audit,
            auditActorFor(scope.actor, meta),
            "order.created",
            {
              workspaceId: table.workspaceId,
              branchId: table.branchId,
              targetType: "order",
              targetId: result.orderId,
            },
            {
              source: "STAFF",
              orderNumber: result.orderNumber,
              subtotal: result.subtotal,
              itemCount: result.itemCount,
              sessionId: locked.id,
            },
          );
          return { orderId: result.orderId, sessionId: locked.id, sessionCreated };
        });
      } catch (error) {
        if (error instanceof IdempotencyRace) return { order: await replay(), replay: true };
        throw error;
      }

      if (out.sessionCreated) {
        await publish(table, out.sessionId, "session.opened", {
          sessionId: out.sessionId,
          tableId: table.tableId,
        });
      }
      await publish(table, out.sessionId, "order.created", {
        orderId: out.orderId,
        sessionId: out.sessionId,
      });
      const order = await tx.read((r) => r.ordering.getStaffOrder(target, out.orderId));
      if (!order) throw notFound("Order");
      return { order, replay: false };
    },
  };
}

export type OrderingService = ReturnType<typeof createOrderingService>;
export type { OrderingRepository };
