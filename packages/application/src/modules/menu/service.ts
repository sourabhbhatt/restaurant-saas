import type {
  BranchMenu,
  BranchOverrideDto,
  CreateItemData,
  MenuCategoryDto,
  MenuItemDto,
  MenuTreeDto,
  UpdateItemData,
} from "@ros/contracts/menu";
import type { Permission } from "@ros/domain/access/permissions";
import { conflict, DomainError, notFound, validationFailed } from "@ros/domain/shared/errors";
import { moveTo } from "@ros/domain/shared/reorder";
import type { TransactionRunner } from "@ros/database/interfaces/transaction";

import { recordAudit } from "../../audit/audit-service";
import type { AccessService, BranchScope, RestaurantScope } from "../../authz/access-service";
import { auditActorFor, type RequestMeta, type UserActor } from "../../context";
import type { Clock } from "../../ports/observability";
import type { EntitlementService } from "../../subscriptions/entitlement-service";
import type { ItemPatch, MenuItemRecord, MenuRepos, MenuRepository, Tenant } from "./ports";

export interface MenuServiceDeps {
  tx: TransactionRunner<MenuRepos>;
  /** Owner-level runner, used only to find which branch/restaurant owns an id before authorization. */
  lookup: Pick<MenuRepository, "locateCategory" | "locateItem">;
  clock: Clock;
  entitlements: EntitlementService;
  access: AccessService;
  /** Public URL for a stored object key (ObjectStorage.url). */
  fileUrl: (key: string) => string;
}

const stale = (what: string) =>
  new DomainError(
    "STALE_VERSION",
    `This ${what} was changed by someone else. Reload and try again.`,
  );

const tenantOf = (scope: RestaurantScope | BranchScope): Tenant => ({
  workspaceId: scope.workspaceId,
  restaurantId: scope.restaurantId,
});

function assertImageKey(workspaceId: string, key: string | null | undefined) {
  if (key && !key.startsWith(`ws/${workspaceId}/`)) {
    throw validationFailed("Upload the image again", { imageKey: ["Upload the image again"] });
  }
}

