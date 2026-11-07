/**
 * Order-to-payment smoke test over the public HTTP API only.
 * Usage: pnpm smoke --base-url http://localhost:3000
 * Credentials: SMOKE_EMAIL / SMOKE_PASSWORD (default: the seeded demo owner).
 * Flow: owner sign-in → branch + table → table QR → guest join → guest order → staff accept
 *       → generate bill → payment → bill PAID. Exits 1 on the first failed step.
 */
import { parseArgs } from "node:util";

interface Envelope<T> {
  data?: T;
  error?: { code: string; message: string };
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

function client(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  const origin = new URL(base).origin;
  return function actor() {
    const jar = new Jar();
    return async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
      const headers: Record<string, string> = { accept: "application/json" };
      if (jar.header()) headers.cookie = jar.header();
      if (body !== undefined) headers["content-type"] = "application/json";
      if (method !== "GET") headers.origin = origin;
      const res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      jar.absorb(res);
      const json = (await res.json().catch(() => ({}))) as Envelope<T>;
      if (!res.ok || json.data === undefined) {
        throw new Error(
          `${method} ${path} → ${res.status} ${json.error?.code ?? ""} ${json.error?.message ?? ""}`.trim(),
        );
      }
      return json.data;
    };
  };
}

interface MenuItemLite {
  id: string;
  isAvailable: boolean;
  variants: { id: string; isAvailable: boolean }[];
  addonGroups: { minSelect: number; addons: { id: string; isAvailable: boolean }[] }[];
}

const key = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function main() {
  const { values } = parseArgs({ options: { "base-url": { type: "string" } } });
  const baseUrl = values["base-url"];
  if (!baseUrl) throw new Error("Usage: pnpm smoke --base-url <url>");
  const email = process.env.SMOKE_EMAIL ?? "owner@demo.local";
  const password = process.env.SMOKE_PASSWORD ?? "Demo-Owner-2026";
  const actor = client(baseUrl);
  const staff = actor();
  const guest = actor();

  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    try {
      const result = await fn();
      console.log(`ok   ${name}`);
      return result;
    } catch (error) {
      console.error(`FAIL ${name}: ${(error as Error).message}`);
      process.exit(1);
    }
  };

  await step("owner sign-in", () => staff("POST", "/api/v1/auth/signin", { email, password }));
  const branchId = await step("pick branch", async () => {
    const me = await staff<{ activeWorkspaceId: string | null }>("GET", "/api/v1/auth/me");
    if (!me.activeWorkspaceId) throw new Error("owner has no workspace");
    const restaurants = await staff<{ id: string }[]>(
      "GET",
      `/api/v1/workspaces/${me.activeWorkspaceId}/restaurants`,
    );
    for (const r of restaurants) {
      const branches = await staff<{ id: string }[]>("GET", `/api/v1/restaurants/${r.id}/branches`);
      if (branches[0]) return branches[0].id;
    }
    throw new Error("no branch found");
  });
  const token = await step("table QR token", async () => {
    const tables = await staff<{ id: string; isActive: boolean; session: unknown }[]>(
      "GET",
      `/api/v1/branches/${branchId}/tables`,
    );
    // Prefer a table without an open session so the smoke bill covers only this order.
    const table = tables.find((t) => t.isActive && !t.session) ?? tables.find((t) => t.isActive);
    if (!table) throw new Error("no active table");
    const qr = await staff<{ url: string }>("POST", `/api/v1/tables/${table.id}/qr`);
    return qr.url.split("/t/")[1]!;
  });

  const joined = await step("guest join", () =>
    guest<{ sessionId: string }>("POST", `/api/v1/public/qr/${token}/session`, {}),
  );
  const order = await step("guest order", async () => {
    const qr = await guest<{ menu: { categories: { items: MenuItemLite[] }[] } }>(
      "GET",
      `/api/v1/public/qr/${token}`,
    );
    const item = qr.menu.categories.flatMap((c) => c.items).find((i) => i.isAvailable);
    if (!item) throw new Error("no available menu item");
    const variant = item.variants.find((v) => v.isAvailable);
    const addonIds = item.addonGroups.flatMap((g) =>
      g.addons
        .filter((a) => a.isAvailable)
        .slice(0, g.minSelect)
        .map((a) => a.id),
    );
    return guest<{ id: string }>("POST", "/api/v1/public/session/orders", {
      lines: [{ menuItemId: item.id, variantId: variant?.id ?? null, addonIds, quantity: 1 }],
      idempotencyKey: key("smoke-order"),
    });
  });
  await step("staff accept", async () => {
    const full = await staff<{ version: number }>("GET", `/api/v1/orders/${order.id}`);
    return staff("POST", `/api/v1/orders/${order.id}/transition`, {
      action: "accept",
      expectedVersion: full.version,
    });
  });
  const bill = await step("generate bill", () =>
    staff<{ id: string; balanceDue: number }>("POST", `/api/v1/branches/${branchId}/bills`, {
      sessionId: joined.sessionId,
      idempotencyKey: key("smoke-bill"),
    }),
  );
  await step("payment", () =>
    staff("POST", `/api/v1/bills/${bill.id}/payments`, {
      method: "CASH",
      amount: bill.balanceDue,
      idempotencyKey: key("smoke-pay"),
    }),
  );
  await step("bill PAID", async () => {
    const paid = await staff<{ paymentStatus: string }>("GET", `/api/v1/bills/${bill.id}`);
    if (paid.paymentStatus !== "PAID") throw new Error(`payment status is ${paid.paymentStatus}`);
  });
  console.log("SMOKE PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
