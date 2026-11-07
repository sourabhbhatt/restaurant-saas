import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as branchMenuRoute } from "@/app/api/v1/branches/[branchId]/menu/route";
import { GET as listOverridesRoute } from "@/app/api/v1/branches/[branchId]/menu/overrides/route";
import { PUT as putOverride } from "@/app/api/v1/branches/[branchId]/menu/overrides/[itemId]/route";
import { GET as getFile } from "@/app/api/v1/files/[...key]/route";
import {
  DELETE as deleteCategory,
  PATCH as patchCategory,
} from "@/app/api/v1/menu/categories/[categoryId]/route";
import { PATCH as patchAvailability } from "@/app/api/v1/menu/items/[itemId]/availability/route";
import {
  DELETE as deleteItem,
  GET as getItem,
  PATCH as patchItem,
} from "@/app/api/v1/menu/items/[itemId]/route";
import { POST as createCategory } from "@/app/api/v1/restaurants/[restaurantId]/menu/categories/route";
import { POST as createItem } from "@/app/api/v1/restaurants/[restaurantId]/menu/items/route";
import { GET as getTree } from "@/app/api/v1/restaurants/[restaurantId]/menu/route";
import { POST as upload } from "@/app/api/v1/workspaces/[workspaceId]/uploads/route";
import type {
  BranchMenu,
  BranchOverrideDto,
  MenuCategoryDto,
  MenuItemDto,
  MenuTreeDto,
  UploadResultDto,
} from "@/contracts/menu";
import { priceSelection } from "@/domain/menu/pricing";
import { loadBranchMenu } from "@/infrastructure/database/providers/postgres/repositories/menu";
import {
  addonGroups,
  addons,
  auditLogs,
  branches,
  menuVariants,
  storedFiles,
  workspaceEntitlements,
} from "@/infrastructure/database/providers/postgres/schema";
import type { ObjectStorage } from "@/infrastructure/storage/interfaces/object-storage";
import type { Container } from "@/server/container";
import {
  addStaffMember,
  createWorkspaceAs,
  insertRestaurantWithBranch,
  signUpUser,
  type TestUser,
} from "@/test/fixtures";
import { call, createTestContainer, TEST_ORIGIN } from "@/test/harness";

let c: Container;
let owner: TestUser;
let ws: { id: string };
let rest: Awaited<ReturnType<typeof insertRestaurantWithBranch>>;

function memoryStorage(): ObjectStorage {
  const files = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    name: "memory",
    async put({ key, body, contentType }) {
      files.set(key, { body, contentType });
    },
    async get(key) {
      return files.get(key) ?? null;
    },
    async delete(key) {
      files.delete(key);
    },
    url: (key) => `/api/v1/files/${key}`,
  };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2]);

async function uploadFile(
  cookie: string,
  workspaceId: string,
  bytes: Uint8Array,
  opts: { purpose?: string; restaurantId?: string; name?: string; type?: string } = {},
) {
  const form = new FormData();
  form.set(
    "file",
    new Blob([bytes as BlobPart], { type: opts.type ?? "image/png" }),
    opts.name ?? "x.png",
  );
  form.set("purpose", opts.purpose ?? "menu_item");
  if (opts.restaurantId) form.set("restaurantId", opts.restaurantId);
  const req = new Request(`${TEST_ORIGIN}/api/v1/workspaces/${workspaceId}/uploads`, {
    method: "POST",
    headers: { cookie, origin: TEST_ORIGIN },
    body: form,
  });
  const res = await upload(req, { params: Promise.resolve({ workspaceId }) });
  return {
    status: res.status,
    body: (await res.json()) as { data?: UploadResultDto; error?: { code: string } },
  };
}

const baseItem = (categoryId: string) => ({
  categoryId,
  name: "Paneer Tikka",
  description: "Smoky cottage cheese",
  price: 32000,
  discountedPrice: 29900,
  dietary: "VEG",
  allergens: ["DAIRY"],
  prepTimeMinutes: 15,
  variants: [
    { name: "Half", price: 18000, isDefault: true },
    { name: "Full", price: 32000 },
  ],
  addonGroups: [
    {
      name: "Dips",
      minSelect: 0,
      maxSelect: 2,
      addons: [
        { name: "Mint chutney", price: 0 },
        { name: "Garlic mayo", price: 3000 },
      ],
    },
  ],
});

