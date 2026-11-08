/**
 * Razorpay TEST-MODE end-to-end check over the public HTTP API. No browser:
 * the API creates a real Razorpay test order; the webhook deliveries are
 * synthesised here and signed with the webhook secret the API runs with.
 *
 * Usage:
 *   pnpm razorpay:test-e2e --api <base url> --email <owner email> --password <pw>
 *       [--plan pro] [--cycle MONTHLY|ANNUAL] [--i-know-this-is-staging]
 * Env: RAZORPAY_KEY_ID (must start with rzp_test_), RAZORPAY_WEBHOOK_SECRET.
 *
 * Refuses to run against anything that is not staging or localhost, and
 * refuses a key id that is not a test key. This never moves real money: the
 * only payment that "succeeds" is the signed order.paid this script sends.
 *
 * Flow: sign in → organization + current subscription → checkout (amount must
 * equal the public plan price) → webhook with a wrong signature (401) →
 * payment.failed (failed_recorded, subscription unchanged) → order.paid
 * (activated, subscription ACTIVE) → replay (duplicate) → new event id for the
 * same order (already_paid) → exactly one ACTIVE subscription and one paid
 * event for the order. Prints a pass/fail table; exits 1 on any failure.
 */
import { createHmac, randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
}

interface MeResponse {
  user: { id: string; email: string };
  activeWorkspaceId: string | null;
  workspaces: { id: string; name: string }[];
}

interface PublicPlan {
  key: string;
  name: string;
  currency: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
}

interface CurrentSubscription {
  id: string;
  planKey: string;
  status: string;
  billingCycle: "MONTHLY" | "ANNUAL";
  currentPeriodEnd: string | null;
}

interface SubscriptionOverview {
  workspaceId: string;
  organizationId: string | null;
  paymentsEnabled: boolean;
  subscription: CurrentSubscription | null;
  history: { type: string; metadata: Record<string, unknown> }[];
}

interface CheckoutSession {
  provider: string;
  keyId: string;
  orderId: string;
  paymentOrderId: string;
  amountMinor: number;
  currency: string;
  planKey: string;
  billingCycle: "MONTHLY" | "ANNUAL";
}

interface WebhookResult {
  received: boolean;
  outcome: string;
}

