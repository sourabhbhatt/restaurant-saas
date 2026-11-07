import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BillDto, PaymentSummaryDto } from "@/contracts/billing";
import type {
  BillListResponse,
  BillPreviewDto,
  CashierQueueDto,
  PaymentResultDto,
  ReceiptDto,
  SessionCloseResultDto,
} from "@/contracts/billing-extra";
import { GET as getBillRoute } from "@/app/api/v1/bills/[billId]/route";
import { POST as recordPaymentRoute } from "@/app/api/v1/bills/[billId]/payments/route";
import { GET as receiptRoute } from "@/app/api/v1/bills/[billId]/receipt/route";
import { POST as refundRoute } from "@/app/api/v1/bills/[billId]/refunds/route";
import { POST as voidBillRoute } from "@/app/api/v1/bills/[billId]/void/route";
import {
  GET as listBillsRoute,
  POST as generateRoute,
} from "@/app/api/v1/branches/[branchId]/bills/route";
import { POST as previewRoute } from "@/app/api/v1/branches/[branchId]/bills/preview/route";
import { GET as queueRoute } from "@/app/api/v1/branches/[branchId]/bills/queue/route";
import { GET as summaryRoute } from "@/app/api/v1/branches/[branchId]/payments/summary/route";
import { POST as closeRoute } from "@/app/api/v1/branches/[branchId]/sessions/[sessionId]/close/route";
import { POST as voidPaymentRoute } from "@/app/api/v1/payments/[paymentId]/void/route";
import {
  auditLogs,
  billItems,
  bills,
  branchSettings,
  idempotencyRecords,
  menuItems,
  orderItems,
  orders,
  orderStatusHistory,
  paymentHistory,
  tableSessions,
} from "@/infrastructure/database/providers/postgres/schema";
import { call, createTestContainer, type CallResult } from "@/test/harness";
import type { TestUser } from "@/test/fixtures";
import {
  addBranchStaff,
  insertMenuItem,
  insertOrder,
  openSession,
  setupBillingBranch,
  signUpBillingUser,
  type BillingBranch,
} from "@/test/fixtures-billing";
import type { Container } from "@/server/container";

let c: Container;

beforeAll(async () => {
  c = await createTestContainer();
});
afterAll(() => c.close());

let keySeq = 0;
const key = () => `test-key-${Date.now().toString(36)}-${++keySeq}`;

const errorDetails = (res: CallResult) =>
  (res.body.error as unknown as { details?: Record<string, unknown> } | undefined)?.details;

function preview(user: TestUser, branchId: string, body: unknown) {
  return call<BillPreviewDto>(previewRoute, { params: { branchId }, body, cookie: user.cookie });
}
function generate(
  user: TestUser,
  branchId: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return call<BillDto>(generateRoute, {
    params: { branchId },
    body: { idempotencyKey: key(), ...body },
    cookie: user.cookie,
    headers,
  });
}
function pay(user: TestUser, billId: string, body: Record<string, unknown>) {
  return call<PaymentResultDto>(recordPaymentRoute, {
    params: { billId },
    body: { idempotencyKey: key(), ...body },
    cookie: user.cookie,
  });
}
function payWithHeader(
  user: TestUser,
  billId: string,
  body: Record<string, unknown>,
  headerKey: string,
) {
  return call<PaymentResultDto>(recordPaymentRoute, {
    params: { billId },
    body,
    cookie: user.cookie,
    headers: { "idempotency-key": headerKey },
  });
}
function refund(user: TestUser, billId: string, body: Record<string, unknown>) {
  return call<PaymentResultDto>(refundRoute, {
    params: { billId },
    body: { idempotencyKey: key(), note: "Customer complaint", ...body },
    cookie: user.cookie,
  });
}
function getBill(user: TestUser, billId: string) {
  return call<BillDto>(getBillRoute, { params: { billId }, cookie: user.cookie });
}
function closeSession(user: TestUser, branchId: string, sessionId: string) {
  return call<SessionCloseResultDto>(closeRoute, {
    method: "POST",
    params: { branchId, sessionId },
    cookie: user.cookie,
  });
}

