import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as bulkCreate } from "@/app/api/v1/branches/[branchId]/tables/bulk/route";
import { GET as qrSheet } from "@/app/api/v1/branches/[branchId]/tables/qr-sheet/route";
import {
  GET as listTables,
  POST as createTable,
} from "@/app/api/v1/branches/[branchId]/tables/route";
import {
  DELETE as revokeQr,
  GET as getQr,
  POST as generateQr,
} from "@/app/api/v1/tables/[tableId]/qr/route";
import {
  DELETE as deleteTable,
  GET as getTable,
  PATCH as patchTable,
} from "@/app/api/v1/tables/[tableId]/route";
import type { QrSheetDto, TableDto, TableQrDto } from "@/contracts/tables";
import {
  auditLogs,
  tableQrTokens,
  tableSessions,
  workspaceEntitlements,
} from "@/infrastructure/database/providers/postgres/schema";
import { resetEnvCache } from "@/server/config/env";
import { setContainerForTests, type Container } from "@/server/container";
import { hashQrToken } from "@/server/modules/tables/qr-tokens";
import {
  addStaffMember,
  createSiblingWorkspaceAs,
  createWorkspaceAs,
  insertRestaurantWithBranch,
  signUpUser,
  type TestUser,
} from "@/test/fixtures";
import { call, createTestContainer } from "@/test/harness";

let c: Container;
let owner: TestUser;
let ws: { id: string };
let rest: Awaited<ReturnType<typeof insertRestaurantWithBranch>>;

beforeAll(async () => {
  c = await createTestContainer();
  owner = await signUpUser("Table Owner");
  ws = await createWorkspaceAs(owner, "Tables WS");
  rest = await insertRestaurantWithBranch(c, ws.id);
});
afterAll(() => c.close());

async function newTable(name: string, branchId = rest.branchId, cookie = owner.cookie) {
  const res = await call<TableDto>(createTable, {
    params: { branchId },
    body: { name, capacity: 4, section: "Patio" },
    cookie,
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data!;
}

describe("tables CRUD", () => {
  it("creates, lists, updates and deletes tables", async () => {
    const t = await newTable("A1");
    expect(t).toMatchObject({ name: "A1", capacity: 4, section: "Patio", status: "AVAILABLE" });
    expect(t.qr.active).toBe(false);

    const dup = await call(createTable, {
      params: { branchId: rest.branchId },
      body: { name: "A1", capacity: 2 },
      cookie: owner.cookie,
    });
    expect(dup.status).toBe(422);
    expect(dup.body.error!.fieldErrors!.name).toBeDefined();

    const invalid = await call(createTable, {
      params: { branchId: rest.branchId },
      body: { name: "", capacity: 101 },
      cookie: owner.cookie,
    });
    expect(invalid.status).toBe(422);
    expect(Object.keys(invalid.body.error!.fieldErrors!)).toEqual(
      expect.arrayContaining(["name", "capacity"]),
    );

    const upd = await call<TableDto>(patchTable, {
      method: "PATCH",
      params: { tableId: t.id },
      body: { capacity: 6, isActive: false, version: t.version },
      cookie: owner.cookie,
    });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ capacity: 6, status: "CLOSED", version: 2 });

    const stale = await call(patchTable, {
      method: "PATCH",
      params: { tableId: t.id },
      body: { capacity: 3, version: t.version },
      cookie: owner.cookie,
    });
    expect(stale.status).toBe(409);

    const del = await call(deleteTable, {
      method: "DELETE",
      params: { tableId: t.id },
      cookie: owner.cookie,
    });
    expect(del.status).toBe(200);
    expect((await call(getTable, { params: { tableId: t.id }, cookie: owner.cookie })).status).toBe(
      404,
    );
    // Name is free again after deletion.
    await newTable("A1");
  });

  it("bulk creates T1..T5 and rejects overlaps", async () => {
    const res = await call<TableDto[]>(bulkCreate, {
      params: { branchId: rest.branchId },
      body: { prefix: "T", from: 1, to: 5, capacity: 2 },
      cookie: owner.cookie,
    });
    expect(res.status).toBe(201);
    expect(res.body.data!.map((t) => t.name)).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    const overlap = await call(bulkCreate, {
      params: { branchId: rest.branchId },
      body: { prefix: "T", from: 5, to: 7, capacity: 2 },
      cookie: owner.cookie,
    });
    expect(overlap.status).toBe(422);
  });

  it("derives status from the open session", async () => {
    const t = await newTable("S1");
    await c.db.insert(tableSessions).values({
      workspaceId: ws.id,
      restaurantId: rest.restaurantId,
      branchId: rest.branchId,
      tableId: t.id,
      status: "BILL_REQUESTED",
    });
    const list = await call<TableDto[]>(listTables, {
      params: { branchId: rest.branchId },
      cookie: owner.cookie,
    });
    const row = list.body.data!.find((x) => x.id === t.id)!;
    expect(row.status).toBe("BILL_REQUESTED");
    expect(row.session?.status).toBe("BILL_REQUESTED");
    // Cannot delete a table with an open session.
    const del = await call(deleteTable, {
      method: "DELETE",
      params: { tableId: t.id },
      cookie: owner.cookie,
    });
    expect(del.status).toBe(409);
  });

  it("enforces maxTables", async () => {
    const w = await createSiblingWorkspaceAs(c, owner, "Small WS");
    const r = await insertRestaurantWithBranch(c, w.id, { name: "Small" });
    await c.db
      .insert(workspaceEntitlements)
      .values({ workspaceId: w.id, key: "maxTables", value: 3 });
    const bulk = await call(bulkCreate, {
      params: { branchId: r.branchId },
      body: { prefix: "X", from: 1, to: 4, capacity: 2 },
      cookie: owner.cookie,
    });
    expect(bulk.status).toBe(402);
    await call(bulkCreate, {
      params: { branchId: r.branchId },
      body: { prefix: "X", from: 1, to: 3, capacity: 2 },
      cookie: owner.cookie,
    });
    const one = await call(createTable, {
      params: { branchId: r.branchId },
      body: { name: "Extra", capacity: 2 },
      cookie: owner.cookie,
    });
    expect(one.status).toBe(402);
  });
});

