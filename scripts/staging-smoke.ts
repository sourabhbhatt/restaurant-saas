/**
 * Staging smoke test across all four apps, over public HTTPS only.
 *   STAGING_OWNER_PASSWORD=… STAGING_STAFF_PASSWORD=… STAGING_ADMIN_PASSWORD=… \
 *     pnpm smoke:staging --console <url> --ops <url> --admin <url> --api <url>
 * Passwords come from the environment (Secret Manager), never from this file.
 * Creates demo orders, a bill and one throwaway tenant; never touches money
 * providers (payments must be off or in test mode). Prints a table, exits 1 on any FAIL.
 */
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

type Json = Record<string, unknown>;
interface Res<T = unknown> {
  status: number;
  data?: T;
  error?: { code: string; message: string; details?: Json };
  headers: Headers;
}

class Session {
  private cookies = new Map<string, string>();
  constructor(readonly base: string) {}
  async req<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<Res<T>> {
    const headers: Record<string, string> = { accept: "application/json", ...extra };
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET" && !headers.origin) headers.origin = new URL(this.base).origin;
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair!.indexOf("=");
      const name = pair!.slice(0, i).trim();
      const value = pair!.slice(i + 1).trim();
      if (!value || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let parsed: { data?: T; error?: Res["error"] } = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    return { status: res.status, data: parsed.data, error: parsed.error, headers: res.headers };
  }
  async signIn(email: string, password: string) {
    return this.req("POST", "/api/v1/auth/signin", { email, password });
  }
}

const results: { area: string; check: string; ok: boolean; detail: string }[] = [];
async function check(area: string, name: string, fn: () => Promise<string | void>) {
  try {
    const detail = (await fn()) ?? "";
    results.push({ area, check: name, ok: true, detail });
  } catch (error) {
    results.push({ area, check: name, ok: false, detail: (error as Error).message.slice(0, 160) });
  }
}
function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
const is = (r: Res, code: number, what: string) =>
  expect(r.status === code, `${what}: expected ${code}, got ${r.status} ${r.error?.code ?? ""}`);
const key = (p: string) => `${p}-${randomUUID()}`;

async function main() {
  const { values: a } = parseArgs({
    options: {
      console: { type: "string" },
      ops: { type: "string" },
      admin: { type: "string" },
      api: { type: "string" },
    },
  });
  const urls = { console: a.console!, ops: a.ops!, admin: a.admin!, api: a.api! };
  for (const [k, v] of Object.entries(urls)) expect(v, `--${k} is required`);
  const env = (k: string) => {
    const v = process.env[k];
    expect(v, `${k} is required`);
    return v;
  };
  const OWNER = { email: "owner@demo.local", password: env("STAGING_OWNER_PASSWORD") };
  const STAFF_PW = env("STAGING_STAFF_PASSWORD");
  const ADMIN = { email: "admin@restaurantos.local", password: env("STAGING_ADMIN_PASSWORD") };

  // ------------------------------------------------------------ platform
  for (const app of ["console", "ops", "admin"] as const) {
    await check("platform", `${app} /health`, async () => {
      const r = await fetch(`${urls[app]}/health`);
      expect(r.status === 200, `status ${r.status}`);
      return `version ${((await r.json()) as { version: string }).version}`;
    });
  }
  await check("platform", "api readiness (db + migrations)", async () => {
    const r = await fetch(`${urls.api}/api/v1/health/ready`);
    expect(r.status === 200, `status ${r.status}`);
  });
  await check("platform", "console security headers", async () => {
    const r = await fetch(`${urls.console}/sign-in`);
    const h = r.headers;
    const missing = [
      "strict-transport-security",
      "content-security-policy",
      "x-content-type-options",
      "referrer-policy",
      "permissions-policy",
    ].filter((n) => !h.get(n));
    expect(missing.length === 0, `missing ${missing.join(", ")}`);
    expect(/frame-ancestors/.test(h.get("content-security-policy")!), "CSP lacks frame-ancestors");
  });

  // ------------------------------------------------------------ auth
  const owner = new Session(urls.console);
  await check("auth", "wrong password is a generic 401", async () => {
    const r = await new Session(urls.console).signIn(OWNER.email, "wrong-password-123");
    is(r, 401, "sign-in");
    expect(!/not found|no such user/i.test(r.error?.message ?? ""), "error reveals account");
  });
  await check("auth", "unauthenticated /auth/me is 401", async () => {
    is(await new Session(urls.console).req("GET", "/api/v1/auth/me"), 401, "me");
  });
  await check("auth", "owner sign-in via console (cookie HttpOnly, Secure)", async () => {
    const res = await fetch(`${urls.console}/api/v1/auth/signin`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: urls.console },
      body: JSON.stringify(OWNER),
    });
    expect(res.status === 200, `status ${res.status}`);
    const sc = res.headers.getSetCookie().join(" ");
    expect(/httponly/i.test(sc) && /secure/i.test(sc), "cookie flags missing");
    is(await owner.signIn(OWNER.email, OWNER.password), 200, "sign-in");
  });
  await check("auth", "cross-site write is refused", async () => {
    const r = await owner.req(
      "POST",
      "/api/v1/auth/signout",
      {},
      {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    );
    is(r, 403, "cross-site signout");
  });
  const me = (await owner.req<{ activeWorkspaceId: string }>("GET", "/api/v1/auth/me")).data!;
  const ws = me.activeWorkspaceId;

  const structure = (
    await owner.req<{ restaurants: { id: string; branches: { id: string; name: string }[] }[] }>(
      "GET",
      `/api/v1/workspaces/${ws}/structure`,
    )
  ).data!;
  const branch = structure.restaurants
    .flatMap((r) => r.branches)
    .find((b) => b.name === "Indiranagar")!;
  await check("auth", "workspace structure loads", async () => {
    expect(branch, "seeded Indiranagar branch missing");
    return `${structure.restaurants.length} restaurants`;
  });

  // ------------------------------------------------------------ apps
  const waiter = new Session(urls.ops);
  const kitchen = new Session(urls.ops);
  const cashier = new Session(urls.ops);
  await check("ops", "waiter, kitchen, cashier sign in via ops", async () => {
    is(await waiter.signIn("waiter@demo.local", STAFF_PW), 200, "waiter");
    is(await kitchen.signIn("kitchen@demo.local", STAFF_PW), 200, "kitchen");
    is(await cashier.signIn("cashier@demo.local", STAFF_PW), 200, "cashier");
  });
  await check("ops", "kitchen feed via ops proxy", async () => {
    is(await kitchen.req("GET", `/api/v1/branches/${branch.id}/kitchen`), 200, "kitchen feed");
  });
  await check("ops", "service worker and offline page", async () => {
    const sw = await fetch(`${urls.ops}/serwist/sw.js`);
    expect(sw.status === 200, `sw ${sw.status}`);
    const off = await fetch(`${urls.ops}/~offline`);
    expect(off.status === 200, `offline page ${off.status}`);
  });
  const admin = new Session(urls.admin);
  await check("admin", "super admin lists workspaces via admin", async () => {
    is(await admin.signIn(ADMIN.email, ADMIN.password), 200, "admin sign-in");
    is(await admin.req("GET", "/api/v1/admin/workspaces"), 200, "admin workspaces");
  });
  await check("admin", "workspace owner is refused admin routes (403)", async () => {
    const o = new Session(urls.admin);
    await o.signIn(OWNER.email, OWNER.password);
    is(await o.req("GET", "/api/v1/admin/workspaces"), 403, "owner on admin");
  });

  // ------------------------------------------------------------ QR ordering
  const tables = (
    await owner.req<
      { id: string; name: string; isActive: boolean; session: { id: string } | null }[]
    >("GET", `/api/v1/branches/${branch.id}/tables`)
  ).data!;
  const free = tables.filter((t) => t.isActive && !t.session);
  const qrTable = free[0]!;
  const staffTable = free[1]!;
  const guest = new Session(urls.console);
  let orderId = "";
  let sessionId = "";
  await check("qr", "guest joins a table by QR and orders", async () => {
    expect(qrTable && staffTable, "need two free tables");
    const qr = await owner.req<{ url: string }>("POST", `/api/v1/tables/${qrTable.id}/qr`);
    is(qr, 201, "issue QR");
    const token = qr.data!.url.split("/t/")[1]!;
    const page = await fetch(`${urls.console}/t/${token}`);
    expect(page.status === 200, `guest page ${page.status}`);
    const joined = await guest.req<{ sessionId: string }>(
      "POST",
      `/api/v1/public/qr/${token}/session`,
      {},
    );
    expect(joined.status === 200 || joined.status === 201, `join ${joined.status}`);
    sessionId = joined.data!.sessionId;
    const menu = await guest.req<{
      menu: {
        categories: {
          items: {
            id: string;
            isAvailable: boolean;
            addonGroups: { minSelect: number; addons: { id: string; isAvailable: boolean }[] }[];
            variants: { id: string; isAvailable: boolean }[];
          }[];
        }[];
      };
    }>("GET", `/api/v1/public/qr/${token}`);
    const item = menu.data!.menu.categories.flatMap((c) => c.items).find((i) => i.isAvailable)!;
    const body = {
      lines: [
        {
          menuItemId: item.id,
          variantId: item.variants.find((v) => v.isAvailable)?.id ?? null,
          addonIds: item.addonGroups.flatMap((g) =>
            g.addons
              .filter((x) => x.isAvailable)
              .slice(0, g.minSelect)
              .map((x) => x.id),
          ),
          quantity: 1,
        },
      ],
      idempotencyKey: key("smoke-guest"),
    };
    const order = await guest.req<{ id: string }>("POST", "/api/v1/public/session/orders", body);
    is(order, 201, "guest order");
    orderId = order.data!.id;
    const again = await guest.req<{ id: string }>("POST", "/api/v1/public/session/orders", body);
    expect(again.data?.id === orderId, "replayed guest order created a duplicate");
    return `table ${qrTable.name}, duplicate prevented`;
  });

  // ------------------------------------------------------------ kitchen
  await check("kitchen", "accept → start → items READY → order READY → serve", async () => {
    let o = (
      await waiter.req<{ version: number; items: { id: string }[] }>(
        "GET",
        `/api/v1/orders/${orderId}`,
      )
    ).data!;
    is(
      await waiter.req("POST", `/api/v1/orders/${orderId}/transition`, {
        action: "accept",
        expectedVersion: o.version,
      }),
      200,
      "accept",
    );
    o = (
      await kitchen.req<{ version: number; items: { id: string }[] }>(
        "GET",
        `/api/v1/orders/${orderId}`,
      )
    ).data!;
    is(
      await kitchen.req("POST", `/api/v1/orders/${orderId}/transition`, {
        action: "start",
        expectedVersion: o.version,
      }),
      200,
      "start",
    );
    for (const it of o.items) {
      const k = key("smoke-item");
      const r1 = await kitchen.req(
        "PATCH",
        `/api/v1/orders/${orderId}/items/${it.id}`,
        { status: "READY" },
        { "idempotency-key": k },
      );
      is(r1, 200, "item READY");
      const r2 = await kitchen.req(
        "PATCH",
        `/api/v1/orders/${orderId}/items/${it.id}`,
        { status: "READY" },
        { "idempotency-key": k },
      );
      is(r2, 200, "item READY replay");
    }
    o = (
      await kitchen.req<{ version: number; status: string; items: { id: string }[] }>(
        "GET",
        `/api/v1/orders/${orderId}`,
      )
    ).data! as never;
    const full = o as unknown as { status: string; version: number };
    expect(full.status === "READY", `order status ${full.status}`);
    is(
      await waiter.req("POST", `/api/v1/orders/${orderId}/transition`, {
        action: "serve",
        expectedVersion: full.version,
      }),
      200,
      "serve",
    );
  });
  await check("kitchen", "stale version is a 409 conflict (offline queue contract)", async () => {
    // The owner holds every permission, so the version check is what answers.
    const r = await owner.req("POST", `/api/v1/orders/${orderId}/transition`, {
      action: "cancel",
      expectedVersion: 1,
    });
    is(r, 409, "stale transition");
    return r.error?.code ?? "";
  });

  // ------------------------------------------------------------ offline sync (server side)
  await check("offline", "sync ping is no-store", async () => {
    const r = await waiter.req("GET", "/api/v1/sync/ping");
    is(r, 200, "ping");
    expect(/no-store/.test(r.headers.get("cache-control") ?? ""), "ping is cacheable");
  });
  await check("offline", "queued staff order: session check + idempotent replay", async () => {
    const menu = (
      await waiter.req<{
        categories: {
          items: { id: string; isAvailable: boolean; addonGroups: { minSelect: number }[] }[];
        }[];
      }>("GET", `/api/v1/branches/${branch.id}/menu`)
    ).data!;
    const item = menu.categories
      .flatMap((c) => c.items)
      .find((i) => i.isAvailable && i.addonGroups.every((g) => g.minSelect === 0))!;
    const lines = [{ menuItemId: item.id, variantId: null, addonIds: [], quantity: 1 }];
    const stale = await waiter.req("POST", `/api/v1/branches/${branch.id}/orders`, {
      tableId: staffTable.id,
      lines,
      idempotencyKey: key("smoke-staff"),
      expectedSessionId: randomUUID(),
    });
    is(stale, 409, "order for a changed session");
    expect(
      stale.error?.details?.reason === "SESSION_CHANGED",
      `reason ${String(stale.error?.details?.reason)}`,
    );
    const body = {
      tableId: staffTable.id,
      lines,
      idempotencyKey: key("smoke-staff"),
      expectedSessionId: null,
    };
    const first = await waiter.req<{ id: string }>(
      "POST",
      `/api/v1/branches/${branch.id}/orders`,
      body,
    );
    is(first, 201, "staff order");
    const replay = await waiter.req<{ id: string }>(
      "POST",
      `/api/v1/branches/${branch.id}/orders`,
      body,
    );
    expect(replay.status === 200 && replay.data?.id === first.data?.id, `replay ${replay.status}`);
    return "SESSION_CHANGED refused, replay returned the same order";
  });

  // ------------------------------------------------------------ billing
  await check("billing", "bill (idempotent) → cash payment → PAID → receipt", async () => {
    const k = key("smoke-bill");
    const bill = await cashier.req<{ id: string; balanceDue: number }>(
      "POST",
      `/api/v1/branches/${branch.id}/bills`,
      { sessionId, idempotencyKey: k },
      { "idempotency-key": k },
    );
    is(bill, 201, "bill");
    const again = await cashier.req<{ id: string }>(
      "POST",
      `/api/v1/branches/${branch.id}/bills`,
      { sessionId, idempotencyKey: k },
      { "idempotency-key": k },
    );
    expect(again.data?.id === bill.data!.id, "bill replay created a duplicate");
    const pk = key("smoke-pay");
    is(
      await cashier.req(
        "POST",
        `/api/v1/bills/${bill.data!.id}/payments`,
        { method: "CASH", amount: bill.data!.balanceDue, idempotencyKey: pk },
        { "idempotency-key": pk },
      ),
      201,
      "payment",
    );
    const paid = await cashier.req<{ paymentStatus: string }>(
      "GET",
      `/api/v1/bills/${bill.data!.id}`,
    );
    expect(paid.data?.paymentStatus === "PAID", `status ${paid.data?.paymentStatus}`);
    is(await cashier.req("GET", `/api/v1/bills/${bill.data!.id}/receipt`), 200, "receipt");
    return `₹${(bill.data!.balanceDue / 100).toFixed(2)} paid`;
  });

  // ------------------------------------------------------------ tenant isolation + subscriptions
  const intruder = new Session(urls.console);
  await check("tenancy", "a second tenant gets 404 for the first tenant's data", async () => {
    const email = `smoke+${Date.now()}@example.test`;
    is(
      await intruder.req("POST", "/api/v1/auth/signup", {
        name: "Smoke Intruder",
        email,
        password: `Pw-${randomUUID()}`,
        acceptTerms: true,
      }),
      201,
      "signup",
    );
    is(
      await intruder.req("POST", "/api/v1/workspaces", { name: "Smoke Intruder Co" }),
      201,
      "workspace",
    );
    for (const path of [
      `/api/v1/workspaces/${ws}`,
      `/api/v1/workspaces/${ws}/members`,
      `/api/v1/branches/${branch.id}/orders`,
      `/api/v1/branches/${branch.id}/kitchen`,
      `/api/v1/orders/${orderId}`,
      `/api/v1/tables/${qrTable.id}`,
    ]) {
      const r = await intruder.req("GET", path);
      expect(r.status === 404, `${path} → ${r.status}`);
    }
    return "6 cross-tenant reads → 404";
  });
  await check("subscription", "new tenant is on a 15-day trial with one workspace", async () => {
    const m = (await intruder.req<{ activeWorkspaceId: string }>("GET", "/api/v1/auth/me")).data!;
    const e = await intruder.req<{
      entitlements: {
        subscriptionStatus?: string;
        status?: string;
        trialEndsAt?: string | null;
        accessLevel?: string;
      };
    }>("GET", `/api/v1/workspaces/${m.activeWorkspaceId}/entitlements`);
    is(e, 200, "entitlements");
    const ent = e.data!.entitlements as Json;
    const end = Date.parse(String(ent.trialEndsAt ?? ""));
    const days = Math.round((end - Date.now()) / 86_400_000);
    expect(days >= 14 && days <= 15, `trial ends in ${days} days`);
    const second = await intruder.req("POST", "/api/v1/workspaces", { name: "Second workspace" });
    expect(
      second.status >= 400 && second.status < 500,
      `second workspace on trial → ${second.status}`,
    );
    return `trial ${days} days; second workspace refused (${second.status})`;
  });
  await check("subscription", "owner subscription overview", async () => {
    const r = await owner.req<{ status?: string }>("GET", `/api/v1/workspaces/${ws}/subscription`);
    is(r, 200, "subscription");
  });

  // ------------------------------------------------------------ payments
  const org = await owner.req<{
    organizationId?: string;
    subscription?: { organizationId?: string };
  }>("GET", `/api/v1/workspaces/${ws}/subscription`);
  const orgId = (org.data as Json | undefined)?.organizationId as string | undefined;
  await check("payments", "live payments impossible: checkout and webhook off", async () => {
    const hook = await fetch(`${urls.api}/api/v1/webhooks/razorpay`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-razorpay-signature": "0".repeat(64) },
      body: "{}",
    });
    if (hook.status === 404) {
      if (orgId)
        is(
          await owner.req("POST", `/api/v1/organizations/${orgId}/checkout`, {
            planKey: "pro",
            billingCycle: "MONTHLY",
          }),
          404,
          "checkout",
        );
      return "payments off (no test keys configured)";
    }
    expect(hook.status === 401, `bad-signature webhook → ${hook.status}`);
    return "test mode on: bad signature refused (401)";
  });

  // ------------------------------------------------------------ report
  const w = Math.max(...results.map((r) => r.check.length));
  for (const r of results)
    console.log(
      `${r.ok ? "PASS" : "FAIL"}  ${r.area.padEnd(12)} ${r.check.padEnd(w)}  ${r.detail}`,
    );
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