/** A table with: 2 × Paneer ₹250, 2 × Naan ₹50 + Butter ₹10, a cancelled line, and a pending order. */
async function seededTable(b: BillingBranch) {
  const session = await openSession(c, b);
  const paneerId = await insertMenuItem(c, b, "Paneer Tikka", 25_000);
  const served = await insertOrder(c, b, session, "SERVED", [
    { name: "Paneer Tikka", unitPrice: 25_000, quantity: 2, menuItemId: paneerId },
    {
      name: "Butter Naan",
      unitPrice: 5_000,
      quantity: 2,
      variantName: "Large",
      addons: [{ groupName: "Extras", addonName: "Butter", price: 1_000 }],
    },
    { name: "Lassi", unitPrice: 9_999, status: "CANCELLED" },
  ]);
  await insertOrder(c, b, session, "PENDING", [{ name: "Dessert", unitPrice: 30_000 }]);
  return { session, paneerId, served };
}

describe("bill preview and generation", () => {
  let b: BillingBranch;
  let table: Awaited<ReturnType<typeof seededTable>>;

  beforeAll(async () => {
    b = await setupBillingBranch(c, { settings: { serviceChargeBps: 1_000 } });
    table = await seededTable(b);
  });

  it("previews totals from order snapshots with discount, service charge and exclusive tax", async () => {
    const res = await preview(b.owner, b.branchId, {
      sessionId: table.session.sessionId,
      discount: { type: "PERCENT", value: 1_000, reason: "Regular" },
    });
    expect(res.status).toBe(200);
    const p = res.body.data!;
    // 2×25000 + 2×(5000+1000) = 62000; cancelled line and pending order excluded.
    expect(p.subtotal).toBe(62_000);
    expect(p.discountAmount).toBe(6_200);
    expect(p.serviceChargeAmount).toBe(5_580);
    expect(p.taxes).toEqual([
      { name: "CGST", rateBps: 250, amount: 1_535 },
      { name: "SGST", rateBps: 250, amount: 1_535 },
    ]);
    expect(p.taxTotal).toBe(3_070);
    expect(p.grandTotal).toBe(64_450);
    expect(p.items).toHaveLength(2);
    expect(p.items[1]).toMatchObject({
      name: "Butter Naan",
      variantName: "Large",
      addonsSummary: "Butter",
      unitPrice: 6_000,
      lineTotal: 12_000,
    });
    expect(p.pendingOrderCount).toBe(1);
    expect(p.warnings.some((w) => w.includes("pending approval"))).toBe(true);
    expect(p.existingBillId).toBeNull();
  });

  it("applies a discount sent with a null or missing reason and lowers the grand total", async () => {
    const base = await preview(b.owner, b.branchId, {
      sessionId: table.session.sessionId,
      discount: null,
    });
    expect(base.status).toBe(200);
    for (const discount of [
      { type: "PERCENT", value: 1_000, reason: null },
      { type: "PERCENT", value: 1_000 },
    ]) {
      const res = await preview(b.owner, b.branchId, {
        sessionId: table.session.sessionId,
        discount,
      });
      expect(res.status).toBe(200);
      expect(res.body.data!.discountAmount).toBeGreaterThan(0);
      expect(res.body.data!.grandTotal).toBeLessThan(base.body.data!.grandTotal);
    }
  });

  it("requires bills.discount to apply a discount", async () => {
    const waiter = await addBranchStaff(c, b, "waiter");
    const denied = await preview(waiter, b.branchId, {
      sessionId: table.session.sessionId,
      discount: { type: "FLAT", value: 500 },
    });
    expect(denied.status).toBe(403);
    const ok = await preview(waiter, b.branchId, { sessionId: table.session.sessionId });
    expect(ok.status).toBe(200);
    const genDenied = await generate(waiter, b.branchId, {
      sessionId: table.session.sessionId,
      discount: { type: "FLAT", value: 500 },
    });
    expect(genDenied.status).toBe(403);
  });

  it("generates a bill with snapshots; duplicates return the live bill or 409", async () => {
    const res = await generate(b.owner, b.branchId, {
      sessionId: table.session.sessionId,
      discount: { type: "PERCENT", value: 1_000, reason: "Regular" },
    });
    expect(res.status).toBe(201);
    const bill = res.body.data!;
    expect(bill).toMatchObject({
      billNumber: 1,
      status: "ISSUED",
      paymentStatus: "UNPAID",
      currency: "INR",
      grandTotal: 64_450,
      balanceDue: 64_450,
      amountPaid: 0,
      pricesIncludeTax: false,
      serviceChargeBps: 1_000,
      discount: { type: "PERCENT", value: 1_000, reason: "Regular" },
    });
    expect(bill.items.map((i) => i.name)).toEqual(["Paneer Tikka", "Butter Naan"]);

    const [session] = await c.db
      .select()
      .from(tableSessions)
      .where(eq(tableSessions.id, table.session.sessionId));
    expect(session!.status).toBe("BILLED");
    const history = await c.db
      .select()
      .from(paymentHistory)
      .where(eq(paymentHistory.billId, bill.id));
    expect(history.map((h) => h.action)).toEqual(["BILL_ISSUED"]);
    const audits = await c.db.select().from(auditLogs).where(eq(auditLogs.targetId, bill.id));
    expect(audits.some((a) => a.action === "bill.generated")).toBe(true);

    // Same content again (new key) → existing live bill, 200.
    const again = await generate(b.owner, b.branchId, {
      sessionId: table.session.sessionId,
      discount: { type: "PERCENT", value: 1_000, reason: "Regular" },
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.data!.id).toBe(bill.id);

    // Different content → 409.
    const different = await generate(b.owner, b.branchId, { sessionId: table.session.sessionId });
    expect(different.status).toBe(409);
    expect(different.body.error!.message).toMatch(/void it to re-issue/);

    const count = await c.db
      .select()
      .from(bills)
      .where(eq(bills.sessionId, table.session.sessionId));
    expect(count).toHaveLength(1);
  });

  it("replays the stored response for a repeated Idempotency-Key header", async () => {
    const session = await openSession(c, b);
    await insertOrder(c, b, session, "SERVED", [{ name: "Tea", unitPrice: 2_000 }]);
    const body = { sessionId: session.sessionId, idempotencyKey: key() };
    const headers = { "idempotency-key": key() };
    const first = await generate(b.owner, b.branchId, body, headers);
    expect(first.status).toBe(201);
    const second = await generate(b.owner, b.branchId, body, headers);
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replay")).toBe("true");
    expect(second.body.data!.id).toBe(first.body.data!.id);
  });

  it("keeps issued bills immutable when menu prices or order items change", async () => {
    const [live] = await c.db
      .select()
      .from(bills)
      .where(eq(bills.sessionId, table.session.sessionId));
    await c.db.update(menuItems).set({ price: 99_900 }).where(eq(menuItems.id, table.paneerId));
    await c.db
      .update(orderItems)
      .set({ unitPrice: 1, lineTotal: 2, itemName: "Changed" })
      .where(eq(orderItems.orderId, table.served.orderId));
    const res = await getBill(b.owner, live!.id);
    expect(res.status).toBe(200);
    expect(res.body.data!.grandTotal).toBe(64_450);
    expect(res.body.data!.items[0]).toMatchObject({ name: "Paneer Tikka", lineTotal: 50_000 });
  });

  it("refuses to bill a session with nothing billable", async () => {
    const session = await openSession(c, b);
    await insertOrder(c, b, session, "PENDING", [{ name: "Soup", unitPrice: 8_000 }]);
    const res = await generate(b.owner, b.branchId, { sessionId: session.sessionId });
    expect(res.status).toBe(409);
  });
});

describe("inclusive tax", () => {
  it("extracts tax from tax-inclusive prices, with a flat discount", async () => {
    const b = await setupBillingBranch(c, {
      taxes: [{ name: "GST", rateBps: 500 }],
      settings: { pricesIncludeTax: true, serviceChargeBps: 0 },
    });
    const session = await openSession(c, b);
    await insertOrder(c, b, session, "SERVED", [{ name: "Thali", unitPrice: 10_500 }]);
    const plain = await preview(b.owner, b.branchId, { sessionId: session.sessionId });
    expect(plain.body.data).toMatchObject({
      subtotal: 10_500,
      taxTotal: 500,
      grandTotal: 10_500,
      pricesIncludeTax: true,
    });
    const res = await generate(b.owner, b.branchId, {
      sessionId: session.sessionId,
      discount: { type: "FLAT", value: 500 },
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      subtotal: 10_500,
      discountAmount: 500,
      taxes: [{ name: "GST", rateBps: 500, amount: 476 }],
      grandTotal: 10_000,
      pricesIncludeTax: true,
    });
  });
});

describe("payments", () => {
  let b: BillingBranch;
  let cashier: TestUser;

  beforeAll(async () => {
    b = await setupBillingBranch(c, {
      taxes: [],
      settings: { paymentMethods: ["CASH", "UPI"], autoCompleteOnPayment: true },
    });
    cashier = await addBranchStaff(c, b, "cashier");
  });

  async function billFor(total: number) {
    const session = await openSession(c, b);
    const order = await insertOrder(c, b, session, "SERVED", [{ name: "Meal", unitPrice: total }]);
    const res = await generate(b.owner, b.branchId, { sessionId: session.sessionId });
    expect(res.status).toBe(201);
    return { session, order, bill: res.body.data! };
  }

  it("moves UNPAID → PARTIALLY_PAID → PAID with correct balances and cash change", async () => {
    const { bill, order, session } = await billFor(100_000);
    const first = await pay(cashier, bill.id, { method: "CASH", amount: 40_000, tendered: 50_000 });
    expect(first.status).toBe(201);
    expect(first.body.data!.change).toBe(10_000);
    expect(first.body.data!.bill).toMatchObject({
      paymentStatus: "PARTIALLY_PAID",
      amountPaid: 40_000,
      balanceDue: 60_000,
    });
    expect(first.body.data!.payment).toMatchObject({
      kind: "PAYMENT",
      method: "CASH",
      amount: 40_000,
      tendered: 50_000,
      status: "CONFIRMED",
    });
    // Served orders are untouched until the bill is fully paid.
    const [mid] = await c.db.select().from(orders).where(eq(orders.id, order.orderId));
    expect(mid!.status).toBe("SERVED");

    const second = await pay(cashier, bill.id, {
      method: "UPI",
      amount: 60_000,
      reference: "UPI123",
    });
    expect(second.status).toBe(201);
    expect(second.body.data!.change).toBeNull();
    expect(second.body.data!.bill).toMatchObject({
      paymentStatus: "PAID",
      amountPaid: 100_000,
      balanceDue: 0,
    });
    const [done] = await c.db.select().from(orders).where(eq(orders.id, order.orderId));
    expect(done!.status).toBe("COMPLETED");
    const hist = await c.db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, order.orderId));
    expect(hist.some((h) => h.actorType === "SYSTEM" && h.toStatus === "COMPLETED")).toBe(true);

    const ledger = await c.db
      .select()
      .from(paymentHistory)
      .where(eq(paymentHistory.billId, bill.id));
    expect(ledger.filter((h) => h.action === "RECORDED")).toHaveLength(2);
    const audits = await c.db.select().from(auditLogs).where(eq(auditLogs.targetId, bill.id));
    const recorded = audits.filter((a) => a.action === "payment.recorded");
    expect(recorded).toHaveLength(2);
    expect(JSON.stringify(recorded.map((a) => a.metadata))).not.toContain("UPI123");

    const extra = await pay(cashier, bill.id, { method: "CASH", amount: 1 });
    expect(extra.status).toBe(422);
    expect(extra.body.error!.code).toBe("PAYMENT_REJECTED");
    expect(session.sessionId).toBeTruthy();
  });

  it("rejects overpayment, disabled methods and short cash tender with 422", async () => {
    const { bill } = await billFor(10_000);
    const over = await pay(cashier, bill.id, { method: "CASH", amount: 10_001 });
    expect(over.status).toBe(422);
    expect(over.body.error!.code).toBe("PAYMENT_REJECTED");
    const card = await pay(cashier, bill.id, { method: "CARD", amount: 1_000 });
    expect(card.status).toBe(422);
    expect(card.body.error!.fieldErrors?.method).toBeTruthy();
    const short = await pay(cashier, bill.id, { method: "CASH", amount: 5_000, tendered: 4_000 });
    expect(short.status).toBe(422);
    const zero = await pay(cashier, bill.id, { method: "CASH", amount: 0 });
    expect(zero.status).toBe(422);
    const after = await getBill(cashier, bill.id);
    expect(after.body.data!.amountPaid).toBe(0);
  });

  it("replays a payment with the same idempotency key without double counting", async () => {
    const { bill } = await billFor(50_000);
    const body = { method: "CASH", amount: 20_000, idempotencyKey: key() };
    const first = await pay(cashier, bill.id, body);
    const second = await pay(cashier, bill.id, body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data!.replayed).toBe(true);
    expect(second.body.data!.payment.id).toBe(first.body.data!.payment.id);
    expect(second.body.data!.bill.amountPaid).toBe(20_000);
    const mismatch = await pay(cashier, bill.id, { ...body, amount: 30_000 });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error!.code).toBe("IDEMPOTENCY_MISMATCH");
    const final = await getBill(cashier, bill.id);
    expect(final.body.data!.payments).toHaveLength(1);
    expect(final.body.data!.balanceDue).toBe(30_000);
  });

  it("same user replay of an Idempotency-Key header still works", async () => {
    const { bill } = await billFor(50_000);
    const body = { method: "CASH", amount: 20_000, idempotencyKey: key() };
    const headerKey = key();
    const first = await payWithHeader(cashier, bill.id, body, headerKey);
    const second = await payWithHeader(cashier, bill.id, body, headerKey);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replay")).toBe("true");
    expect(second.body.data!.payment.id).toBe(first.body.data!.payment.id);
  });

  it("another tenant's user cannot replay a payment response", async () => {
    const { bill } = await billFor(50_000);
    const body = { method: "CASH", amount: 20_000, idempotencyKey: key() };
    const headerKey = key();
    const first = await payWithHeader(cashier, bill.id, body, headerKey);
    expect(first.status).toBe(201);
    const other = await setupBillingBranch(c, { taxes: [] });
    const probe = await payWithHeader(other.owner, bill.id, body, headerKey);
    expect(probe.status).toBe(404);
    expect(probe.headers.get("idempotent-replay")).toBeNull();
  });

  it("payment retry with pre-change key does not double-charge", async () => {
    const { bill } = await billFor(50_000);
    const body = { method: "CASH", amount: 20_000, idempotencyKey: key() };
    const first = await pay(cashier, bill.id, body);
    expect(first.status).toBe(201);
    const headerKey = key();
    // A record written before the scope carried the caller (old scope format).
    await c.db.insert(idempotencyRecords).values({
      scope: `payment:${bill.id}`,
      key: headerKey,
      requestHash: "stale-hash",
      statusCode: 201,
      response: { data: first.body.data },
    });
    const retry = await payWithHeader(cashier, bill.id, body, headerKey);
    expect([200, 201]).toContain(retry.status);
    const final = await getBill(cashier, bill.id);
    expect(final.body.data!.payments).toHaveLength(1);
    expect(final.body.data!.amountPaid).toBe(20_000);
  });

  it("serializes concurrent payments: the one exceeding the balance is rejected", async () => {
    const { bill } = await billFor(10_000);
    const results = await Promise.all([
      pay(cashier, bill.id, { method: "CASH", amount: 6_000 }),
      pay(cashier, bill.id, { method: "UPI", amount: 6_000 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
    const final = await getBill(cashier, bill.id);
    expect(final.body.data).toMatchObject({ amountPaid: 6_000, balanceDue: 4_000 });
  });

  it("refunds (partial then full) and voids payments, recomputing from the ledger", async () => {
    const { bill } = await billFor(20_000);
    const paid = await pay(cashier, bill.id, { method: "CASH", amount: 20_000 });
    expect(paid.body.data!.bill.paymentStatus).toBe("PAID");

    // Cashier lacks payments.refund.
    expect((await refund(cashier, bill.id, { method: "CASH", amount: 5_000 })).status).toBe(403);

    const partial = await refund(b.owner, bill.id, { method: "CASH", amount: 5_000 });
    expect(partial.status).toBe(201);
    expect(partial.body.data!.bill).toMatchObject({
      paymentStatus: "PARTIALLY_PAID",
      amountRefunded: 5_000,
      balanceDue: 5_000,
    });
    const tooMuch = await refund(b.owner, bill.id, { method: "CASH", amount: 15_001 });
    expect(tooMuch.status).toBe(422);
    const full = await refund(b.owner, bill.id, { method: "CASH", amount: 15_000 });
    expect(full.body.data!.bill.paymentStatus).toBe("REFUNDED");

    // Void the second refund → back to partially refunded.
    const voided = await call<BillDto>(voidPaymentRoute, {
      params: { paymentId: full.body.data!.payment.id },
      body: { reason: "Entered twice" },
      cookie: b.owner.cookie,
    });
    expect(voided.status).toBe(200);
    expect(voided.body.data).toMatchObject({
      paymentStatus: "PARTIALLY_PAID",
      amountRefunded: 5_000,
      balanceDue: 5_000,
    });
    const entry = voided.body.data!.payments.find((p) => p.id === full.body.data!.payment.id);
    expect(entry).toMatchObject({ status: "VOIDED", voidReason: "Entered twice" });

    const twice = await call(voidPaymentRoute, {
      params: { paymentId: full.body.data!.payment.id },
      body: { reason: "Entered twice" },
      cookie: b.owner.cookie,
    });
    expect(twice.status).toBe(409);
    // Cashier cannot void payments.
    const denied = await call(voidPaymentRoute, {
      params: { paymentId: paid.body.data!.payment.id },
      body: { reason: "Mistake" },
      cookie: cashier.cookie,
    });
    expect(denied.status).toBe(403);
  });

  it("forbids kitchen staff and waiters from recording payments", async () => {
    const { bill } = await billFor(5_000);
    const kitchen = await addBranchStaff(c, b, "kitchen_staff");
    const waiter = await addBranchStaff(c, b, "waiter");
    expect((await pay(kitchen, bill.id, { method: "CASH", amount: 1_000 })).status).toBe(403);
    expect((await pay(waiter, bill.id, { method: "CASH", amount: 1_000 })).status).toBe(403);
    // Waiters can view bills.
    expect((await getBill(waiter, bill.id)).status).toBe(200);
    // Kitchen staff cannot.
    expect((await getBill(kitchen, bill.id)).status).toBe(403);
  });

  it("voids a bill only without net payments and lets the table be re-billed", async () => {
    const { bill, session } = await billFor(8_000);
    const p = await pay(cashier, bill.id, { method: "CASH", amount: 3_000 });
    const blocked = await call(voidBillRoute, {
      params: { billId: bill.id },
      body: { reason: "Wrong table" },
      cookie: b.owner.cookie,
    });
    expect(blocked.status).toBe(409);
    // Cashier lacks bills.void.
    const cashierVoid = await call(voidBillRoute, {
      params: { billId: bill.id },
      body: { reason: "Wrong table" },
      cookie: cashier.cookie,
    });
    expect(cashierVoid.status).toBe(403);
    await call(voidPaymentRoute, {
      params: { paymentId: p.body.data!.payment.id },
      body: { reason: "Wrong table" },
      cookie: b.owner.cookie,
    });
    const ok = await call<BillDto>(voidBillRoute, {
      params: { billId: bill.id },
      body: { reason: "Wrong table" },
      cookie: b.owner.cookie,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data!.status).toBe("VOID");
    const [s] = await c.db
      .select()
      .from(tableSessions)
      .where(eq(tableSessions.id, session.sessionId));
    expect(s!.status).toBe("OPEN");
    expect((await pay(cashier, bill.id, { method: "CASH", amount: 100 })).status).toBe(409);

    const regenerated = await generate(b.owner, b.branchId, { sessionId: session.sessionId });
    expect(regenerated.status).toBe(201);
    expect(regenerated.body.data!.id).not.toBe(bill.id);
    expect(regenerated.body.data!.billNumber).toBeGreaterThan(bill.billNumber);
  });

  it("summarizes today's collections by method", async () => {
    const res = await call<PaymentSummaryDto>(summaryRoute, {
      params: { branchId: b.branchId },
      cookie: cashier.cookie,
    });
    expect(res.status).toBe(200);
    const s = res.body.data!;
    // CASH: 40000 + 20000 (refunded 5000+15000, one refund voided) + 20000 + 6000 ... computed below.
    expect(s.byMethod.CARD).toBe(0);
    expect(s.byMethod.UPI).toBeGreaterThanOrEqual(60_000);
    expect(s.refunds).toBe(5_000);
    expect(s.totalCollected).toBe(
      s.byMethod.CASH + s.byMethod.UPI + s.byMethod.CARD + s.byMethod.OTHER,
    );
    expect(s.billsIssued).toBeGreaterThanOrEqual(6);
    expect(s.partiallyPaidBills).toBeGreaterThanOrEqual(2);
    expect(s.outstanding).toBeGreaterThan(0);
    const waiter = await addBranchStaff(c, b, "waiter");
    const denied = await call(summaryRoute, {
      params: { branchId: b.branchId },
      cookie: waiter.cookie,
    });
    expect(denied.status).toBe(403);
  });

  it("lists bills with payment status filter and pagination", async () => {
    const paid = await call<BillListResponse>(listBillsRoute, {
      params: { branchId: b.branchId },
      path: "/api/test?paymentStatus=PAID&pageSize=1",
      cookie: cashier.cookie,
    });
    expect(paid.status).toBe(200);
    expect(paid.body.data!.items).toHaveLength(1);
    expect(paid.body.data!.total).toBeGreaterThanOrEqual(1);
    expect(paid.body.data!.items.every((i) => i.paymentStatus === "PAID")).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    const ranged = await call<BillListResponse>(listBillsRoute, {
      params: { branchId: b.branchId },
      path: `/api/test?from=2000-01-01&to=2000-01-02`,
      cookie: cashier.cookie,
    });
    expect(ranged.body.data!.total).toBe(0);
    const bad = await call(listBillsRoute, {
      params: { branchId: b.branchId },
      path: `/api/test?paymentStatus=NOPE&from=${today}`,
      cookie: cashier.cookie,
    });
    expect(bad.status).toBe(422);
  });
});

describe("closing a table session", () => {
  it("is blocked with a balance due, allowed once paid, and completes served orders", async () => {
    const b = await setupBillingBranch(c, {
      taxes: [],
      settings: { autoCompleteOnPayment: false },
    });
    const cashier = await addBranchStaff(c, b, "cashier");
    const session = await openSession(c, b, "Patio 1", "BILL_REQUESTED");
    const order = await insertOrder(c, b, session, "SERVED", [
      { name: "Pizza", unitPrice: 30_000 },
    ]);

    const noBill = await closeSession(cashier, b.branchId, session.sessionId);
    expect(noBill.status).toBe(409);
    expect(errorDetails(noBill)?.reasons).toEqual(["Generate the bill before closing"]);

    const queue = await call<CashierQueueDto>(queueRoute, {
      params: { branchId: b.branchId },
      cookie: cashier.cookie,
    });
    expect(queue.status).toBe(200);
    const waiting = queue.body.data!.sessions.find((s) => s.sessionId === session.sessionId);
    expect(waiting).toMatchObject({ tableName: "Patio 1", runningSubtotal: 30_000 });
    expect(queue.body.data!.config.paymentMethods).toEqual(["CASH", "UPI", "CARD"]);

    const bill = (await generate(cashier, b.branchId, { sessionId: session.sessionId })).body.data!;
    await pay(cashier, bill.id, { method: "CASH", amount: 10_000 });
    const due = await closeSession(cashier, b.branchId, session.sessionId);
    expect(due.status).toBe(409);
    expect(due.body.error!.code).toBe("CONFLICT");
    expect(errorDetails(due)?.reasons).toEqual(["The bill has an outstanding balance"]);

    const queue2 = await call<CashierQueueDto>(queueRoute, {
      params: { branchId: b.branchId },
      cookie: cashier.cookie,
    });
    expect(queue2.body.data!.sessions.some((s) => s.sessionId === session.sessionId)).toBe(false);
    expect(queue2.body.data!.openBills.some((o) => o.id === bill.id)).toBe(true);

    await pay(cashier, bill.id, { method: "UPI", amount: 20_000 });
    // autoCompleteOnPayment is off: order stays SERVED until closure.
    const [stillServed] = await c.db.select().from(orders).where(eq(orders.id, order.orderId));
    expect(stillServed!.status).toBe("SERVED");

    const closed = await closeSession(cashier, b.branchId, session.sessionId);
    expect(closed.status).toBe(200);
    expect(closed.body.data).toMatchObject({
      status: "CLOSED",
      billId: bill.id,
      completedOrders: 1,
    });
    const [s] = await c.db
      .select()
      .from(tableSessions)
      .where(eq(tableSessions.id, session.sessionId));
    expect(s!.status).toBe("CLOSED");
    expect(s!.closedBy).toBe(cashier.userId);
    const after = await getBill(cashier, bill.id);
    expect(after.body.data!.status).toBe("CLOSED");
    expect(after.body.data!.closedAt).not.toBeNull();
    const [o] = await c.db.select().from(orders).where(eq(orders.id, order.orderId));
    expect(o!.status).toBe("COMPLETED");
    const audits = await c.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.targetId, session.sessionId));
    expect(audits.some((a) => a.action === "session.closed")).toBe(true);

    expect((await closeSession(cashier, b.branchId, session.sessionId)).status).toBe(409);
  });

  it("is blocked by pending orders and allows closing an empty session", async () => {
    const b = await setupBillingBranch(c, { taxes: [] });
    const session = await openSession(c, b);
    await insertOrder(c, b, session, "PENDING", [{ name: "Juice", unitPrice: 5_000 }]);
    const blocked = await closeSession(b.owner, b.branchId, session.sessionId);
    expect(blocked.status).toBe(409);
    expect(errorDetails(blocked)?.reasons).toContain("Approve or reject pending orders first");

    const empty = await openSession(c, b);
    const ok = await closeSession(b.owner, b.branchId, empty.sessionId);
    expect(ok.status).toBe(200);
    expect(ok.body.data!.billId).toBeNull();

    const kitchen = await addBranchStaff(c, b, "kitchen_staff");
    expect((await closeSession(kitchen, b.branchId, session.sessionId)).status).toBe(403);
  });

  it("allows closing with a balance when the branch does not require full payment", async () => {
    const b = await setupBillingBranch(c, {
      taxes: [],
      settings: { requireFullPaymentToClose: false },
    });
    const session = await openSession(c, b);
    await insertOrder(c, b, session, "SERVED", [{ name: "Coffee", unitPrice: 4_000 }]);
    await generate(b.owner, b.branchId, { sessionId: session.sessionId });
    const res = await closeSession(b.owner, b.branchId, session.sessionId);
    expect(res.status).toBe(200);
    const items = await c.db.select().from(billItems);
    expect(items.length).toBeGreaterThan(0);
  });
});

describe("tenant isolation", () => {
  it("returns 404 for bills, payments and sessions of other workspaces and branches", async () => {
    const b = await setupBillingBranch(c, { taxes: [] });
    const session = await openSession(c, b);
    await insertOrder(c, b, session, "SERVED", [{ name: "Biryani", unitPrice: 20_000 }]);
    const bill = (await generate(b.owner, b.branchId, { sessionId: session.sessionId })).body.data!;
    const payment = (await pay(b.owner, bill.id, { method: "CASH", amount: 1_000 })).body.data!;

    // Owner of another workspace.
    const other = await setupBillingBranch(c, { taxes: [] });
    expect((await getBill(other.owner, bill.id)).status).toBe(404);
    expect((await pay(other.owner, bill.id, { method: "CASH", amount: 1_000 })).status).toBe(404);
    expect((await refund(other.owner, bill.id, { method: "CASH", amount: 500 })).status).toBe(404);
    expect(
      (
        await call(voidPaymentRoute, {
          params: { paymentId: payment.payment.id },
          body: { reason: "Probe" },
          cookie: other.owner.cookie,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(voidBillRoute, {
          params: { billId: bill.id },
          body: { reason: "Probe" },
          cookie: other.owner.cookie,
        })
      ).status,
    ).toBe(404);
    expect(
      (await call(receiptRoute, { params: { billId: bill.id }, cookie: other.owner.cookie }))
        .status,
    ).toBe(404);
    expect(
      (await call(listBillsRoute, { params: { branchId: b.branchId }, cookie: other.owner.cookie }))
        .status,
    ).toBe(404);
    expect((await closeSession(other.owner, b.branchId, session.sessionId)).status).toBe(404);

    // Using one's own branch id with another tenant's session id → 404, not a leak.
    expect(
      (await preview(other.owner, other.branchId, { sessionId: session.sessionId })).status,
    ).toBe(404);
    expect((await closeSession(other.owner, other.branchId, session.sessionId)).status).toBe(404);
    expect(
      (await generate(other.owner, other.branchId, { sessionId: session.sessionId })).status,
    ).toBe(404);

    // Cashier assigned to a different branch of the same workspace.
    const second = await setupBillingBranch(c, { taxes: [], owner: b.owner });
    const foreignCashier = await addBranchStaff(c, second, "cashier");
    expect((await getBill(foreignCashier, bill.id)).status).toBe(404);
    expect((await pay(foreignCashier, bill.id, { method: "CASH", amount: 1_000 })).status).toBe(
      404,
    );

    // Unauthenticated.
    const anon = await call(getBillRoute, { params: { billId: bill.id } });
    expect(anon.status).toBe(401);
    const stranger = await signUpBillingUser("Stranger");
    expect((await getBill(stranger, bill.id)).status).toBe(404);
  });

  it("serves a receipt with branch details to authorized staff", async () => {
    const b = await setupBillingBranch(c, {
      taxes: [],
      settings: { receiptHeader: "Welcome!", receiptFooter: "Thank you" },
    });
    const session = await openSession(c, b);
    await insertOrder(c, b, session, "SERVED", [{ name: "Dosa", unitPrice: 9_000 }]);
    const bill = (await generate(b.owner, b.branchId, { sessionId: session.sessionId })).body.data!;
    const res = await call<ReceiptDto>(receiptRoute, {
      params: { billId: bill.id },
      cookie: b.owner.cookie,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      restaurantName: "Spice Garden",
      branchName: "Main Branch",
      receiptHeader: "Welcome!",
      receiptFooter: "Thank you",
      timezone: "Asia/Kolkata",
    });
    expect(res.body.data!.bill.id).toBe(bill.id);
    await c.db
      .update(branchSettings)
      .set({ receiptFooter: null })
      .where(eq(branchSettings.branchId, b.branchId));
  });
});
