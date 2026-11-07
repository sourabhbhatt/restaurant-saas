import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  GET as getPreferences,
  PUT as putPreferences,
} from "@/app/api/v1/notifications/preferences/route";
import { POST as markRead } from "@/app/api/v1/notifications/read/route";
import { GET as listNotifications } from "@/app/api/v1/notifications/route";
import { GET as pushConfig } from "@/app/api/v1/push/config/route";
import {
  DELETE as deletePushSubscription,
  POST as createPushSubscription,
} from "@/app/api/v1/push/subscriptions/route";
import { GET as ping } from "@/app/api/v1/sync/ping/route";
import type {
  MarkNotificationsReadResult,
  NotificationListDto,
  NotificationPreferenceDto,
} from "@/contracts/notifications-api";
import { NOTIFICATION_TYPES } from "@/contracts/notifications";
import { notifyUsers } from "@/infrastructure/database/providers/postgres/repositories/notifications";
import {
  pushSubscriptions,
  rateLimitBuckets,
} from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";
import {
  createSiblingWorkspaceAs,
  createWorkspaceAs,
  signUpUser,
  type TestUser,
} from "@/test/fixtures";
import { call, createTestContainer } from "@/test/harness";

let c: Container;
beforeAll(async () => {
  c = await createTestContainer();
});
afterAll(async () => {
  await c.close();
});
// Many sign-ups from one test "IP": reset the sign-up rate limit between tests.
beforeEach(async () => {
  await c.db.delete(rateLimitBuckets);
});

async function notify(
  user: TestUser,
  workspaceId: string | null,
  title: string,
  type: (typeof NOTIFICATION_TYPES)[number] = "order.created",
) {
  await notifyUsers(c.db, [user.userId], { workspaceId }, { type, title, data: { orderId: "x" } });
}

const list = (user: TestUser, query = "") =>
  call<NotificationListDto>(listNotifications, {
    cookie: user.cookie,
    path: `/api/v1/notifications${query}`,
  });

