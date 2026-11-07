import type { BillDto, BillTotalsDto, PaymentSummaryDto } from "@ros/contracts/billing";
import type {
  BillListQuery,
  BillListResponse,
  BillPreviewDto,
  CashierQueueDto,
  PaymentResultDto,
  ReceiptDto,
  SessionCloseResultDto,
} from "@ros/contracts/billing-extra";
import { calculateBill, type BillDiscount } from "@ros/domain/billing/bill-calculator";
import {
  billWarnings,
  buildBillLines,
  countSessionOrders,
  type BillLine,
} from "@ros/domain/billing/bill-lines";
import { localDayRange } from "@ros/domain/billing/local-dates";
import {
  assertPaymentAllowed,
  assertRefundAllowed,
  cashChange,
  computeBalance,
  PAYMENT_METHODS,
  type BillBalance,
  type LedgerEntry,
  type PaymentKind,
  type PaymentMethod,
} from "@ros/domain/billing/payments";
import { conflict, DomainError, notFound } from "@ros/domain/shared/errors";
import { checkSessionClosure } from "@ros/domain/tables/table-status";
import {
  UniqueViolationError,
  type TransactionRunner,
} from "@/infrastructure/database/interfaces/transaction";
import type { RealtimePublisher } from "@/infrastructure/realtime/interfaces/realtime";

import { recordAudit } from "../../audit/audit-service";
import type { BranchScope } from "../../authz/access-service";
import { auditActorFor, type RequestMeta } from "../../context";
import type { Clock, Logger } from "../../ports/observability";
import type {
  BillingRepos,
  BillingRepository,
  BillRecord,
  BranchBillingSettings,
  BranchKey,
  PaymentRecord,
} from "./ports";

/**
 * Billing use cases: preview/generate bills from order snapshots, record
 * payments and refunds against an append-only ledger, void, and close table
 * sessions under the branch's closure rules.
 *
 * Invariants:
 * - Bill lines, prices, taxes and discount are snapshotted at issue time; later
 *   menu or order changes never alter an issued bill. Orders added after the
 *   bill was issued require voiding the bill and generating a new one
 *   (generation is refused while a live bill exists).
 * - The payment ledger is the single source of truth for amountPaid,
 *   amountRefunded, balanceDue and paymentStatus; they are recomputed on every
 *   change under a row lock on the bill.
 * - Payments are idempotent per (branch, idempotency key): a replay returns the
 *   original payment and never counts twice.
 */

export interface BillingServiceDeps {
  tx: TransactionRunner<BillingRepos>;
  clock: Clock;
  realtime: RealtimePublisher;
  logger?: Logger;
}

export interface GenerateBillInput {
  sessionId: string;
  discount?: BillDiscount | null;
  idempotencyKey: string;
}

export interface PreviewBillInput {
  sessionId: string;
  discount?: BillDiscount | null;
}

const keyOf = (scope: BranchScope): BranchKey => ({
  workspaceId: scope.workspaceId,
  restaurantId: scope.restaurantId,
  branchId: scope.branchId,
});

const ledgerOf = (payments: readonly PaymentRecord[]): LedgerEntry[] =>
  payments.map((p) => ({ kind: p.kind, amount: p.amount, voided: p.status === "VOIDED" }));

function normalizeDiscount(discount: BillDiscount | null | undefined): BillDiscount | null {
  if (!discount || discount.value === 0) return null;
  return { type: discount.type, value: discount.value, reason: discount.reason?.trim() || null };
}

function totalsFor(
  lines: readonly BillLine[],
  settings: BranchBillingSettings,
  discount: BillDiscount | null,
): BillTotalsDto {
  const t = calculateBill(
    lines,
    {
      taxes: settings.taxes,
      pricesIncludeTax: settings.pricesIncludeTax,
      serviceChargeBps: settings.serviceChargeBps,
    },
    discount,
  );
  return {
    subtotal: t.subtotal,
    discountAmount: t.discountAmount,
    serviceChargeBps: settings.serviceChargeBps,
    serviceChargeAmount: t.serviceChargeAmount,
    taxes: t.taxes,
    taxTotal: t.taxTotal,
    grandTotal: t.grandTotal,
    pricesIncludeTax: settings.pricesIncludeTax,
  };
}