beforeAll(async () => {
  c = await createTestContainer();
  c.storage = memoryStorage();
  owner = await signUpUser("Menu Owner");
  ws = await createWorkspaceAs(owner, "Menu WS");
  rest = await insertRestaurantWithBranch(c, ws.id);
});
afterAll(() => c.close());

describe("menu categories", () => {
  it("creates, reorders, hides and deletes categories", async () => {
    const p = { restaurantId: rest.restaurantId };
    const a = await call<MenuCategoryDto>(createCategory, {
      params: p,
      body: { name: "Starters" },
      cookie: owner.cookie,
    });
    expect(a.status).toBe(201);
    const b = await call<MenuCategoryDto>(createCategory, {
      params: p,
      body: { name: "Desserts", isVisible: false },
      cookie: owner.cookie,
    });
    expect(b.body.data!.isVisible).toBe(false);

    // Move Desserts to the top.
    const moved = await call<MenuCategoryDto>(patchCategory, {
      method: "PATCH",
      params: { categoryId: b.body.data!.id },
      body: { sortOrder: 0, version: b.body.data!.version },
      cookie: owner.cookie,
    });
    expect(moved.status).toBe(200);
    const tree = await call<MenuTreeDto>(getTree, { params: p, cookie: owner.cookie });
    expect(tree.body.data!.categories.map((x) => x.name)).toEqual([
      "Desserts",
      "Mains",
      "Starters",
    ]);

    // Stale version → 409.
    const stale = await call(patchCategory, {
      method: "PATCH",
      params: { categoryId: b.body.data!.id },
      body: { name: "Sweets", version: b.body.data!.version },
      cookie: owner.cookie,
    });
    expect(stale.status).toBe(409);

    const del = await call(deleteCategory, {
      method: "DELETE",
      params: { categoryId: b.body.data!.id },
      cookie: owner.cookie,
    });
    expect(del.status).toBe(200);
    const after = await call<MenuTreeDto>(getTree, { params: p, cookie: owner.cookie });
    expect(after.body.data!.categories.map((x) => x.name)).toEqual(["Mains", "Starters"]);
    const audit = await c.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.workspaceId, ws.id), eq(auditLogs.action, "menu.category.deleted")));
    expect(audit).toHaveLength(1);
  });

  it("refuses to delete a category that still has items", async () => {
    await call(createItem, {
      params: { restaurantId: rest.restaurantId },
      body: { ...baseItem(rest.categoryId), name: "Dal", variants: [], addonGroups: [] },
      cookie: owner.cookie,
    });
    const res = await call(deleteCategory, {
      method: "DELETE",
      params: { categoryId: rest.categoryId },
      cookie: owner.cookie,
    });
    expect(res.status).toBe(409);
  });
});