describe("notification center", () => {
  it("requires authentication", async () => {
    expect((await list({ cookie: "" } as TestUser)).status).toBe(401);
  });

  it("lists only the caller's own notifications with an unread count", async () => {
    const alice = await signUpUser("Alice");
    const bob = await signUpUser("Bob");
    await notify(alice, null, "For Alice 1");
    await notify(alice, null, "For Alice 2");
    await notify(bob, null, "For Bob");

    const res = await list(alice);
    expect(res.status).toBe(200);
    const titles = res.body.data!.items.map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(["For Alice 1", "For Alice 2"]));
    expect(titles).not.toContain("For Bob");
    expect(res.body.data!.unreadCount).toBe(2);
  });

  it("paginates with a cursor without duplicates", async () => {
    const user = await signUpUser("Pager");
    for (let i = 0; i < 5; i++) await notify(user, null, `n${i}`);
    const first = await list(user, "?limit=2");
    expect(first.body.data!.items).toHaveLength(2);
    expect(first.body.data!.nextCursor).toBeTruthy();
    const seen = new Set(first.body.data!.items.map((n) => n.id));
    let cursor = first.body.data!.nextCursor;
    while (cursor) {
      const page = await list(user, `?limit=2&cursor=${encodeURIComponent(cursor)}`);
      expect(page.status).toBe(200);
      for (const n of page.body.data!.items) {
        expect(seen.has(n.id)).toBe(false);
        seen.add(n.id);
      }
      cursor = page.body.data!.nextCursor;
    }
    expect(seen.size).toBe(5);
    expect((await list(user, "?cursor=not-a-cursor")).status).toBe(422);
  });

  it("filters by unread and by workspace (with membership check)", async () => {
    const owner = await signUpUser("Owner");
    const outsider = await signUpUser("Outsider");
    const ws = await createWorkspaceAs(owner, "Notif WS");
    const otherWs = await createWorkspaceAs(outsider, "Other WS");
    await notify(owner, ws.id, "In workspace");
    await notify(owner, null, "Platform-wide", "platform.announcement");

    const scoped = await list(owner, `?workspaceId=${ws.id}`);
    expect(scoped.status).toBe(200);
    const titles = scoped.body.data!.items.map((n) => n.title);
    expect(titles).toEqual(expect.arrayContaining(["In workspace", "Platform-wide"]));

    // A workspace the caller is not a member of looks like it doesn't exist.
    expect((await list(owner, `?workspaceId=${otherWs.id}`)).status).toBe(404);
    expect((await list(owner, "?workspaceId=not-a-uuid")).status).toBe(422);

    const typed = await list(owner, "?type=platform.announcement");
    expect(typed.body.data!.items.every((n) => n.type === "platform.announcement")).toBe(true);
  });

  it("marks own notifications read by id and all, never other users'", async () => {
    const alice = await signUpUser("Alice R");
    const bob = await signUpUser("Bob R");
    await notify(alice, null, "A1");
    await notify(alice, null, "A2");
    await notify(bob, null, "B1");
    const aliceItems = (await list(alice)).body.data!.items;
    const bobItems = (await list(bob)).body.data!.items;
    const a1 = aliceItems.find((n) => n.title === "A1")!;
    const b1 = bobItems.find((n) => n.title === "B1")!;

    // Alice tries to mark Bob's notification read together with her own.
    const res = await call<MarkNotificationsReadResult>(markRead, {
      cookie: alice.cookie,
      body: { ids: [a1.id, b1.id] },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updated: 1, unreadCount: 1 });

    const bobAfter = await list(bob);
    expect(bobAfter.body.data!.items.find((n) => n.id === b1.id)!.readAt).toBeNull();
    expect(bobAfter.body.data!.unreadCount).toBe(1);

    // Repeating is harmless.
    const again = await call<MarkNotificationsReadResult>(markRead, {
      cookie: alice.cookie,
      body: { ids: [a1.id] },
    });
    expect(again.body.data!.updated).toBe(0);

    const all = await call<MarkNotificationsReadResult>(markRead, {
      cookie: alice.cookie,
      body: { all: true },
    });
    expect(all.body.data).toEqual({ updated: 1, unreadCount: 0 });
    expect((await list(alice, "?unread=true")).body.data!.items).toHaveLength(0);
    expect((await list(bob)).body.data!.unreadCount).toBe(1);
  });

  it("validates mark-read input and blocks cross-site requests", async () => {
    const user = await signUpUser();
    expect((await call(markRead, { cookie: user.cookie, body: {} })).status).toBe(422);
    expect((await call(markRead, { cookie: user.cookie, body: { ids: ["nope"] } })).status).toBe(
      422,
    );
    expect(
      (
        await call(markRead, {
          cookie: user.cookie,
          body: { all: true },
          origin: "https://evil.example",
        })
      ).status,
    ).toBe(403);
  });

  it("scoped mark-all only touches that workspace and platform notifications", async () => {
    const owner = await signUpUser("Scoped");
    const ws1 = await createWorkspaceAs(owner, "WS one");
    const ws2 = await createSiblingWorkspaceAs(c, owner, "WS two");
    await notify(owner, ws1.id, "ws1");
    await notify(owner, ws2.id, "ws2");
    const res = await call<MarkNotificationsReadResult>(markRead, {
      cookie: owner.cookie,
      body: { all: true, workspaceId: ws1.id },
    });
    expect(res.body.data!.updated).toBe(1);
    const remaining = (await list(owner, "?unread=true")).body.data!.items.map((n) => n.title);
    expect(remaining).toEqual(["ws2"]);
  });
});