describe("QR base URL", () => {
  it("QR link uses QR_BASE_URL", async () => {
    const previous = process.env.QR_BASE_URL;
    process.env.QR_BASE_URL = "https://qr.example.test/";
    const local = await createTestContainer();
    try {
      expect(local.env.APP_URL).toBe("http://localhost:3000");
      const u = await signUpUser("QR Base Owner");
      const w = await createWorkspaceAs(u, "QR Base WS");
      const r = await insertRestaurantWithBranch(local, w.id);
      const t = await newTable("QB1", r.branchId, u.cookie);
      const res = await call<TableQrDto>(generateQr, {
        method: "POST",
        params: { tableId: t.id },
        cookie: u.cookie,
      });
      expect(res.status).toBe(201);
      expect(res.body.data!.url).toMatch(/^https:\/\/qr\.example\.test\/t\/[^/]+$/);
    } finally {
      if (previous === undefined) delete process.env.QR_BASE_URL;
      else process.env.QR_BASE_URL = previous;
      resetEnvCache();
      await local.close();
      setContainerForTests(c);
    }
  });
});

describe("table QR codes", () => {
  it("generates a QR whose token hash matches the stored row", async () => {
    const t = await newTable("Q1");
    const res = await call<TableQrDto>(generateQr, {
      method: "POST",
      params: { tableId: t.id },
      cookie: owner.cookie,
    });
    expect(res.status).toBe(201);
    const { url, svg } = res.body.data!;
    expect(svg).toContain("<svg");
    const token = url.split("/t/")[1]!;
    expect(url).toBe(`${c.env.APP_URL.replace(/\/$/, "")}/t/${token}`);
    const [row] = await c.db
      .select()
      .from(tableQrTokens)
      .where(eq(tableQrTokens.tokenHash, await hashQrToken(token)));
    expect(row).toMatchObject({ tableId: t.id, status: "ACTIVE", branchId: rest.branchId });

    // GET returns the same URL (decrypted), and the token never appears in the audit log.
    const current = await call<TableQrDto>(getQr, {
      params: { tableId: t.id },
      cookie: owner.cookie,
    });
    expect(current.body.data!.url).toBe(url);
    const audits = await c.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, t.id), eq(auditLogs.action, "qr.generated")));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(token);
  });

  it("regenerating revokes the previous token; revoke removes the active one", async () => {
    const t = await newTable("Q2");
    const first = await call<TableQrDto>(generateQr, {
      method: "POST",
      params: { tableId: t.id },
      cookie: owner.cookie,
    });
    const second = await call<TableQrDto>(generateQr, {
      method: "POST",
      params: { tableId: t.id },
      cookie: owner.cookie,
    });
    expect(second.body.data!.url).not.toBe(first.body.data!.url);
    const rows = await c.db.select().from(tableQrTokens).where(eq(tableQrTokens.tableId, t.id));
    expect(rows.map((r) => r.status).sort()).toEqual(["ACTIVE", "REVOKED"]);
    const oldHash = await hashQrToken(first.body.data!.url.split("/t/")[1]!);
    expect(rows.find((r) => r.tokenHash === oldHash)!.status).toBe("REVOKED");

    const sheet = await call<QrSheetDto>(qrSheet, {
      params: { branchId: rest.branchId },
      path: `/api/v1/branches/${rest.branchId}/tables/qr-sheet?tableIds=${t.id}`,
      cookie: owner.cookie,
    });
    expect(sheet.status).toBe(200);
    expect(sheet.body.data!.tables.map((x) => x.url)).toEqual([second.body.data!.url]);

    const revoked = await call(revokeQr, {
      method: "DELETE",
      params: { tableId: t.id },
      cookie: owner.cookie,
    });
    expect(revoked.status).toBe(200);
    expect((await call(getQr, { params: { tableId: t.id }, cookie: owner.cookie })).status).toBe(
      404,
    );
    const audit = await c.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, t.id), eq(auditLogs.action, "qr.revoked")));
    expect(audit).toHaveLength(1);
  });
});