describe("menu items", () => {
  it("creates an item with nested variants and add-ons", async () => {
    const res = await call<MenuItemDto>(createItem, {
      params: { restaurantId: rest.restaurantId },
      body: baseItem(rest.categoryId),
      cookie: owner.cookie,
    });
    expect(res.status).toBe(201);
    const item = res.body.data!;
    expect(item.variants.map((v) => [v.name, v.price, v.isDefault])).toEqual([
      ["Half", 18000, true],
      ["Full", 32000, false],
    ]);
    expect(item.addonGroups[0]!.addons).toHaveLength(2);
    expect(item.version).toBe(1);
  });

  it("validates prices, selection bounds and unique variant names", async () => {
    const p = { restaurantId: rest.restaurantId };
    const bad = await call(createItem, {
      params: p,
      body: {
        ...baseItem(rest.categoryId),
        discountedPrice: 40000,
        variants: [
          { name: "Half", price: 100 },
          { name: "half", price: 200 },
        ],
        addonGroups: [{ name: "X", minSelect: 2, maxSelect: 3, addons: [{ name: "a", price: 0 }] }],
      },
      cookie: owner.cookie,
    });
    expect(bad.status).toBe(422);
    const fe = bad.body.error!.fieldErrors!;
    expect(fe.discountedPrice).toBeDefined();
    expect(fe["variants.1.name"]).toBeDefined();
    expect(fe["addonGroups.0.maxSelect"]).toBeDefined();

    const otherWs = await createWorkspaceAs(owner, "Other WS");
    const other = await insertRestaurantWithBranch(c, otherWs.id, { name: "Elsewhere" });
    const wrongCategory = await call(createItem, {
      params: p,
      body: { ...baseItem(other.categoryId), name: "Ghost" },
      cookie: owner.cookie,
    });
    expect(wrongCategory.status).toBe(422);
  });

  it("replaces nested children in one PATCH and soft-deletes removed ones", async () => {
    const created = (
      await call<MenuItemDto>(createItem, {
        params: { restaurantId: rest.restaurantId },
        body: { ...baseItem(rest.categoryId), name: "Biryani" },
        cookie: owner.cookie,
      })
    ).body.data!;
    const half = created.variants[0]!;
    const full = created.variants[1]!;
    const group = created.addonGroups[0]!;

    const res = await call<MenuItemDto>(patchItem, {
      method: "PATCH",
      params: { itemId: created.id },
      body: {
        version: created.version,
        price: 35000,
        variants: [
          { id: full.id, name: "Full", price: 35000, isDefault: true },
          { name: "Family", price: 60000 },
        ],
        addonGroups: [
          {
            id: group.id,
            name: "Dips",
            minSelect: 1,
            maxSelect: 1,
            addons: [{ id: group.addons[1]!.id, name: "Garlic mayo", price: 3500 }],
          },
        ],
      },
      cookie: owner.cookie,
    });
    expect(res.status).toBe(200);
    const updated = res.body.data!;
    expect(updated.version).toBe(2);
    expect(updated.variants.map((v) => v.name)).toEqual(["Full", "Family"]);
    expect(updated.variants[0]!.id).toBe(full.id);
    expect(updated.addonGroups[0]!.addons.map((a) => a.price)).toEqual([3500]);

    // Removed children are soft-deleted, not destroyed (historical orders keep FKs).
    const [halfRow] = await c.db.select().from(menuVariants).where(eq(menuVariants.id, half.id));
    expect(halfRow!.deletedAt).not.toBeNull();
    const removedAddon = await c.db
      .select()
      .from(addons)
      .where(and(eq(addons.groupId, group.id), isNotNull(addons.deletedAt)));
    expect(removedAddon).toHaveLength(1);

    // Stale version.
    const stale = await call(patchItem, {
      method: "PATCH",
      params: { itemId: created.id },
      body: { version: created.version, name: "Old" },
      cookie: owner.cookie,
    });
    expect(stale.status).toBe(409);

    // Unknown child id is rejected (and nothing changes).
    const foreign = await call(patchItem, {
      method: "PATCH",
      params: { itemId: created.id },
      body: { variants: [{ id: half.id, name: "Half", price: 100 }] },
      cookie: owner.cookie,
    });
    expect(foreign.status).toBe(422);

    // Discount must stay below the (existing) price.
    const discount = await call(patchItem, {
      method: "PATCH",
      params: { itemId: created.id },
      body: { discountedPrice: 99999 },
      cookie: owner.cookie,
    });
    expect(discount.status).toBe(422);
  });

  it("soft-deletes items and keeps the rows", async () => {
    const created = (
      await call<MenuItemDto>(createItem, {
        params: { restaurantId: rest.restaurantId },
        body: { ...baseItem(rest.categoryId), name: "Old Special" },
        cookie: owner.cookie,
      })
    ).body.data!;
    const del = await call(deleteItem, {
      method: "DELETE",
      params: { itemId: created.id },
      cookie: owner.cookie,
    });
    expect(del.status).toBe(200);
    expect(
      (await call(getItem, { params: { itemId: created.id }, cookie: owner.cookie })).status,
    ).toBe(404);
    const groups = await c.db.select().from(addonGroups).where(eq(addonGroups.itemId, created.id));
    expect(groups).toHaveLength(1); // still there for history
    const audit = await c.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "menu.item.deleted"), eq(auditLogs.targetId, created.id)));
    expect(audit).toHaveLength(1);
  });

  it("toggles availability", async () => {
    const created = (
      await call<MenuItemDto>(createItem, {
        params: { restaurantId: rest.restaurantId },
        body: { ...baseItem(rest.categoryId), name: "Lassi", variants: [], addonGroups: [] },
        cookie: owner.cookie,
      })
    ).body.data!;
    const res = await call<MenuItemDto>(patchAvailability, {
      method: "PATCH",
      params: { itemId: created.id },
      body: { isAvailable: false },
      cookie: owner.cookie,
    });
    expect(res.status).toBe(200);
    expect(res.body.data!.isAvailable).toBe(false);
  });

  it("enforces the maxMenuItems limit", async () => {
    const w = await createWorkspaceAs(owner, "Limited WS");
    const r = await insertRestaurantWithBranch(c, w.id, { name: "Tiny" });
    await c.db
      .insert(workspaceEntitlements)
      .values({ workspaceId: w.id, key: "maxMenuItems", value: 1 });
    const body = { ...baseItem(r.categoryId), variants: [], addonGroups: [] };
    const first = await call(createItem, {
      params: { restaurantId: r.restaurantId },
      body,
      cookie: owner.cookie,
    });
    expect(first.status).toBe(201);
    const second = await call<unknown>(createItem, {
      params: { restaurantId: r.restaurantId },
      body: { ...body, name: "Second" },
      cookie: owner.cookie,
    });
    expect(second.status).toBe(402);
    expect(second.body.error!.code).toBe("LIMIT_REACHED");
  });
});