export function createMenuService(deps: MenuServiceDeps) {
  const { tx, lookup, clock, entitlements, access, fileUrl } = deps;

  const toDto = (r: MenuItemRecord): MenuItemDto => ({
    ...r,
    imageUrl: r.imageKey ? fileUrl(r.imageKey) : null,
  });

  /** Resolve a restaurant scope from a resource id; other tenants' rows read as NOT_FOUND. */
  async function scopeFor(
    actor: UserActor,
    tenant: Tenant | null,
    what: string,
  ): Promise<RestaurantScope> {
    if (!tenant) throw notFound(what);
    try {
      const scope = await access.forRestaurant(actor, tenant.restaurantId);
      if (scope.workspaceId !== tenant.workspaceId) throw notFound(what);
      return scope;
    } catch (error) {
      if (error instanceof DomainError && error.code === "NOT_FOUND") throw notFound(what);
      throw error;
    }
  }

  async function requireItem(t: Tenant, itemId: string, r: MenuRepos) {
    const item = await r.menu.findItem(t, itemId);
    if (!item) throw notFound("Menu item");
    return item;
  }

  return {
    async scopeForCategory(actor: UserActor, categoryId: string) {
      return scopeFor(actor, await lookup.locateCategory(categoryId), "Category");
    },
    async scopeForItem(actor: UserActor, itemId: string) {
      return scopeFor(actor, await lookup.locateItem(itemId), "Menu item");
    },

    /**
     * Read-only inspection for Super Admin. The caller (the admin route) has
     * already checked the platform role and that the restaurant belongs to the
     * workspace; this never creates or changes anything.
     */
    async getTreeForAdmin(
      tenant: Tenant,
    ): Promise<{ menu: MenuTreeDto; overrides: BranchOverrideDto[] }> {
      return tx.read(async (r) => {
        const [tree, overrides] = await Promise.all([
          r.menu.peekTree(tenant),
          r.menu.listRestaurantOverrides(tenant),
        ]);
        return {
          menu: {
            restaurantId: tenant.restaurantId,
            menuId: tree.menuId,
            categories: tree.categories.map((c) => ({ ...c, items: c.items.map(toDto) })),
          },
          overrides,
        };
      });
    },

    async getTree(scope: RestaurantScope): Promise<MenuTreeDto> {
      scope.require("menu.view");
      const tree = await tx.run((r) => r.menu.loadTree(tenantOf(scope)));
      return {
        restaurantId: scope.restaurantId,
        menuId: tree.menuId,
        categories: tree.categories.map((c) => ({ ...c, items: c.items.map(toDto) })),
      };
    },

    // ---------------------------------------------------------------- categories

    async createCategory(
      scope: RestaurantScope,
      input: { name: string; description?: string | null; isVisible?: boolean },
      meta: RequestMeta,
    ): Promise<MenuCategoryDto> {
      scope.require("menu.manage");
      const t = tenantOf(scope);
      return tx.run(async (r) => {
        const menuId = await r.menu.ensureMenu(t);
        const existing = await r.menu.listCategories(t);
        const category = await r.menu.insertCategory(
          { ...t, menuId },
          {
            name: input.name,
            description: input.description ?? null,
            isVisible: input.isVisible ?? true,
            sortOrder: existing.length,
          },
        );
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "menu.category.created",
          { workspaceId: t.workspaceId, targetType: "menu_category", targetId: category.id },
          { restaurantId: t.restaurantId, name: category.name },
        );
        return category;
      });
    },

    async updateCategory(
      scope: RestaurantScope,
      categoryId: string,
      input: {
        name?: string;
        description?: string | null;
        isVisible?: boolean;
        sortOrder?: number;
        version?: number;
      },
      meta: RequestMeta,
    ): Promise<MenuCategoryDto> {
      scope.require("menu.manage");
      const t = tenantOf(scope);
      return tx.run(async (r) => {
        const current = await r.menu.findCategory(t, categoryId);
        if (!current) throw notFound("Category");
        if (input.version !== undefined && input.version !== current.version) {
          throw stale("category");
        }
        if (input.sortOrder !== undefined) {
          const ids = (await r.menu.listCategories(t)).map((c) => c.id);
          await r.menu.setCategoryOrder(t, moveTo(ids, categoryId, input.sortOrder));
        }
        const updated = await r.menu.updateCategory(
          t,
          categoryId,
          { name: input.name, description: input.description, isVisible: input.isVisible },
          input.version,
        );
        if (!updated) throw stale("category");
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "menu.category.updated",
          { workspaceId: t.workspaceId, targetType: "menu_category", targetId: categoryId },
          {
            fields: Object.keys(input).filter(
              (k) => k !== "version" && input[k as keyof typeof input] !== undefined,
            ),
          },
        );
        return updated;
      });
    },

    async deleteCategory(scope: RestaurantScope, categoryId: string, meta: RequestMeta) {
      scope.require("menu.manage");
      const t = tenantOf(scope);
      await tx.run(async (r) => {
        const current = await r.menu.findCategory(t, categoryId);
        if (!current) throw notFound("Category");
        if ((await r.menu.countLiveItemsInCategory(t, categoryId)) > 0) {
          throw conflict("Move or delete the items in this category first");
        }
        await r.menu.softDeleteCategory(t, categoryId, clock.now());
        const remaining = (await r.menu.listCategories(t)).map((c) => c.id);
        await r.menu.setCategoryOrder(t, remaining);
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "menu.category.deleted",
          { workspaceId: t.workspaceId, targetType: "menu_category", targetId: categoryId },
          { name: current.name },
        );
      });
    },

    // ---------------------------------------------------------------- items

    async getItem(scope: RestaurantScope, itemId: string): Promise<MenuItemDto> {
      scope.require("menu.view");
      return toDto(await tx.read((r) => requireItem(tenantOf(scope), itemId, r)));
    },

    async createItem(
      scope: RestaurantScope,
      input: CreateItemData,
      meta: RequestMeta,
    ): Promise<MenuItemDto> {
      scope.require("menu.manage");
      const t = tenantOf(scope);
      assertImageKey(t.workspaceId, input.imageKey);
      await entitlements.assertCanAdd(t.workspaceId, "maxMenuItems");
      return tx.run(async (r) => {
        if (!(await r.menu.findCategory(t, input.categoryId))) {
          throw validationFailed("Choose a category", { categoryId: ["Choose a category"] });
        }
        const siblings = await r.menu.listItemIdsInCategory(t, input.categoryId);
        const itemId = await r.menu.insertItem(t, {
          categoryId: input.categoryId,
          name: input.name,
          description: input.description ?? null,
          price: input.price,
          discountedPrice: input.discountedPrice ?? null,
          dietary: input.dietary,
          allergens: [...new Set(input.allergens)],
          prepTimeMinutes: input.prepTimeMinutes,
          isAvailable: input.isAvailable ?? true,
          isFeatured: input.isFeatured ?? false,
          imageKey: input.imageKey ?? null,
          sortOrder: siblings.length,
        });
        const now = clock.now();
        if (input.variants?.length) {
          await r.menu.replaceVariants(t, itemId, stripIds(input.variants), now);
        }
        if (input.addonGroups?.length) {
          await r.menu.replaceAddonGroups(
            t,
            itemId,
            input.addonGroups.map((g) => ({ ...stripId(g), addons: stripIds(g.addons) })),
            now,
          );
        }
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "menu.item.created",
          { workspaceId: t.workspaceId, targetType: "menu_item", targetId: itemId },
          { restaurantId: t.restaurantId, name: input.name, price: input.price },
        );
        return toDto(await requireItem(t, itemId, r));
      });
    },

    async updateItem(
      scope: RestaurantScope,
      itemId: string,
      input: UpdateItemData,
      meta: RequestMeta,
    ): Promise<MenuItemDto> {
      scope.require("menu.manage");
      const t = tenantOf(scope);
      assertImageKey(t.workspaceId, input.imageKey);
      return tx.run(async (r) => {
        const current = await requireItem(t, itemId, r);
        if (input.version !== undefined && input.version !== current.version) throw stale("item");
        const price = input.price ?? current.price;
        const discounted =
          input.discountedPrice !== undefined ? input.discountedPrice : current.discountedPrice;
        if (discounted !== null && discounted >= price) {
          throw validationFailed("Discounted price must be lower than the price", {
            discountedPrice: ["Discounted price must be lower than the price"],
          });
        }
        const patch: ItemPatch = {
          name: input.name,
          description: input.description,
          price: input.price,
          discountedPrice: input.discountedPrice,
          dietary: input.dietary,
          allergens: input.allergens ? [...new Set(input.allergens)] : undefined,
          prepTimeMinutes: input.prepTimeMinutes,
          isAvailable: input.isAvailable,
          isFeatured: input.isFeatured,
          imageKey: input.imageKey,
        };
        let categoryId = current.categoryId;
        if (input.categoryId !== undefined && input.categoryId !== current.categoryId) {
          if (!(await r.menu.findCategory(t, input.categoryId))) {
            throw validationFailed("Choose a category", { categoryId: ["Choose a category"] });
          }
          categoryId = input.categoryId;
          patch.categoryId = categoryId;
          patch.sortOrder = (await r.menu.listItemIdsInCategory(t, categoryId)).length;
        }
        const ok = await r.menu.updateItem(t, itemId, patch, input.version);
        if (!ok) throw stale("item");
        if (input.sortOrder !== undefined) {
          const ids = await r.menu.listItemIdsInCategory(t, categoryId);
          await r.menu.setItemOrder(t, moveTo(ids, itemId, input.sortOrder));
        }
        const now = clock.now();
        if (input.variants) await r.menu.replaceVariants(t, itemId, input.variants, now);
        if (input.addonGroups) await r.menu.replaceAddonGroups(t, itemId, input.addonGroups, now);
        const fields = Object.entries(input)
          .filter(([k, v]) => k !== "version" && v !== undefined)
          .map(([k]) => k);
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "menu.item.updated",
          { workspaceId: t.workspaceId, targetType: "menu_item", targetId: itemId },
          {
            fields,
            ...(input.price !== undefined && input.price !== current.price
              ? { priceFrom: current.price, priceTo: input.price }
              : {}),
          },
        );
        return toDto(await requireItem(t, itemId, r));
      });
    },

    async setAvailability(
      scope: RestaurantScope,
      itemId: string,
      isAvailable: boolean,
      meta: RequestMeta,
    ): Promise<MenuItemDto> {
      const perm: Permission = scope.can("menu.manage")
        ? "menu.manage"
        : "menu.availability.manage";
      scope.require(perm);
      const t = tenantOf(scope);
      return tx.run(async (r) => {
        await requireItem(t, itemId, r);
        if (!(await r.menu.updateItem(t, itemId, { isAvailable }))) throw notFound("Menu item");
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "menu.item.availability_changed",
          { workspaceId: t.workspaceId, targetType: "menu_item", targetId: itemId },
          { isAvailable },
        );
        return toDto(await requireItem(t, itemId, r));
      });
    },

    async deleteItem(scope: RestaurantScope, itemId: string, meta: RequestMeta) {
      scope.require("menu.manage");
      const t = tenantOf(scope);
      await tx.run(async (r) => {
        const current = await requireItem(t, itemId, r);
        await r.menu.softDeleteItem(t, itemId, clock.now());
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "menu.item.deleted",
          { workspaceId: t.workspaceId, targetType: "menu_item", targetId: itemId },
          { name: current.name },
        );
      });
    },

    // ---------------------------------------------------------------- branch

    async getBranchMenu(scope: BranchScope, includeUnavailable: boolean): Promise<BranchMenu> {
      if (!scope.can("menu.view") && !scope.can("menu.availability.manage")) {
        scope.require("orders.view");
      }
      return tx.read((r) =>
        r.menu.loadBranchMenu(
          { ...tenantOf(scope), branchId: scope.branchId },
          { includeUnavailable, imageUrl: fileUrl },
        ),
      );
    },

    async listOverrides(scope: BranchScope): Promise<BranchOverrideDto[]> {
      if (!scope.can("menu.view")) scope.require("menu.availability.manage");
      return tx.read((r) => r.menu.listOverrides({ ...tenantOf(scope), branchId: scope.branchId }));
    },

    /**
     * Set a branch override. Omitted fields keep their current override value;
     * null clears it (inherit the restaurant value).
     */
    async putOverride(
      scope: BranchScope,
      itemId: string,
      input: {
        price?: number | null;
        discountedPrice?: number | null;
        isAvailable?: boolean | null;
      },
      meta: RequestMeta,
    ): Promise<BranchOverrideDto> {
      scope.require("menu.availability.manage");
      const t = { ...tenantOf(scope), branchId: scope.branchId };
      return tx.run(async (r) => {
        const item = await requireItem(t, itemId, r);
        const existing = await r.menu.findOverride(t, itemId);
        const pick = <K extends "price" | "discountedPrice" | "isAvailable">(k: K) =>
          input[k] !== undefined ? input[k] : (existing?.[k] ?? null);
        const values = {
          price: pick("price") as number | null,
          discountedPrice: pick("discountedPrice") as number | null,
          isAvailable: pick("isAvailable") as boolean | null,
        };
        const effPrice = values.price ?? item.price;
        if (values.discountedPrice !== null && values.discountedPrice >= effPrice) {
          throw validationFailed("Discounted price must be lower than the price", {
            discountedPrice: ["Discounted price must be lower than the price"],
          });
        }
        const saved = await r.menu.upsertOverride({ ...t, itemId }, values);
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "menu.override.updated",
          {
            workspaceId: t.workspaceId,
            branchId: t.branchId,
            targetType: "menu_item",
            targetId: itemId,
          },
          values,
        );
        return saved;
      });
    },
  };
}

function stripId<T extends { id?: string }>(v: T): Omit<T, "id"> {
  const { id: _id, ...rest } = v;
  return rest;
}
function stripIds<T extends { id?: string }>(list: T[]): Omit<T, "id">[] {
  return list.map(stripId);
}

export type MenuService = ReturnType<typeof createMenuService>;