describe("tables authorization", () => {
  it("returns 404 across workspaces and branches", async () => {
    const t = await newTable("P1");
    const stranger = await signUpUser("Stranger");
    await createWorkspaceAs(stranger, "Other");
    expect(
      (await call(listTables, { params: { branchId: rest.branchId }, cookie: stranger.cookie }))
        .status,
    ).toBe(404);
    for (const res of [
      await call(getTable, { params: { tableId: t.id }, cookie: stranger.cookie }),
      await call(patchTable, {
        method: "PATCH",
        params: { tableId: t.id },
        body: { name: "Mine" },
        cookie: stranger.cookie,
      }),
      await call(generateQr, {
        method: "POST",
        params: { tableId: t.id },
        cookie: stranger.cookie,
      }),
      await call(getQr, { params: { tableId: t.id }, cookie: stranger.cookie }),
    ]) {
      expect(res.status).toBe(404);
    }

    // Staff of a sibling branch cannot see this branch's tables.
    const sibling = await insertRestaurantWithBranch(c, ws.id, { name: "Sibling" });
    const siblingWaiter = await signUpUser("Sibling Waiter");
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: siblingWaiter.userId,
      role: "waiter",
      restaurantId: sibling.restaurantId,
      branchId: sibling.branchId,
    });
    expect(
      (await call(getTable, { params: { tableId: t.id }, cookie: siblingWaiter.cookie })).status,
    ).toBe(404);
  });

  it("kitchen staff cannot manage tables; waiters can view but not manage", async () => {
    const t = await newTable("K1");
    const kitchen = await signUpUser("Cook");
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: kitchen.userId,
      role: "kitchen_staff",
      restaurantId: rest.restaurantId,
      branchId: rest.branchId,
    });
    expect(
      (
        await call(createTable, {
          params: { branchId: rest.branchId },
          body: { name: "K2", capacity: 2 },
          cookie: kitchen.cookie,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(generateQr, {
          method: "POST",
          params: { tableId: t.id },
          cookie: kitchen.cookie,
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(listTables, { params: { branchId: rest.branchId }, cookie: kitchen.cookie }))
        .status,
    ).toBe(403);

    const waiter = await signUpUser("Waiter");
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: waiter.userId,
      role: "waiter",
      restaurantId: rest.restaurantId,
      branchId: rest.branchId,
    });
    expect(
      (await call(listTables, { params: { branchId: rest.branchId }, cookie: waiter.cookie }))
        .status,
    ).toBe(200);
    expect(
      (
        await call(patchTable, {
          method: "PATCH",
          params: { tableId: t.id },
          body: { capacity: 8 },
          cookie: waiter.cookie,
        })
      ).status,
    ).toBe(403);
    expect((await call(getQr, { params: { tableId: t.id }, cookie: waiter.cookie })).status).toBe(
      403,
    );
  });
});