function sameBillContent(
  existing: BillRecord,
  totals: BillTotalsDto,
  lineCount: number,
  discount: BillDiscount | null,
): boolean {
  return (
    existing.subtotal === totals.subtotal &&
    existing.discountAmount === totals.discountAmount &&
    existing.serviceChargeAmount === totals.serviceChargeAmount &&
    existing.taxTotal === totals.taxTotal &&
    existing.grandTotal === totals.grandTotal &&
    existing.itemCount === lineCount &&
    (existing.discountType ?? null) === (discount?.type ?? null) &&
    (existing.discountValue ?? null) === (discount?.value ?? null)
  );
}

function staleBill(): DomainError {
  return new DomainError(
    "STALE_VERSION",
    "This bill was just updated by someone else. Reload and try again.",
  );
}

function assertBillOpenForMoney(bill: BillRecord): void {
  if (bill.status === "VOID") throw conflict("This bill has been voided");
}

export function createBillingService({ tx, clock, realtime, logger }: BillingServiceDeps) {
  async function publish(
    key: BranchKey,
    type: string,
    data: { billId?: string | null; sessionId: string; tableId?: string | null },
  ): Promise<void> {
    const payload = {
      billId: data.billId ?? null,
      sessionId: data.sessionId,
      tableId: data.tableId ?? null,
    };
    try {
      await realtime.publish(`branch:${key.branchId}`, { type, data: payload });
      await realtime.publish(`session:${data.sessionId}`, { type, data: payload });
    } catch (error) {
      // Realtime is a refetch hint only; clients also poll.
      logger?.warn("billing_realtime_publish_failed", { type, error: String(error) });
    }
  }

  async function loadBillDto(key: BranchKey, billId: string): Promise<BillDto> {
    const bill = await tx.read((r) => r.billing.getBillDto(key, billId));
    if (!bill) throw notFound("Bill");
    return bill;
  }

  function requireDiscountPermission(scope: BranchScope, discount: BillDiscount | null): void {
    if (discount) scope.require("bills.discount");
  }

  async function sessionSnapshot(r: BillingRepos, key: BranchKey, sessionId: string) {
    const orders = await r.billing.listSessionOrders(key, sessionId);
    const lines = buildBillLines(orders);
    const counts = countSessionOrders(orders);
    return { lines, counts };
  }

  /** Same-key replay of a payment/refund; validates the request matches the original. */
  function assertReplayMatches(
    existing: PaymentRecord,
    billId: string,
    kind: PaymentKind,
    input: { method: PaymentMethod; amount: number },
  ): void {
    if (
      existing.billId !== billId ||
      existing.kind !== kind ||
      existing.method !== input.method ||
      existing.amount !== input.amount
    ) {
      throw new DomainError(
        "IDEMPOTENCY_MISMATCH",
        "This payment key was already used for a different payment",
      );
    }
  }

  async function paymentResult(
    key: BranchKey,
    billId: string,
    paymentId: string,
    change: number | null,
    replayed: boolean,
  ): Promise<PaymentResultDto> {
    const bill = await loadBillDto(key, billId);
    const payment = bill.payments.find((p) => p.id === paymentId);
    if (!payment) throw notFound("Payment");
    return { payment, bill, change, replayed };
  }

  /** Shared ledger write for payments and refunds. */
  async function addLedgerEntry(
    scope: BranchScope,
    billId: string,
    kind: PaymentKind,
    input: {
      method: PaymentMethod;
      amount: number;
      tendered?: number;
      reference?: string;
      note?: string;
      idempotencyKey: string;
    },
    meta: RequestMeta,
  ): Promise<PaymentResultDto> {
    const key = keyOf(scope);
    const replayOf = async (repo: BillingRepository) => {
      const existing = await repo.findPaymentByIdempotencyKey(key.branchId, input.idempotencyKey);
      if (!existing) return null;
      assertReplayMatches(existing, billId, kind, input);
      return existing;
    };

    let outcome: { paymentId: string; change: number | null; replayed: boolean; sessionId: string };
    try {
      outcome = await tx.run(async (r) => {
        const replay = await replayOf(r.billing);
        if (replay) {
          const change =
            replay.tendered !== null ? cashChange(replay.tendered, replay.amount) : null;
          return { paymentId: replay.id, change, replayed: true, sessionId: "" };
        }

        const bill = await r.billing.findBill(key, billId, { lock: true });
        if (!bill) throw notFound("Bill");
        assertBillOpenForMoney(bill);
        const settings = await r.billing.loadSettings(key);

        let tendered: number | null = null;
        if (kind === "PAYMENT") {
          if (!settings.paymentMethods.includes(input.method)) {
            throw new DomainError(
              "PAYMENT_REJECTED",
              "This payment method is not enabled for the branch",
              { fieldErrors: { method: ["This payment method is not enabled"] } },
            );
          }
          if (input.method === "CASH" && input.tendered !== undefined) {
            if (input.tendered < input.amount) {
              throw new DomainError("VALIDATION_FAILED", "Cash tendered is less than the amount", {
                fieldErrors: { tendered: ["Cash tendered is less than the amount"] },
              });
            }
            tendered = input.tendered;
          }
        }

        const ledger = await r.billing.listLedger(bill.id);
        const before = computeBalance(bill.grandTotal, ledgerOf(ledger));
        if (kind === "PAYMENT") assertPaymentAllowed(before, input.amount);
        else assertRefundAllowed(before, input.amount);

        const paymentId = await r.billing.insertPayment(key, {
          billId: bill.id,
          kind,
          method: input.method,
          amount: input.amount,
          tendered,
          reference: input.reference?.trim() || null,
          note: input.note?.trim() || null,
          idempotencyKey: input.idempotencyKey,
          recordedBy: scope.actor.userId,
        });
        const after = computeBalance(bill.grandTotal, [
          ...ledgerOf(ledger),
          { kind, amount: input.amount },
        ]);
        await applyBalance(r, key, bill, after);
        await r.billing.insertHistory(key, {
          billId: bill.id,
          paymentId,
          action: kind === "PAYMENT" ? "RECORDED" : "REFUNDED",
          amount: input.amount,
          balanceBefore: before.balanceDue,
          balanceAfter: after.balanceDue,
          paymentStatusAfter: after.paymentStatus,
          actorUserId: scope.actor.userId,
        });
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          kind === "PAYMENT" ? "payment.recorded" : "payment.refunded",
          {
            workspaceId: key.workspaceId,
            branchId: key.branchId,
            targetType: "bill",
            targetId: bill.id,
          },
          {
            paymentId,
            billNumber: bill.billNumber,
            amount: input.amount,
            method: input.method,
            paymentStatus: after.paymentStatus,
            balanceDue: after.balanceDue,
          },
        );

        if (
          kind === "PAYMENT" &&
          after.paymentStatus === "PAID" &&
          before.paymentStatus !== "PAID" &&
          settings.autoCompleteOnPayment
        ) {
          await r.billing.completeServedOrders(key, bill.sessionId, clock.now(), "Bill paid");
        }
        return {
          paymentId,
          change: tendered !== null ? cashChange(tendered, input.amount) : null,
          replayed: false,
          sessionId: bill.sessionId,
        };
      });
    } catch (error) {
      // A concurrent request with the same key won the insert: replay it.
      if (
        error instanceof UniqueViolationError &&
        error.constraint === "payments_branch_idempotency_uq"
      ) {
        const replay = await tx.read((r) => replayOf(r.billing));
        if (!replay) throw error;
        const change = replay.tendered !== null ? cashChange(replay.tendered, replay.amount) : null;
        return paymentResult(key, billId, replay.id, change, true);
      }
      throw error;
    }

    if (!outcome.replayed) {
      await publish(key, "bill.updated", { billId, sessionId: outcome.sessionId });
    }
    return paymentResult(key, billId, outcome.paymentId, outcome.change, outcome.replayed);
  }

  async function applyBalance(
    r: BillingRepos,
    key: BranchKey,
    bill: BillRecord,
    balance: BillBalance,
  ): Promise<void> {
    const ok = await r.billing.updateBillBalance(key, bill.id, bill.version, {
      amountPaid: balance.amountPaid,
      amountRefunded: balance.amountRefunded,
      balanceDue: balance.balanceDue,
      paymentStatus: balance.paymentStatus,
    });
    if (!ok) throw staleBill();
  }

  return {
    async preview(scope: BranchScope, input: PreviewBillInput): Promise<BillPreviewDto> {
      scope.require("bills.generate");
      const discount = normalizeDiscount(input.discount);
      requireDiscountPermission(scope, discount);
      const key = keyOf(scope);
      return tx.read(async (r) => {
        const session = await r.billing.findSession(key, input.sessionId);
        if (!session) throw notFound("Table session");
        if (session.status === "CLOSED") throw conflict("This table session is already closed");
        const [{ lines, counts }, settings, existing] = await Promise.all([
          sessionSnapshot(r, key, session.id),
          r.billing.loadSettings(key),
          r.billing.findLiveBillForSession(key, session.id),
        ]);
        const totals = totalsFor(lines, settings, discount);
        const warnings = billWarnings(counts, lines.length);
        if (existing) {
          warnings.unshift(
            `Bill #${existing.billNumber} is already issued for this table. Void it to issue a new one.`,
          );
        }
        return {
          ...totals,
          sessionId: session.id,
          tableName: session.tableName,
          currency: scope.branch.currency,
          items: lines.map((l) => ({
            orderNumber: l.orderNumber,
            name: l.name,
            variantName: l.variantName,
            addonsSummary: l.addonsSummary,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
          billableOrderCount: counts.billableOrderCount,
          pendingOrderCount: counts.pendingOrderCount,
          warnings,
          existingBillId: existing?.id ?? null,
        };
      });
    },

    /** Issue a bill for a session. Returns `created: false` for an identical replay. */
    async generate(
      scope: BranchScope,
      input: GenerateBillInput,
      meta: RequestMeta,
    ): Promise<{ bill: BillDto; created: boolean }> {
      scope.require("bills.generate");
      const discount = normalizeDiscount(input.discount);
      requireDiscountPermission(scope, discount);
      const key = keyOf(scope);

      const result = await tx.run(async (r) => {
        const session = await r.billing.findSession(key, input.sessionId, { lock: true });
        if (!session) throw notFound("Table session");
        if (session.status === "CLOSED") throw conflict("This table session is already closed");

        const { lines } = await sessionSnapshot(r, key, session.id);
        const settings = await r.billing.loadSettings(key);
        if (lines.length === 0) {
          throw conflict("There is nothing to bill for this table yet");
        }
        const totals = totalsFor(lines, settings, discount);

        const existing = await r.billing.findLiveBillForSession(key, session.id);
        if (existing) {
          if (sameBillContent(existing, totals, lines.length, discount)) {
            return { billId: existing.id, created: false, session };
          }
          throw conflict("A bill already exists — void it to re-issue", {
            billId: existing.id,
          });
        }

        const now = clock.now();
        const billNumber = await r.billing.nextBillNumber(key.branchId);
        const billId = await r.billing.insertBill(key, {
          sessionId: session.id,
          tableId: session.tableId,
          billNumber,
          currency: scope.branch.currency,
          subtotal: totals.subtotal,
          discount: discount
            ? { type: discount.type, value: discount.value, reason: discount.reason ?? null }
            : null,
          discountAmount: totals.discountAmount,
          serviceChargeBps: totals.serviceChargeBps,
          serviceChargeAmount: totals.serviceChargeAmount,
          pricesIncludeTax: totals.pricesIncludeTax,
          taxBreakdown: totals.taxes,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          issuedBy: scope.actor.userId,
          issuedAt: now,
          lines,
        });
        const moved = await r.billing.updateSession(key, session.id, session.version, {
          status: "BILLED",
        });
        if (!moved) throw new DomainError("STALE_VERSION", "The table changed. Try again.");
        await r.billing.insertHistory(key, {
          billId,
          action: "BILL_ISSUED",
          amount: totals.grandTotal,
          balanceBefore: null,
          balanceAfter: totals.grandTotal,
          paymentStatusAfter: totals.grandTotal === 0 ? "PAID" : "UNPAID",
          actorUserId: scope.actor.userId,
        });
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "bill.generated",
          {
            workspaceId: key.workspaceId,
            branchId: key.branchId,
            targetType: "bill",
            targetId: billId,
          },
          {
            billNumber,
            sessionId: session.id,
            itemCount: lines.length,
            subtotal: totals.subtotal,
            discountAmount: totals.discountAmount,
            grandTotal: totals.grandTotal,
          },
        );
        return { billId, created: true, session };
      });

      if (result.created) {
        await publish(key, "bill.generated", {
          billId: result.billId,
          sessionId: result.session.id,
          tableId: result.session.tableId,
        });
      }
      return { bill: await loadBillDto(key, result.billId), created: result.created };
    },

    async get(scope: BranchScope, billId: string): Promise<BillDto> {
      scope.require("bills.view");
      return loadBillDto(keyOf(scope), billId);
    },

    async receipt(scope: BranchScope, billId: string): Promise<ReceiptDto> {
      scope.require("bills.view");
      const key = keyOf(scope);
      const bill = await loadBillDto(key, billId);
      const context = await tx.read((r) => r.billing.receiptContext(key));
      return { bill, ...context };
    },

    async list(scope: BranchScope, query: BillListQuery): Promise<BillListResponse> {
      scope.require("bills.view");
      const key = keyOf(scope);
      const range =
        query.from || query.to
          ? localDayRange(scope.branch.timezone, clock.now(), query.from, query.to)
          : null;
      const { items, total } = await tx.read((r) =>
        r.billing.listBills(key, {
          paymentStatus: query.paymentStatus,
          status: query.status,
          page: query.page,
          pageSize: query.pageSize,
          start: range?.start,
          end: range?.end,
        }),
      );
      return { items, total, page: query.page, pageSize: query.pageSize };
    },

    async queue(scope: BranchScope): Promise<CashierQueueDto> {
      scope.require("bills.view");
      const key = keyOf(scope);
      return tx.read(async (r) => {
        const [sessions, openBills, settings] = await Promise.all([
          r.billing.listSessionsAwaitingBill(key),
          r.billing.listOpenBills(key),
          r.billing.loadSettings(key),
        ]);
        return {
          currency: scope.branch.currency,
          timezone: scope.branch.timezone,
          config: {
            paymentMethods: PAYMENT_METHODS.filter((m) => settings.paymentMethods.includes(m)),
            requireFullPaymentToClose: settings.requireFullPaymentToClose,
            serviceChargeBps: settings.serviceChargeBps,
            pricesIncludeTax: settings.pricesIncludeTax,
          },
          sessions,
          openBills,
        };
      });
    },

    recordPayment(
      scope: BranchScope,
      billId: string,
      input: {
        method: PaymentMethod;
        amount: number;
        tendered?: number;
        reference?: string;
        note?: string;
        idempotencyKey: string;
      },
      meta: RequestMeta,
    ): Promise<PaymentResultDto> {
      scope.require("payments.record");
      return addLedgerEntry(scope, billId, "PAYMENT", input, meta);
    },

    refund(
      scope: BranchScope,
      billId: string,
      input: {
        method: PaymentMethod;
        amount: number;
        reference?: string;
        note: string;
        idempotencyKey: string;
      },
      meta: RequestMeta,
    ): Promise<PaymentResultDto> {
      scope.require("payments.refund");
      return addLedgerEntry(scope, billId, "REFUND", input, meta);
    },

    async voidPayment(
      scope: BranchScope,
      paymentId: string,
      reason: string,
      meta: RequestMeta,
    ): Promise<BillDto> {
      scope.require("payments.refund");
      const key = keyOf(scope);
      const out = await tx.run(async (r) => {
        const target = await r.billing.findPayment(key, paymentId);
        if (!target) throw notFound("Payment");
        const bill = await r.billing.findBill(key, target.billId, { lock: true });
        if (!bill) throw notFound("Payment");
        assertBillOpenForMoney(bill);
        const ledger = await r.billing.listLedger(bill.id);
        const entry = ledger.find((p) => p.id === paymentId);
        if (!entry || entry.status === "VOIDED") throw conflict("This payment is already voided");

        const before = computeBalance(bill.grandTotal, ledgerOf(ledger));
        const after = computeBalance(
          bill.grandTotal,
          ledgerOf(
            ledger.map((p) => (p.id === paymentId ? { ...p, status: "VOIDED" as const } : p)),
          ),
        );
        if (after.netPaid > bill.grandTotal) {
          throw new DomainError(
            "PAYMENT_REJECTED",
            "Voiding this refund would make the bill overpaid. Record a refund instead.",
          );
        }
        if (after.netPaid < 0) {
          throw new DomainError(
            "PAYMENT_REJECTED",
            "Void the refunds on this bill before voiding this payment.",
          );
        }
        const now = clock.now();
        const voided = await r.billing.voidPayment(key, paymentId, {
          voidedAt: now,
          voidedBy: scope.actor.userId,
          voidReason: reason,
        });
        if (!voided) throw conflict("This payment is already voided");
        await applyBalance(r, key, bill, after);
        await r.billing.insertHistory(key, {
          billId: bill.id,
          paymentId,
          action: "VOIDED",
          amount: entry.amount,
          balanceBefore: before.balanceDue,
          balanceAfter: after.balanceDue,
          paymentStatusAfter: after.paymentStatus,
          actorUserId: scope.actor.userId,
        });
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "payment.voided",
          {
            workspaceId: key.workspaceId,
            branchId: key.branchId,
            targetType: "payment",
            targetId: paymentId,
          },
          {
            billId: bill.id,
            billNumber: bill.billNumber,
            kind: entry.kind,
            amount: entry.amount,
            method: entry.method,
            reason,
            paymentStatus: after.paymentStatus,
          },
        );
        return { billId: bill.id, sessionId: bill.sessionId };
      });
      await publish(key, "bill.updated", out);
      return loadBillDto(key, out.billId);
    },

    async voidBill(
      scope: BranchScope,
      billId: string,
      reason: string,
      meta: RequestMeta,
    ): Promise<BillDto> {
      scope.require("bills.void");
      const key = keyOf(scope);
      const out = await tx.run(async (r) => {
        const peek = await r.billing.findBill(key, billId);
        if (!peek) throw notFound("Bill");
        // Lock order everywhere: session, then bill.
        const session = await r.billing.findSession(key, peek.sessionId, { lock: true });
        const bill = await r.billing.findBill(key, billId, { lock: true });
        if (!bill || !session) throw notFound("Bill");
        if (bill.status === "VOID") throw conflict("This bill is already voided");
        if (bill.status === "CLOSED") throw conflict("A closed bill can't be voided");
        const ledger = await r.billing.listLedger(bill.id);
        const balance = computeBalance(bill.grandTotal, ledgerOf(ledger));
        if (balance.netPaid > 0) {
          throw conflict("Void or refund the payments on this bill before voiding it", {
            netPaid: balance.netPaid,
          });
        }
        const now = clock.now();
        const ok = await r.billing.setBillStatus(key, bill.id, bill.version, {
          status: "VOID",
          voidedAt: now,
          voidedBy: scope.actor.userId,
          voidReason: reason,
        });
        if (!ok) throw staleBill();
        if (session.status === "BILLED") {
          const reopened = await r.billing.updateSession(key, session.id, session.version, {
            status: session.billRequestedAt ? "BILL_REQUESTED" : "OPEN",
          });
          if (!reopened) throw new DomainError("STALE_VERSION", "The table changed. Try again.");
        }
        await r.billing.insertHistory(key, {
          billId: bill.id,
          action: "BILL_VOIDED",
          amount: bill.grandTotal,
          balanceBefore: bill.balanceDue,
          balanceAfter: 0,
          paymentStatusAfter: balance.paymentStatus,
          actorUserId: scope.actor.userId,
        });
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "bill.voided",
          {
            workspaceId: key.workspaceId,
            branchId: key.branchId,
            targetType: "bill",
            targetId: bill.id,
          },
          { billNumber: bill.billNumber, grandTotal: bill.grandTotal, reason },
        );
        return { billId: bill.id, sessionId: session.id, tableId: session.tableId };
      });
      await publish(key, "bill.voided", out);
      return loadBillDto(key, out.billId);
    },

    async closeSession(
      scope: BranchScope,
      sessionId: string,
      meta: RequestMeta,
    ): Promise<SessionCloseResultDto> {
      scope.require("sessions.manage");
      const key = keyOf(scope);
      const out = await tx.run(async (r) => {
        const session = await r.billing.findSession(key, sessionId, { lock: true });
        if (!session) throw notFound("Table session");
        if (session.status === "CLOSED") throw conflict("This table session is already closed");
        const orders = await r.billing.listSessionOrders(key, session.id);
        const settings = await r.billing.loadSettings(key);
        const live = await r.billing.findLiveBillForSession(key, session.id);
        const bill = live ? await r.billing.findBill(key, live.id, { lock: true }) : null;
        const counts = countSessionOrders(orders);
        const check = checkSessionClosure(
          {
            activeOrderCount: counts.activeOrderCount,
            pendingOrderCount: counts.pendingOrderCount,
            hasBillableOrders: counts.billableOrderCount > 0,
            bill: bill ? { balanceDue: bill.balanceDue, status: bill.status } : null,
          },
          { requireFullPayment: settings.requireFullPaymentToClose },
        );
        if (!check.allowed) {
          throw new DomainError("CONFLICT", check.reasons[0] ?? "This table can't be closed yet", {
            details: { reasons: check.reasons },
          });
        }
        const now = clock.now();
        const closed = await r.billing.updateSession(key, session.id, session.version, {
          status: "CLOSED",
          closedAt: now,
          closedBy: scope.actor.userId,
        });
        if (!closed) throw new DomainError("STALE_VERSION", "The table changed. Try again.");
        if (bill && bill.status === "ISSUED") {
          const ok = await r.billing.setBillStatus(key, bill.id, bill.version, {
            status: "CLOSED",
            closedAt: now,
          });
          if (!ok) throw staleBill();
          await r.billing.insertHistory(key, {
            billId: bill.id,
            action: "BILL_CLOSED",
            amount: null,
            balanceBefore: bill.balanceDue,
            balanceAfter: bill.balanceDue,
            paymentStatusAfter: bill.paymentStatus,
            actorUserId: scope.actor.userId,
          });
        }
        const completedOrders = await r.billing.completeServedOrders(
          key,
          session.id,
          now,
          "Table closed",
        );
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "session.closed",
          {
            workspaceId: key.workspaceId,
            branchId: key.branchId,
            targetType: "table_session",
            targetId: session.id,
          },
          {
            tableId: session.tableId,
            billId: bill?.id ?? null,
            balanceDue: bill?.balanceDue ?? 0,
            completedOrders,
          },
        );
        return {
          sessionId: session.id,
          tableId: session.tableId,
          billId: bill?.id ?? null,
          closedAt: now,
          completedOrders,
        };
      });
      await publish(key, "session.closed", out);
      return {
        sessionId: out.sessionId,
        status: "CLOSED",
        closedAt: out.closedAt.toISOString(),
        billId: out.billId,
        completedOrders: out.completedOrders,
      };
    },

    async summary(
      scope: BranchScope,
      query: { from?: string; to?: string },
    ): Promise<PaymentSummaryDto> {
      scope.require("payments.summary.view");
      const key = keyOf(scope);
      const range = localDayRange(scope.branch.timezone, clock.now(), query.from, query.to);
      const row = await tx.read((r) => r.billing.paymentSummary(key, range));
      const byMethod = Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<
        PaymentMethod,
        number
      >;
      let refunds = 0;
      for (const entry of row.byMethod) {
        if (entry.kind === "PAYMENT") byMethod[entry.method] += entry.total;
        else {
          byMethod[entry.method] -= entry.total;
          refunds += entry.total;
        }
      }
      return {
        from: range.from,
        to: range.to,
        currency: scope.branch.currency,
        totalCollected: PAYMENT_METHODS.reduce((acc, m) => acc + byMethod[m], 0),
        byMethod,
        refunds,
        outstanding: row.outstanding,
        partiallyPaidBills: row.partiallyPaidBills,
        billsIssued: row.billsIssued,
      };
    },
  };
}

export type BillingService = ReturnType<typeof createBillingService>;
