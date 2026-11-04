import { and, asc, count, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import type {
  AddonGroupDto,
  BranchMenu,
  BranchMenuItem,
  BranchOverrideDto,
  MenuCategoryDto,
  VariantDto,
} from "@/contracts/menu";
import { DomainError } from "@/domain/shared/errors";
import type {
  AddonGroupRecordInput,
  MenuItemRecord,
  MenuRepository,
  Tenant,
  VariantRecordInput,
} from "@/server/modules/menu/ports";

import type { Executor } from "../client";
import {
  addonGroups,
  addons,
  menuCategories,
  menuItemBranchOverrides,
  menuItems,
  menus,
  menuVariants,
} from "../schema";

/** Default URL builder: matches the local storage adapter (`/api/v1/files/<key>`). */
const defaultImageUrl = (key: string) => `/api/v1/files/${key}`;

export interface LoadBranchMenuScope {
  workspaceId: string;
  restaurantId: string;
  branchId: string;
}

export interface LoadBranchMenuOptions {
  /**
   * false (customer menu): drop unavailable items, variants and add-ons and
   * empty categories. true (staff): keep them with `isAvailable: false`.
   */
  includeUnavailable: boolean;
  /** Storage URL builder (pass `c.storage.url`); defaults to the local files route. */
  imageUrl?: (key: string) => string;
}

/**
 * Branch-effective menu: visible categories → live (not deleted) items with
 * branch overrides applied (price / discountedPrice / isAvailable; null
 * inherits), live variants and add-ons, shaped for the pricing engine
 * (`PricedItem`, src/domain/menu/pricing.ts) plus display fields.
 *
 * Shared with the ordering module, which prices orders from this result. IDs
 * must come from a server-resolved scope.
 *
 * An item whose variants are all unavailable is reported unavailable (it would
 * otherwise price at the base price).
 */
export async function loadBranchMenu(
  db: Executor,
  scope: LoadBranchMenuScope,
  options: LoadBranchMenuOptions = { includeUnavailable: false },
): Promise<BranchMenu> {
  const { workspaceId, restaurantId, branchId } = scope;
  const imageUrl = options.imageUrl ?? defaultImageUrl;

  const cats = await db
    .select({
      id: menuCategories.id,
      name: menuCategories.name,
      description: menuCategories.description,
      sortOrder: menuCategories.sortOrder,
    })
    .from(menuCategories)
    .innerJoin(menus, eq(menus.id, menuCategories.menuId))
    .where(
      and(
        eq(menuCategories.workspaceId, workspaceId),
        eq(menuCategories.restaurantId, restaurantId),
        eq(menuCategories.isVisible, true),
        isNull(menuCategories.deletedAt),
        eq(menus.workspaceId, workspaceId),
        eq(menus.isActive, true),
        isNull(menus.deletedAt),
      ),
    )
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));
  if (cats.length === 0) return { categories: [] };

  const itemRows = await db
    .select({ item: menuItems, ov: menuItemBranchOverrides })
    .from(menuItems)
    .leftJoin(
      menuItemBranchOverrides,
      and(
        eq(menuItemBranchOverrides.itemId, menuItems.id),
        eq(menuItemBranchOverrides.branchId, branchId),
        eq(menuItemBranchOverrides.workspaceId, workspaceId),
      ),
    )
    .where(
      and(
        eq(menuItems.workspaceId, workspaceId),
        eq(menuItems.restaurantId, restaurantId),
        inArray(
          menuItems.categoryId,
          cats.map((c) => c.id),
        ),
        isNull(menuItems.deletedAt),
      ),
    )
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.name));

  const itemIds = itemRows.map((r) => r.item.id);
  const children = await loadChildren(db, workspaceId, itemIds);

  const byCategory = new Map<string, BranchMenuItem[]>();
  for (const { item, ov } of itemRows) {
    const variants = (children.variants.get(item.id) ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      price: v.price,
      isAvailable: v.isAvailable,
      isDefault: v.isDefault,
    }));
    const groups = (children.groups.get(item.id) ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      addons: g.addons.map((a) => ({
        id: a.id,
        name: a.name,
        price: a.price,
        isAvailable: a.isAvailable,
      })),
    }));
    let isAvailable = ov?.isAvailable ?? item.isAvailable;
    if (variants.length > 0 && !variants.some((v) => v.isAvailable)) isAvailable = false;
    if (!options.includeUnavailable && !isAvailable) continue;

    const out: BranchMenuItem = {
      id: item.id,
      name: item.name,
      price: ov?.price ?? item.price,
      discountedPrice: ov?.discountedPrice ?? item.discountedPrice,
      isAvailable,
      variants: options.includeUnavailable ? variants : variants.filter((v) => v.isAvailable),
      addonGroups: options.includeUnavailable
        ? groups
        : groups.map((g) => ({ ...g, addons: g.addons.filter((a) => a.isAvailable) })),
      description: item.description,
      imageUrl: item.imageKey ? imageUrl(item.imageKey) : null,
      dietary: item.dietary,
      allergens: item.allergens,
      prepTimeMinutes: item.prepTimeMinutes,
      isFeatured: item.isFeatured,
      categoryId: item.categoryId,
      sortOrder: item.sortOrder,
    };
    const list = byCategory.get(item.categoryId) ?? [];
    list.push(out);
    byCategory.set(item.categoryId, list);
  }

  const categories = cats
    .map((c) => ({ ...c, items: byCategory.get(c.id) ?? [] }))
    .filter((c) => options.includeUnavailable || c.items.length > 0);
  return { categories };
}