class Jar {
  private cookies = new Map<string, string>();
  absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      if (value === "" || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

function fail(message: string): never {
  throw new Error(message);
}

function assertEqual<T>(label: string, actual: T, expected: T): void {
  if (actual !== expected) {
    fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Staging or local only; anything else needs the explicit flag. */
function assertSafeTarget(api: string, acknowledged: boolean): void {
  const url = URL.canParse(api) ? new URL(api) : fail(`--api is not a URL: ${api}`);
  const host = url.hostname.toLowerCase();
  const looksSafe = host === "localhost" || host === "127.0.0.1" || host.includes("staging");
  if (!looksSafe && !acknowledged) {
    fail(
      `Refusing to run against ${url.origin}: the host names neither "staging" nor "localhost". ` +
        `Pass --i-know-this-is-staging if it really is a staging environment.`,
    );
  }
}

function signWebhook(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

const token = (bytes = 7) => randomBytes(bytes).toString("hex");

function main() {
  const { values } = parseArgs({
    options: {
      api: { type: "string" },
      email: { type: "string" },
      password: { type: "string" },
      plan: { type: "string" },
      cycle: { type: "string" },
      "i-know-this-is-staging": { type: "boolean", default: false },
    },
  });
  const api = values.api?.replace(/\/$/, "");
  const email = values.email;
  const password = values.password;
  if (!api || !email || !password) {
    fail(
      "Usage: pnpm razorpay:test-e2e --api <base url> --email <owner email> --password <pw> " +
        "[--plan pro] [--cycle MONTHLY|ANNUAL] [--i-know-this-is-staging]",
    );
  }
  const keyId = process.env.RAZORPAY_KEY_ID ?? "";
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  if (!keyId.startsWith("rzp_test_")) {
    fail("RAZORPAY_KEY_ID must be a Razorpay TEST key (rzp_test_...). Live mode is never allowed.");
  }
  if (!webhookSecret) fail("RAZORPAY_WEBHOOK_SECRET is required (the value the API runs with).");
  assertSafeTarget(api, values["i-know-this-is-staging"] ?? false);
  const cycle = (values.cycle ?? "").toUpperCase();
  if (cycle && cycle !== "MONTHLY" && cycle !== "ANNUAL") fail("--cycle must be MONTHLY or ANNUAL");

  return run({
    api,
    email,
    password,
    keyId,
    webhookSecret,
    plan: values.plan ?? null,
    cycle: (cycle || null) as "MONTHLY" | "ANNUAL" | null,
  });
}

interface Options {
  api: string;
  email: string;
  password: string;
  keyId: string;
  webhookSecret: string;
  plan: string | null;
  cycle: "MONTHLY" | "ANNUAL" | null;
}

interface StepResult {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

async function run(opts: Options): Promise<number> {
  const origin = new URL(opts.api).origin;
  const jar = new Jar();
  const results: StepResult[] = [];
  let aborted = false;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (jar.header()) headers.cookie = jar.header();
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET") headers.origin = origin;
    const res = await fetch(`${opts.api}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    jar.absorb(res);
    const json = (await res.json().catch(() => ({}))) as Envelope<T>;
    if (!res.ok || json.data === undefined) {
      fail(
        `${method} ${path} → ${res.status} ${json.error?.code ?? ""} ${json.error?.message ?? ""}`.trim(),
      );
    }
    return json.data;
  }

  /** A webhook delivery exactly as Razorpay sends it: raw JSON body, HMAC header, event id. */
  async function webhook(
    body: unknown,
    over: { signature?: string; eventId?: string } = {},
  ): Promise<{ status: number; outcome: string | null; error: string | null }> {
    const raw = JSON.stringify(body);
    const res = await fetch(`${opts.api}/api/v1/webhooks/razorpay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-signature": over.signature ?? signWebhook(opts.webhookSecret, raw),
        "x-razorpay-event-id": over.eventId ?? `evt_e2e_${token()}`,
      },
      body: raw,
    });
    const json = (await res.json().catch(() => ({}))) as Envelope<WebhookResult>;
    return {
      status: res.status,
      outcome: json.data?.outcome ?? null,
      error: json.error ? `${json.error.code}: ${json.error.message}` : null,
    };
  }

  async function step<T>(name: string, fn: () => Promise<[T, string]>): Promise<T | null> {
    if (aborted) {
      results.push({ name, status: "SKIP", detail: "earlier step failed" });
      return null;
    }
    try {
      const [value, detail] = await fn();
      results.push({ name, status: "PASS", detail });
      return value;
    } catch (error) {
      aborted = true;
      results.push({ name, status: "FAIL", detail: (error as Error).message });
      return null;
    }
  }

  const paymentEntity = (
    session: CheckoutSession,
    paymentId: string,
    extra: Record<string, unknown>,
  ) => ({
    id: paymentId,
    entity: "payment",
    amount: session.amountMinor,
    currency: session.currency,
    order_id: session.orderId,
    method: "card",
    captured: extra.status === "captured",
    ...extra,
  });

  await step("sign in", async () => {
    await call("POST", "/api/v1/auth/signin", { email: opts.email, password: opts.password });
    return [null, opts.email];
  });

  const ctx = await step("find organization and subscription", async () => {
    const me = await call<MeResponse>("GET", "/api/v1/auth/me");
    const workspaceId = me.activeWorkspaceId ?? me.workspaces[0]?.id;
    if (!workspaceId) fail("this user has no workspace");
    const overview = await call<SubscriptionOverview>(
      "GET",
      `/api/v1/workspaces/${workspaceId}/subscription`,
    );
    if (!overview.organizationId) fail("the workspace has no organization (pre-backfill row)");
    if (!overview.paymentsEnabled)
      fail("paymentsEnabled is false: PAYMENT_PROVIDER is not razorpay");
    const sub = overview.subscription;
    return [
      { workspaceId, organizationId: overview.organizationId, before: sub },
      `org ${overview.organizationId}, subscription ${sub ? `${sub.status} ${sub.planKey}/${sub.billingCycle}` : "none"}`,
    ];
  });

  const plan = await step("resolve plan price from /public/plans", async () => {
    const plans = await call<PublicPlan[]>("GET", "/api/v1/public/plans");
    const before = ctx!.before;
    // A paid period that still runs can only be renewed on the same plan and cycle.
    const paidRunning =
      before &&
      (before.status === "ACTIVE" || before.status === "CANCELLED") &&
      before.currentPeriodEnd !== null &&
      new Date(before.currentPeriodEnd).getTime() > Date.now();
    const planKey = opts.plan ?? (paidRunning ? before.planKey : "pro");
    const cycle = opts.cycle ?? (paidRunning ? before.billingCycle : "MONTHLY");
    const chosen = plans.find((p) => p.key === planKey);
    if (!chosen)
      fail(`plan ${planKey} is not a public plan (${plans.map((p) => p.key).join(", ")})`);
    const price = cycle === "ANNUAL" ? chosen.annualPrice : chosen.monthlyPrice;
    if (price === null || price <= 0) fail(`plan ${planKey} has no ${cycle} price`);
    return [
      { key: chosen.key, cycle, price, currency: chosen.currency },
      `${chosen.key}/${cycle} = ${price} ${chosen.currency} (minor units)`,
    ];
  });

  const session = await step("create checkout (real Razorpay test order)", async () => {
    const s = await call<CheckoutSession>(
      "POST",
      `/api/v1/organizations/${ctx!.organizationId}/checkout`,
      { planKey: plan!.key, billingCycle: plan!.cycle },
    );
    assertEqual("provider", s.provider, "razorpay");
    if (!s.keyId.startsWith("rzp_test_")) fail(`the API handed out a non-test key id: ${s.keyId}`);
    if (s.keyId !== opts.keyId) {
      console.warn(
        `warn: the API's key id (${s.keyId}) differs from RAZORPAY_KEY_ID in this shell`,
      );
    }
    assertEqual("amountMinor", s.amountMinor, plan!.price);
    assertEqual("currency", s.currency, plan!.currency);
    if (!s.orderId.startsWith("order_")) fail(`unexpected Razorpay order id ${s.orderId}`);
    return [s, `${s.orderId} for ${s.amountMinor} ${s.currency}`];
  });

  await step("webhook with a wrong signature is rejected", async () => {
    const res = await webhook(
      {
        event: "order.paid",
        payload: {
          payment: {
            entity: paymentEntity(session!, `pay_e2e${token()}`, { status: "captured" }),
          },
        },
      },
      { signature: signWebhook("not-the-secret", "something else") },
    );
    assertEqual("status", res.status, 401);
    return [null, `401 ${res.error ?? ""}`.trim()];
  });

  await step("payment.failed is recorded and changes nothing", async () => {
    const res = await webhook({
      entity: "event",
      event: "payment.failed",
      contains: ["payment"],
      payload: {
        payment: {
          entity: paymentEntity(session!, `pay_e2e${token()}`, {
            status: "failed",
            error_code: "BAD_REQUEST_ERROR",
            error_description: "Payment failed (synthetic test-mode failure)",
            error_source: "customer",
            error_step: "payment_authentication",
            error_reason: "payment_failed",
          }),
        },
      },
      created_at: Math.floor(Date.now() / 1000),
    });
    assertEqual("status", res.status, 200);
    assertEqual("outcome", res.outcome, "failed_recorded");
    const overview = await call<SubscriptionOverview>(
      "GET",
      `/api/v1/workspaces/${ctx!.workspaceId}/subscription`,
    );
    const before = ctx!.before;
    assertEqual("subscription id", overview.subscription?.id ?? null, before?.id ?? null);
    assertEqual(
      "subscription status",
      overview.subscription?.status ?? null,
      before?.status ?? null,
    );
    assertEqual("plan", overview.subscription?.planKey ?? null, before?.planKey ?? null);
    return [null, "failed_recorded, subscription unchanged"];
  });

  const paidEventId = `evt_e2e_${token()}`;
  const paidBody = session
    ? {
        entity: "event",
        event: "order.paid",
        contains: ["payment", "order"],
        payload: {
          payment: {
            entity: paymentEntity(session, `pay_e2e${token()}`, { status: "captured" }),
          },
          order: {
            entity: {
              id: session.orderId,
              entity: "order",
              amount: session.amountMinor,
              amount_paid: session.amountMinor,
              amount_due: 0,
              currency: session.currency,
              receipt: session.paymentOrderId,
              status: "paid",
            },
          },
        },
        created_at: Math.floor(Date.now() / 1000),
      }
    : null;

  const activated = await step("order.paid (captured) activates the plan", async () => {
    const res = await webhook(paidBody, { eventId: paidEventId });
    assertEqual("status", res.status, 200);
    assertEqual("outcome", res.outcome, "activated");
    const overview = await call<SubscriptionOverview>(
      "GET",
      `/api/v1/workspaces/${ctx!.workspaceId}/subscription`,
    );
    const sub = overview.subscription ?? fail("no current subscription after activation");
    assertEqual("status", sub.status, "ACTIVE");
    assertEqual("plan", sub.planKey, plan!.key);
    assertEqual("cycle", sub.billingCycle, plan!.cycle);
    if (sub.id === ctx!.before?.id) fail("the subscription row was not replaced");
    return [sub, `ACTIVE ${sub.planKey}/${sub.billingCycle} until ${sub.currentPeriodEnd}`];
  });

  await step("replaying the same event id is a duplicate", async () => {
    const res = await webhook(paidBody, { eventId: paidEventId });
    assertEqual("status", res.status, 200);
    assertEqual("outcome", res.outcome, "duplicate");
    return [null, "duplicate"];
  });

  await step("a new event id for the same order is already_paid", async () => {
    const res = await webhook({ ...paidBody, event: "payment.captured" });
    assertEqual("status", res.status, 200);
    assertEqual("outcome", res.outcome, "already_paid");
    return [null, "already_paid"];
  });

  await step("exactly one ACTIVE subscription and one paid event", async () => {
    const overview = await call<SubscriptionOverview>(
      "GET",
      `/api/v1/workspaces/${ctx!.workspaceId}/subscription`,
    );
    const sub = overview.subscription ?? fail("no current subscription");
    assertEqual("status", sub.status, "ACTIVE");
    assertEqual("subscription id", sub.id, activated!.id);
    const paidForOrder = overview.history.filter(
      (e) => e.type === "paid" && e.metadata.providerOrderId === session!.orderId,
    );
    assertEqual("paid events for the order", paidForOrder.length, 1);
    return [null, `subscription ${sub.id}, 1 paid event for ${session!.orderId}`];
  });

  const width = Math.max(...results.map((r) => r.name.length));
  console.log("");
  for (const r of results) {
    console.log(`${r.status.padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`);
  }
  const failed = results.filter((r) => r.status !== "PASS").length;
  console.log("");
  console.log(
    failed
      ? `RAZORPAY TEST-MODE E2E: FAIL (${failed} of ${results.length} steps did not pass)`
      : `RAZORPAY TEST-MODE E2E: PASS (${results.length} steps)`,
  );
  return failed ? 1 : 0;
}

Promise.resolve()
  .then(main)
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error((error as Error).message ?? error);
    process.exit(1);
  });