describe("branch-effective menu", () => {
  it("applies branch overrides in loadBranchMenu and the endpoint", async () => {
    const r = await insertRestaurantWithBranch(c, ws.id, { name: "Override House" });
    const [b2] = await c.db
      .insert(branches)
      .values({ workspaceId: ws.id, restaurantId: r.restaurantId, name: "Second", code: "two" })
      .returning({ id: branches.id });
    const item = (
      await call<MenuItemDto>(createItem, {
        params: { restaurantId: r.restaurantId },
        body: { ...baseItem(r.categoryId), name: "Kebab", variants: [], discountedPrice: null },
        cookie: owner.cookie,
      })
    ).body.data!;
    const hidden = (
      await call<MenuItemDto>(createItem, {
        params: { restaurantId: r.restaurantId },
        body: { ...baseItem(r.categoryId), name: "Soup", variants: [], addonGroups: [] },
        cookie: owner.cookie,
      })
    ).body.data!;

    const ov = await call<BranchOverrideDto>(putOverride, {
      method: "PUT",
      params: { branchId: r.branchId, itemId: item.id },
      body: { price: 27500 },
      cookie: owner.cookie,
    });
    expect(ov.status).toBe(200);
    await call(putOverride, {
      method: "PUT",
      params: { branchId: r.branchId, itemId: hidden.id },
      body: { isAvailable: false },
      cookie: owner.cookie,
    });
    // Omitted fields are kept, so the price override survives an availability toggle.
    const kept = await call<BranchOverrideDto>(putOverride, {
      method: "PUT",
      params: { branchId: r.branchId, itemId: item.id },
      body: { isAvailable: true },
      cookie: owner.cookie,
    });
    expect(kept.body.data!.price).toBe(27500);

    const scope = { workspaceId: ws.id, restaurantId: r.restaurantId, branchId: r.branchId };
    const customer = await loadBranchMenu(c.db, scope, { includeUnavailable: false });
    const items = customer.categories.flatMap((x) => x.items);
    expect(items.map((i) => i.name)).toEqual(["Kebab"]);
    const kebab = items[0]!;
    expect(kebab.price).toBe(27500);
    expect(kebab.allergens).toEqual(["DAIRY"]);
    const line = priceSelection(kebab, {
      quantity: 2,
      addonIds: [kebab.addonGroups[0]!.addons[1]!.id],
    });
    expect(line.lineTotal).toBe((27500 + 3000) * 2);

    // Other branch inherits restaurant values.
    const other = await loadBranchMenu(
      c.db,
      { ...scope, branchId: b2!.id },
      { includeUnavailable: false },
    );
    expect(other.categories.flatMap((x) => x.items).map((i) => [i.name, i.price])).toEqual([
      ["Kebab", 32000],
      ["Soup", 32000],
    ]);

    // Staff endpoint includes unavailable items, flagged.
    const staff = await call<BranchMenu>(branchMenuRoute, {
      params: { branchId: r.branchId },
      cookie: owner.cookie,
    });
    expect(staff.status).toBe(200);
    const soup = staff.body.data!.categories.flatMap((x) => x.items).find((i) => i.name === "Soup");
    expect(soup?.isAvailable).toBe(false);

    const list = await call<BranchOverrideDto[]>(listOverridesRoute, {
      params: { branchId: r.branchId },
      cookie: owner.cookie,
    });
    expect(list.body.data).toHaveLength(2);

    // Clearing with null inherits again.
    await call(putOverride, {
      method: "PUT",
      params: { branchId: r.branchId, itemId: item.id },
      body: { price: null },
      cookie: owner.cookie,
    });
    const again = await loadBranchMenu(c.db, scope, { includeUnavailable: true });
    expect(again.categories[0]!.items.find((i) => i.id === item.id)!.price).toBe(32000);
  });

  it("rejects overrides for items of another restaurant", async () => {
    const r = await insertRestaurantWithBranch(c, ws.id, { name: "Neighbour" });
    const tree = await call<MenuTreeDto>(getTree, {
      params: { restaurantId: rest.restaurantId },
      cookie: owner.cookie,
    });
    const foreignItem = tree.body.data!.categories.flatMap((x) => x.items)[0]!;
    const res = await call(putOverride, {
      method: "PUT",
      params: { branchId: r.branchId, itemId: foreignItem.id },
      body: { isAvailable: false },
      cookie: owner.cookie,
    });
    expect(res.status).toBe(404);
  });
});