async function loadChildren(db: Executor, workspaceId: string, itemIds: string[]) {
  const variants = new Map<string, VariantDto[]>();
  const groups = new Map<string, AddonGroupDto[]>();
  if (itemIds.length === 0) return { variants, groups };

  const vRows = await db
    .select()
    .from(menuVariants)
    .where(
      and(
        eq(menuVariants.workspaceId, workspaceId),
        inArray(menuVariants.itemId, itemIds),
        isNull(menuVariants.deletedAt),
      ),
    )
    .orderBy(asc(menuVariants.sortOrder), asc(menuVariants.createdAt));
  for (const v of vRows) {
    const list = variants.get(v.itemId) ?? [];
    list.push({
      id: v.id,
      name: v.name,
      price: v.price,
      isDefault: v.isDefault,
      isAvailable: v.isAvailable,
      sortOrder: v.sortOrder,
    });
    variants.set(v.itemId, list);
  }

  const gRows = await db
    .select()
    .from(addonGroups)
    .where(
      and(
        eq(addonGroups.workspaceId, workspaceId),
        inArray(addonGroups.itemId, itemIds),
        isNull(addonGroups.deletedAt),
      ),
    )
    .orderBy(asc(addonGroups.sortOrder), asc(addonGroups.createdAt));
  const groupIds = gRows.map((g) => g.id);
  const aRows =
    groupIds.length === 0
      ? []
      : await db
          .select()
          .from(addons)
          .where(
            and(
              eq(addons.workspaceId, workspaceId),
              inArray(addons.groupId, groupIds),
              isNull(addons.deletedAt),
            ),
          )
          .orderBy(asc(addons.sortOrder), asc(addons.createdAt));
  for (const g of gRows) {
    const list = groups.get(g.itemId) ?? [];
    list.push({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      sortOrder: g.sortOrder,
      addons: aRows
        .filter((a) => a.groupId === g.id)
        .map((a) => ({
          id: a.id,
          name: a.name,
          price: a.price,
          isAvailable: a.isAvailable,
          sortOrder: a.sortOrder,
        })),
    });
    groups.set(g.itemId, list);
  }
  return { variants, groups };
}

