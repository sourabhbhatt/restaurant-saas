import type {
  BranchMenu,
  BranchOverrideDto,
  MenuCategoryDto,
  MenuItemDto,
} from "@ros/contracts/menu";
import type { Allergen, DietaryType } from "@ros/domain/menu/pricing";
import type { AuditRepository, LimitRepository } from "../../ports/core-repositories";

export type { BranchMenu };

/** Item as stored (no URLs; the service resolves image URLs through storage). */
export type MenuItemRecord = Omit<MenuItemDto, "imageUrl">;

export interface MenuTreeRecord {
  menuId: string;
  categories: (MenuCategoryDto & { items: MenuItemRecord[] })[];
}

export interface VariantRecordInput {
  id?: string;
  name: string;
  price: number;
  isDefault: boolean;
  isAvailable: boolean;
}

export interface AddonGroupRecordInput {
  id?: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  addons: { id?: string; name: string; price: number; isAvailable: boolean }[];
}

export interface ItemRecordFields {
  categoryId: string;
  name: string;
  description: string | null;
  price: number;
  discountedPrice: number | null;
  dietary: DietaryType;
  allergens: Allergen[];
  prepTimeMinutes: number;
  isAvailable: boolean;
  isFeatured: boolean;
  imageKey: string | null;
}

export type ItemPatch = Partial<ItemRecordFields & { sortOrder: number }>;

export interface CategoryPatch {
  name?: string;
  description?: string | null;
  isVisible?: boolean;
}

export interface Tenant {
  workspaceId: string;
  restaurantId: string;
}

export interface MenuRepository {
  /** Tenant of a category/item by id, used only to resolve an access scope. */
  locateCategory(categoryId: string): Promise<Tenant | null>;
  locateItem(itemId: string): Promise<Tenant | null>;

  /** The restaurant's active menu id, created on first use. */
  ensureMenu(t: Tenant): Promise<string>;
  loadTree(t: Tenant): Promise<MenuTreeRecord>;
  /** Same as loadTree but never creates the menu (menuId is "" when none exists). */
  peekTree(t: Tenant): Promise<MenuTreeRecord>;
  readTree(t: Tenant, menuId: string): Promise<MenuTreeRecord>;

  listCategories(t: Tenant): Promise<MenuCategoryDto[]>;
  findCategory(t: Tenant, categoryId: string): Promise<MenuCategoryDto | null>;
  insertCategory(
    t: Tenant & { menuId: string },
    input: { name: string; description: string | null; isVisible: boolean; sortOrder: number },
  ): Promise<MenuCategoryDto>;
  /** Optimistic update; null when the version no longer matches (or row is gone). */
  updateCategory(
    t: Tenant,
    categoryId: string,
    patch: CategoryPatch,
    expectedVersion?: number,
  ): Promise<MenuCategoryDto | null>;
  /** Rewrites sort orders 0..n-1 in the given order (ids must belong to the tenant). */
  setCategoryOrder(t: Tenant, orderedIds: string[]): Promise<void>;
  countLiveItemsInCategory(t: Tenant, categoryId: string): Promise<number>;
  softDeleteCategory(t: Tenant, categoryId: string, now: Date): Promise<boolean>;

  findItem(t: Tenant, itemId: string): Promise<MenuItemRecord | null>;
  listItemIdsInCategory(t: Tenant, categoryId: string): Promise<string[]>;
  setItemOrder(t: Tenant, orderedIds: string[]): Promise<void>;
  insertItem(t: Tenant, input: ItemRecordFields & { sortOrder: number }): Promise<string>;
  updateItem(
    t: Tenant,
    itemId: string,
    patch: ItemPatch,
    expectedVersion?: number,
  ): Promise<boolean>;
  /** Replace variants: rows whose id is not kept are soft-deleted. Unknown ids are rejected. */
  replaceVariants(
    t: Tenant,
    itemId: string,
    variants: VariantRecordInput[],
    now: Date,
  ): Promise<void>;
  replaceAddonGroups(
    t: Tenant,
    itemId: string,
    groups: AddonGroupRecordInput[],
    now: Date,
  ): Promise<void>;
  softDeleteItem(t: Tenant, itemId: string, now: Date): Promise<boolean>;

  upsertOverride(
    input: Tenant & { branchId: string; itemId: string },
    values: { price: number | null; discountedPrice: number | null; isAvailable: boolean | null },
  ): Promise<BranchOverrideDto>;
  findOverride(t: Tenant & { branchId: string }, itemId: string): Promise<BranchOverrideDto | null>;
  listOverrides(t: Tenant & { branchId: string }): Promise<BranchOverrideDto[]>;
  /** Overrides of every branch of the restaurant (Super Admin inspection). */
  listRestaurantOverrides(t: Tenant): Promise<BranchOverrideDto[]>;
  loadBranchMenu(
    t: Tenant & { branchId: string },
    opts: { includeUnavailable: boolean; imageUrl: (key: string) => string },
  ): Promise<BranchMenu>;
}

export interface StoredFileRecord {
  key: string;
  contentType: string;
  sizeBytes: number;
  purpose: string;
}

export interface UploadRepository {
  insert(input: StoredFileRecord & { workspaceId: string; createdBy: string }): Promise<void>;
  findByKey(key: string): Promise<(StoredFileRecord & { workspaceId: string }) | null>;
}

export interface MenuRepos {
  menu: MenuRepository;
  audit: AuditRepository;
  limits: LimitRepository;
}

export interface UploadRepos {
  uploads: UploadRepository;
  audit: AuditRepository;
}