describe("menu authorization", () => {
  it("hides other workspaces' menus (404)", async () => {
    const stranger = await signUpUser("Stranger");
    await createWorkspaceAs(stranger, "Stranger WS");
    const tree = await call(getTree, {
      params: { restaurantId: rest.restaurantId },
      cookie: stranger.cookie,
    });
    expect(tree.status).toBe(404);
    const anyItem = (
      await call<MenuTreeDto>(getTree, {
        params: { restaurantId: rest.restaurantId },
        cookie: owner.cookie,
      })
    ).body.data!.categories.flatMap((x) => x.items)[0]!;
    for (const res of [
      await call(getItem, { params: { itemId: anyItem.id }, cookie: stranger.cookie }),
      await call(patchItem, {
        method: "PATCH",
        params: { itemId: anyItem.id },
        body: { name: "Hacked" },
        cookie: stranger.cookie,
      }),
      await call(patchCategory, {
        method: "PATCH",
        params: { categoryId: rest.categoryId },
        body: { name: "Hacked" },
        cookie: stranger.cookie,
      }),
      await call(branchMenuRoute, { params: { branchId: rest.branchId }, cookie: stranger.cookie }),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it("lets a waiter read the branch menu but not manage it", async () => {
    const waiter = await signUpUser("Waiter");
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: waiter.userId,
      role: "waiter",
      restaurantId: rest.restaurantId,
      branchId: rest.branchId,
    });
    const menu = await call<BranchMenu>(branchMenuRoute, {
      params: { branchId: rest.branchId },
      cookie: waiter.cookie,
    });
    expect(menu.status).toBe(200);
    const item = menu.body.data!.categories.flatMap((x) => x.items)[0]!;

    expect(
      (
        await call(createCategory, {
          params: { restaurantId: rest.restaurantId },
          body: { name: "Waiter's" },
          cookie: waiter.cookie,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(patchItem, {
          method: "PATCH",
          params: { itemId: item.id },
          body: { price: 1 },
          cookie: waiter.cookie,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(putOverride, {
          method: "PUT",
          params: { branchId: rest.branchId, itemId: item.id },
          body: { isAvailable: false },
          cookie: waiter.cookie,
        })
      ).status,
    ).toBe(403);
    const up = await uploadFile(waiter.cookie, ws.id, PNG);
    expect(up.status).toBe(403);
  });

  it("lets a branch manager toggle branch availability but not edit the menu", async () => {
    const manager = await signUpUser("Branch Manager");
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: manager.userId,
      role: "restaurant_manager",
      restaurantId: rest.restaurantId,
      branchId: rest.branchId,
    });
    const menu = await call<BranchMenu>(branchMenuRoute, {
      params: { branchId: rest.branchId },
      cookie: manager.cookie,
    });
    const item = menu.body.data!.categories.flatMap((x) => x.items)[0]!;
    const ok = await call(putOverride, {
      method: "PUT",
      params: { branchId: rest.branchId, itemId: item.id },
      body: { isAvailable: false },
      cookie: manager.cookie,
    });
    expect(ok.status).toBe(200);
    const edit = await call(patchItem, {
      method: "PATCH",
      params: { itemId: item.id },
      body: { name: "Renamed" },
      cookie: manager.cookie,
    });
    expect(edit.status).toBe(403);
  });
});

describe("uploads", () => {
  it("stores a sniffed PNG, records it and serves it publicly", async () => {
    const res = await uploadFile(owner.cookie, ws.id, PNG, {
      restaurantId: rest.restaurantId,
      type: "image/gif", // declared type is ignored
    });
    expect(res.status).toBe(201);
    const { key, url } = res.body.data!;
    expect(key).toMatch(new RegExp(`^ws/${ws.id}/menu_item/[0-9a-f-]{36}\\.png$`));
    expect(url).toBe(`/api/v1/files/${key}`);
    const [row] = await c.db.select().from(storedFiles).where(eq(storedFiles.key, key));
    expect(row).toMatchObject({
      workspaceId: ws.id,
      contentType: "image/png",
      sizeBytes: PNG.length,
    });

    const file = await getFile(new Request(`${TEST_ORIGIN}${url}`), {
      params: Promise.resolve({ key: key.split("/") }),
    });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(file.headers.get("x-content-type-options")).toBe("nosniff");
    expect(file.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG);

    // Attach the image to an item; the DTO exposes the URL.
    const item = await call<MenuItemDto>(createItem, {
      params: { restaurantId: rest.restaurantId },
      body: { ...baseItem(rest.categoryId), name: "Pictured", imageKey: key },
      cookie: owner.cookie,
    });
    expect(item.status).toBe(201);
    expect(item.body.data!.imageUrl).toBe(url);
  });

  it("returns 404 for missing files", async () => {
    const res = await getFile(new Request(`${TEST_ORIGIN}/api/v1/files/ws/x`), {
      params: Promise.resolve({
        key: ["ws", ws.id, "menu_item", "00000000-0000-4000-8000-000000000000.png"],
      }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects SVG, non-images and oversize files", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await uploadFile(owner.cookie, ws.id, svg, { type: "image/svg+xml" })).status).toBe(
      422,
    );
    const text = new TextEncoder().encode("hello world");
    expect((await uploadFile(owner.cookie, ws.id, text)).status).toBe(422);
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG);
    expect((await uploadFile(owner.cookie, ws.id, big)).status).toBe(422);
    expect((await uploadFile(owner.cookie, ws.id, PNG, { purpose: "avatar" })).status).toBe(422);
  });

  it("rejects image keys from another workspace on items", async () => {
    const res = await call(createItem, {
      params: { restaurantId: rest.restaurantId },
      body: {
        ...baseItem(rest.categoryId),
        name: "Borrowed",
        imageKey:
          "ws/00000000-0000-4000-8000-000000000000/menu_item/00000000-0000-4000-8000-000000000000.png",
      },
      cookie: owner.cookie,
    });
    expect(res.status).toBe(422);
  });

  it("enforces the storage limit", async () => {
    const w = await createWorkspaceAs(owner, "Storage WS");
    await c.db
      .insert(workspaceEntitlements)
      .values({ workspaceId: w.id, key: "storageMb", value: 1 });
    const half = new Uint8Array(600 * 1024);
    half.set(PNG);
    expect((await uploadFile(owner.cookie, w.id, half)).status).toBe(201);
    const second = await uploadFile(owner.cookie, w.id, half);
    expect(second.status).toBe(402);
    expect(second.body.error!.code).toBe("LIMIT_REACHED");
    // A small file that still fits inside the first MB is allowed.
    const small = new Uint8Array(100 * 1024);
    small.set(PNG);
    expect((await uploadFile(owner.cookie, w.id, small)).status).toBe(201);
  });

  it("rejects a restaurant from another workspace the uploader also belongs to", async () => {
    const other = await createWorkspaceAs(owner, "Other Upload WS");
    const foreign = await insertRestaurantWithBranch(c, other.id, { name: "Foreign Upload" });
    const res = await uploadFile(owner.cookie, ws.id, PNG, { restaurantId: foreign.restaurantId });
    expect(res.status).toBe(422);
  });

  it("hides other workspaces (404) on upload", async () => {
    const stranger = await signUpUser("Uploader");
    const res = await uploadFile(stranger.cookie, ws.id, PNG);
    expect(res.status).toBe(404);
  });
});