function toCategory(row: typeof menuCategories.$inferSelect): MenuCategoryDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sortOrder,
    isVisible: row.isVisible,
    version: row.version,
  };
}

function toItem(
  row: typeof menuItems.$inferSelect,
  children: Awaited<ReturnType<typeof loadChildren>>,
): MenuItemRecord {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    price: row.price,
    discountedPrice: row.discountedPrice,
    dietary: row.dietary,
    allergens: row.allergens,
    prepTimeMinutes: row.prepTimeMinutes,
    isAvailable: row.isAvailable,
    isFeatured: row.isFeatured,
    imageKey: row.imageKey,
    sortOrder: row.sortOrder,
    version: row.version,
    variants: children.variants.get(row.id) ?? [],
    addonGroups: children.groups.get(row.id) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toOverride(row: typeof menuItemBranchOverrides.$inferSelect): BranchOverrideDto {
  return {
    itemId: row.itemId,
    branchId: row.branchId,
    price: row.price,
    discountedPrice: row.discountedPrice,
    isAvailable: row.isAvailable,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const unknownChild = (what: string) =>
  new DomainError("VALIDATION_FAILED", `${what} no longer exists. Reload and try again.`);

const catWhere = (t: Tenant, id?: string) =>
  and(
    eq(menuCategories.workspaceId, t.workspaceId),
    eq(menuCategories.restaurantId, t.restaurantId),
    isNull(menuCategories.deletedAt),
    id ? eq(menuCategories.id, id) : undefined,
  );

const itemWhere = (t: Tenant, id?: string) =>
  and(
    eq(menuItems.workspaceId, t.workspaceId),
    eq(menuItems.restaurantId, t.restaurantId),
    isNull(menuItems.deletedAt),
    id ? eq(menuItems.id, id) : undefined,
  );

export function menuRepository(db: Executor): MenuRepository {
  const repo: MenuRepository = {
    async locateCategory(categoryId) {
      const [row] = await db
        .select({
          workspaceId: menuCategories.workspaceId,
          restaurantId: menuCategories.restaurantId,
        })
        .from(menuCategories)
        .where(and(eq(menuCategories.id, categoryId), isNull(menuCategories.deletedAt)))
        .limit(1);
      return row ?? null;
    },
    async locateItem(itemId) {
      const [row] = await db
        .select({ workspaceId: menuItems.workspaceId, restaurantId: menuItems.restaurantId })
        .from(menuItems)
        .where(and(eq(menuItems.id, itemId), isNull(menuItems.deletedAt)))
        .limit(1);
      return row ?? null;
    },

    async ensureMenu(t) {
      const [existing] = await db
        .select({ id: menus.id })
        .from(menus)
        .where(
          and(
            eq(menus.workspaceId, t.workspaceId),
            eq(menus.restaurantId, t.restaurantId),
            isNull(menus.deletedAt),
          ),
        )
        .orderBy(asc(menus.createdAt))
        .limit(1);
      if (existing) return existing.id;
      const [row] = await db
        .insert(menus)
        .values({ workspaceId: t.workspaceId, restaurantId: t.restaurantId, name: "Main Menu" })
        .returning({ id: menus.id });
      return row!.id;
    },

    async loadTree(t) {
      const menuId = await repo.ensureMenu(t);
      const cats = await db
        .select()
        .from(menuCategories)
        .where(catWhere(t))
        .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));
      const items = await db
        .select()
        .from(menuItems)
        .where(itemWhere(t))
        .orderBy(asc(menuItems.sortOrder), asc(menuItems.name));
      const children = await loadChildren(
        db,
        t.workspaceId,
        items.map((i) => i.id),
      );
      return {
        menuId,
        categories: cats.map((c) => ({
          ...toCategory(c),
          items: items.filter((i) => i.categoryId === c.id).map((i) => toItem(i, children)),
        })),
      };
    },

    async listCategories(t) {
      const rows = await db
        .select()
        .from(menuCategories)
        .where(catWhere(t))
        .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name));
      return rows.map(toCategory);
    },
    async findCategory(t, categoryId) {
      const [row] = await db.select().from(menuCategories).where(catWhere(t, categoryId)).limit(1);
      return row ? toCategory(row) : null;
    },
    async insertCategory(t, input) {
      const [row] = await db
        .insert(menuCategories)
        .values({
          workspaceId: t.workspaceId,
          restaurantId: t.restaurantId,
          menuId: t.menuId,
          name: input.name,
          description: input.description,
          isVisible: input.isVisible,
          sortOrder: input.sortOrder,
        })
        .returning();
      return toCategory(row!);
    },
    async updateCategory(t, categoryId, patch, expectedVersion) {
      const set: Partial<typeof menuCategories.$inferInsert> = {};
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.description !== undefined) set.description = patch.description;
      if (patch.isVisible !== undefined) set.isVisible = patch.isVisible;
      const [row] = await db
        .update(menuCategories)
        .set({ ...set, version: sql`${menuCategories.version} + 1` })
        .where(
          and(
            catWhere(t, categoryId),
            expectedVersion !== undefined
              ? eq(menuCategories.version, expectedVersion)
              : undefined,
          ),
        )
        .returning();
      return row ? toCategory(row) : null;
    },
    async setCategoryOrder(t, orderedIds) {
      for (const [i, id] of orderedIds.entries()) {
        await db
          .update(menuCategories)
          .set({ sortOrder: i })
          .where(and(catWhere(t, id), sql`${menuCategories.sortOrder} <> ${i}`));
      }
    },
    async countLiveItemsInCategory(t, categoryId) {
      const [row] = await db
        .select({ n: count() })
        .from(menuItems)
        .where(and(itemWhere(t), eq(menuItems.categoryId, categoryId)));
      return row?.n ?? 0;
    },
    async softDeleteCategory(t, categoryId, now) {
      const rows = await db
        .update(menuCategories)
        .set({ deletedAt: now, version: sql`${menuCategories.version} + 1` })
        .where(catWhere(t, categoryId))
        .returning({ id: menuCategories.id });
      return rows.length > 0;
    },

    async findItem(t, itemId) {
      const [row] = await db.select().from(menuItems).where(itemWhere(t, itemId)).limit(1);
      if (!row) return null;
      return toItem(row, await loadChildren(db, t.workspaceId, [row.id]));
    },
    async listItemIdsInCategory(t, categoryId) {
      const rows = await db
        .select({ id: menuItems.id })
        .from(menuItems)
        .where(and(itemWhere(t), eq(menuItems.categoryId, categoryId)))
        .orderBy(asc(menuItems.sortOrder), asc(menuItems.name));
      return rows.map((r) => r.id);
    },
    async setItemOrder(t, orderedIds) {
      for (const [i, id] of orderedIds.entries()) {
        await db
          .update(menuItems)
          .set({ sortOrder: i })
          .where(and(itemWhere(t, id), sql`${menuItems.sortOrder} <> ${i}`));
      }
    },
    async insertItem(t, input) {
      const [row] = await db
        .insert(menuItems)
        .values({
          workspaceId: t.workspaceId,
          restaurantId: t.restaurantId,
          categoryId: input.categoryId,
          name: input.name,
          description: input.description,
          price: input.price,
          discountedPrice: input.discountedPrice,
          dietary: input.dietary,
          allergens: input.allergens,
          prepTimeMinutes: input.prepTimeMinutes,
          isAvailable: input.isAvailable,
          isFeatured: input.isFeatured,
          imageKey: input.imageKey,
          sortOrder: input.sortOrder,
        })
        .returning({ id: menuItems.id });
      return row!.id;
    },
    async updateItem(t, itemId, patch, expectedVersion) {
      const set: Partial<typeof menuItems.$inferInsert> = {};
      if (patch.categoryId !== undefined) set.categoryId = patch.categoryId;
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.description !== undefined) set.description = patch.description;
      if (patch.price !== undefined) set.price = patch.price;
      if (patch.discountedPrice !== undefined) set.discountedPrice = patch.discountedPrice;
      if (patch.dietary !== undefined) set.dietary = patch.dietary;
      if (patch.allergens !== undefined) set.allergens = patch.allergens;
      if (patch.prepTimeMinutes !== undefined) set.prepTimeMinutes = patch.prepTimeMinutes;
      if (patch.isAvailable !== undefined) set.isAvailable = patch.isAvailable;
      if (patch.isFeatured !== undefined) set.isFeatured = patch.isFeatured;
      if (patch.imageKey !== undefined) set.imageKey = patch.imageKey;
      if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
      const rows = await db
        .update(menuItems)
        .set({ ...set, version: sql`${menuItems.version} + 1` })
        .where(
          and(
            itemWhere(t, itemId),
            expectedVersion !== undefined ? eq(menuItems.version, expectedVersion) : undefined,
          ),
        )
        .returning({ id: menuItems.id });
      return rows.length > 0;
    },
    async replaceVariants(t, itemId, variants: VariantRecordInput[], now) {
      const existing = await db
        .select({ id: menuVariants.id })
        .from(menuVariants)
        .where(
          and(
            eq(menuVariants.workspaceId, t.workspaceId),
            eq(menuVariants.itemId, itemId),
            isNull(menuVariants.deletedAt),
          ),
        );
      const existingIds = new Set(existing.map((r) => r.id));
      const keep = variants.filter((v) => v.id).map((v) => v.id!);
      if (keep.some((id) => !existingIds.has(id))) throw unknownChild("A variant");
      await db
        .update(menuVariants)
        .set({ deletedAt: now })
        .where(
          and(
            eq(menuVariants.workspaceId, t.workspaceId),
            eq(menuVariants.itemId, itemId),
            isNull(menuVariants.deletedAt),
            keep.length > 0 ? notInArray(menuVariants.id, keep) : undefined,
          ),
        );
      for (const [i, v] of variants.entries()) {
        const values = {
          name: v.name,
          price: v.price,
          isDefault: v.isDefault,
          isAvailable: v.isAvailable,
          sortOrder: i,
        };
        if (v.id) {
          await db
            .update(menuVariants)
            .set(values)
            .where(and(eq(menuVariants.id, v.id), eq(menuVariants.workspaceId, t.workspaceId)));
        } else {
          await db.insert(menuVariants).values({ ...values, workspaceId: t.workspaceId, itemId });
        }
      }
    },
    async replaceAddonGroups(t, itemId, groups: AddonGroupRecordInput[], now) {
      const existingGroups = await db
        .select({ id: addonGroups.id })
        .from(addonGroups)
        .where(
          and(
            eq(addonGroups.workspaceId, t.workspaceId),
            eq(addonGroups.itemId, itemId),
            isNull(addonGroups.deletedAt),
          ),
        );
      const groupIds = new Set(existingGroups.map((g) => g.id));
      const keepGroups = groups.filter((g) => g.id).map((g) => g.id!);
      if (keepGroups.some((id) => !groupIds.has(id))) throw unknownChild("An add-on group");

      const existingAddons =
        groupIds.size === 0
          ? []
          : await db
              .select({ id: addons.id, groupId: addons.groupId })
              .from(addons)
              .where(
                and(
                  eq(addons.workspaceId, t.workspaceId),
                  inArray(addons.groupId, [...groupIds]),
                  isNull(addons.deletedAt),
                ),
              );

      // Soft-delete removed groups and their add-ons.
      const removedGroups = [...groupIds].filter((id) => !keepGroups.includes(id));
      if (removedGroups.length > 0) {
        await db
          .update(addonGroups)
          .set({ deletedAt: now })
          .where(
            and(eq(addonGroups.workspaceId, t.workspaceId), inArray(addonGroups.id, removedGroups)),
          );
        await db
          .update(addons)
          .set({ deletedAt: now })
          .where(
            and(
              eq(addons.workspaceId, t.workspaceId),
              inArray(addons.groupId, removedGroups),
              isNull(addons.deletedAt),
            ),
          );
      }

      for (const [gi, g] of groups.entries()) {
        const gValues = {
          name: g.name,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          sortOrder: gi,
        };
        let groupId: string;
        if (g.id) {
          groupId = g.id;
          await db
            .update(addonGroups)
            .set(gValues)
            .where(and(eq(addonGroups.id, g.id), eq(addonGroups.workspaceId, t.workspaceId)));
        } else {
          const [row] = await db
            .insert(addonGroups)
            .values({ ...gValues, workspaceId: t.workspaceId, itemId })
            .returning({ id: addonGroups.id });
          groupId = row!.id;
        }
        const current = new Set(
          existingAddons.filter((a) => a.groupId === groupId).map((a) => a.id),
        );
        const keep = g.addons.filter((a) => a.id).map((a) => a.id!);
        if (keep.some((id) => !current.has(id))) throw unknownChild("An add-on");
        const removed = [...current].filter((id) => !keep.includes(id));
        if (removed.length > 0) {
          await db
            .update(addons)
            .set({ deletedAt: now })
            .where(and(eq(addons.workspaceId, t.workspaceId), inArray(addons.id, removed)));
        }
        for (const [ai, a] of g.addons.entries()) {
          const aValues = {
            name: a.name,
            price: a.price,
            isAvailable: a.isAvailable,
            sortOrder: ai,
          };
          if (a.id) {
            await db
              .update(addons)
              .set(aValues)
              .where(and(eq(addons.id, a.id), eq(addons.workspaceId, t.workspaceId)));
          } else {
            await db.insert(addons).values({ ...aValues, workspaceId: t.workspaceId, groupId });
          }
        }
      }
    },
    async softDeleteItem(t, itemId, now) {
      const rows = await db
        .update(menuItems)
        .set({ deletedAt: now, version: sql`${menuItems.version} + 1` })
        .where(itemWhere(t, itemId))
        .returning({ id: menuItems.id });
      return rows.length > 0;
    },

    async upsertOverride(input, values) {
      const [row] = await db
        .insert(menuItemBranchOverrides)
        .values({
          workspaceId: input.workspaceId,
          branchId: input.branchId,
          itemId: input.itemId,
          ...values,
        })
        .onConflictDoUpdate({
          target: [menuItemBranchOverrides.branchId, menuItemBranchOverrides.itemId],
          set: { ...values, updatedAt: new Date() },
          setWhere: eq(menuItemBranchOverrides.workspaceId, input.workspaceId),
        })
        .returning();
      if (!row) throw new DomainError("NOT_FOUND", "Menu item not found");
      return toOverride(row);
    },
    async findOverride(t, itemId) {
      const [row] = await db
        .select()
        .from(menuItemBranchOverrides)
        .where(
          and(
            eq(menuItemBranchOverrides.workspaceId, t.workspaceId),
            eq(menuItemBranchOverrides.branchId, t.branchId),
            eq(menuItemBranchOverrides.itemId, itemId),
          ),
        )
        .limit(1);
      return row ? toOverride(row) : null;
    },
    async listOverrides(t) {
      const rows = await db
        .select({ ov: menuItemBranchOverrides })
        .from(menuItemBranchOverrides)
        .innerJoin(menuItems, eq(menuItems.id, menuItemBranchOverrides.itemId))
        .where(
          and(
            eq(menuItemBranchOverrides.workspaceId, t.workspaceId),
            eq(menuItemBranchOverrides.branchId, t.branchId),
            itemWhere(t),
          ),
        );
      return rows.map((r) => toOverride(r.ov));
    },
    loadBranchMenu: (t, opts) => loadBranchMenu(db, t, opts),
  };
  return repo;
}