describe("notification preferences", () => {
  it("returns defaults for every type and persists updates per user", async () => {
    const alice = await signUpUser("Pref A");
    const bob = await signUpUser("Pref B");
    const initial = await call<NotificationPreferenceDto[]>(getPreferences, {
      cookie: alice.cookie,
    });
    expect(initial.status).toBe(200);
    expect(initial.body.data!.map((p) => p.type)).toEqual([...NOTIFICATION_TYPES]);
    expect(initial.body.data!.every((p) => p.inApp && p.email && p.push)).toBe(true);

    const put = await call<NotificationPreferenceDto[]>(putPreferences, {
      method: "PUT",
      cookie: alice.cookie,
      body: { preferences: [{ type: "order.created", inApp: false, email: false, push: true }] },
    });
    expect(put.status).toBe(200);
    expect(put.body.data!.find((p) => p.type === "order.created")).toEqual({
      type: "order.created",
      inApp: false,
      email: false,
      push: true,
    });

    // Bob is unaffected.
    const bobPrefs = await call<NotificationPreferenceDto[]>(getPreferences, {
      cookie: bob.cookie,
    });
    expect(bobPrefs.body.data!.find((p) => p.type === "order.created")!.inApp).toBe(true);

    // The in-app opt-out is honoured by the fan-out.
    await notify(alice, null, "Muted", "order.created");
    await notify(bob, null, "Not muted", "order.created");
    expect((await list(alice)).body.data!.items.map((n) => n.title)).not.toContain("Muted");
    expect((await list(bob)).body.data!.items.map((n) => n.title)).toContain("Not muted");
  });

  it("rejects unknown types and duplicates", async () => {
    const user = await signUpUser();
    const bad = await call(putPreferences, {
      method: "PUT",
      cookie: user.cookie,
      body: { preferences: [{ type: "nope", inApp: true, email: true, push: true }] },
    });
    expect(bad.status).toBe(422);
    const dup = await call(putPreferences, {
      method: "PUT",
      cookie: user.cookie,
      body: {
        preferences: [
          { type: "order.created", inApp: true, email: true, push: true },
          { type: "order.created", inApp: false, email: true, push: true },
        ],
      },
    });
    expect(dup.status).toBe(422);
  });
});

describe("push subscriptions", () => {
  const keys = {
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  };

  it("reports push disabled with the noop provider", async () => {
    const user = await signUpUser();
    const res = await call<{ enabled: boolean; publicKey: string | null }>(pushConfig, {
      cookie: user.cookie,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ enabled: false, publicKey: null });
  });

  it("stores https subscriptions, rejects http, deletes only own", async () => {
    const alice = await signUpUser("Push A");
    const bob = await signUpUser("Push B");
    const endpoint = `https://push.example.com/send/${crypto.randomUUID()}`;

    const insecure = await call(createPushSubscription, {
      cookie: alice.cookie,
      body: { endpoint: "http://push.example.com/x", keys },
    });
    expect(insecure.status).toBe(422);

    const ok = await call(createPushSubscription, {
      cookie: alice.cookie,
      body: { endpoint, keys },
    });
    expect(ok.status).toBe(201);
    const [row] = await c.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint));
    expect(row!.userId).toBe(alice.userId);

    // Bob can't delete Alice's subscription.
    const bobDelete = await call<{ removed: boolean }>(deletePushSubscription, {
      method: "DELETE",
      cookie: bob.cookie,
      body: { endpoint },
    });
    expect(bobDelete.body.data!.removed).toBe(false);
    const stillThere = await c.db
      .select()
      .from(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, alice.userId)),
      );
    expect(stillThere).toHaveLength(1);

    const aliceDelete = await call<{ removed: boolean }>(deletePushSubscription, {
      method: "DELETE",
      cookie: alice.cookie,
      body: { endpoint },
    });
    expect(aliceDelete.body.data!.removed).toBe(true);
  });
});

describe("sync ping", () => {
  it("is public and uncached", async () => {
    const res = await call<{ ok: boolean; serverTime: string }>(ping);
    expect(res.status).toBe(200);
    expect(res.body.data!.ok).toBe(true);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
