import { z } from "zod";

import {
  ALLERGENS,
  DIETARY_TYPES,
  type Allergen,
  type DietaryType,
  type PricedItem,
} from "@/domain/menu/pricing";

/**
 * Menu contracts shared by the API handlers and the menu editor UI.
 * Money is always integer minor units.
 */

export const UPLOAD_PURPOSES = ["menu_item", "logo", "cover"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
export const UPLOAD_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export interface UploadResultDto {
  key: string;
  url: string;
}

const MAX_PRICE = 100_000_000; // 10 lakh major units — far above any real menu price.
const money = (label: string) =>
  z
    .number({ message: `Enter a ${label}` })
    .int(`${label[0]!.toUpperCase()}${label.slice(1)} must be in minor units`)
    .min(0, `${label[0]!.toUpperCase()}${label.slice(1)} cannot be negative`)
    .max(MAX_PRICE, `${label[0]!.toUpperCase()}${label.slice(1)} is too large`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const OBJECT_KEY = /^ws\/[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}\.(png|jpg|webp)$/;
export const imageKeySchema = z.string().regex(OBJECT_KEY, "Upload the image again").nullable();

// ------------------------------------------------------------------ Categories

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Enter a category name").max(60, "Name is too long"),
  description: optionalText(300),
  isVisible: z.boolean().optional(),
});
export type CreateCategoryInput = z.input<typeof createCategorySchema>;

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1, "Enter a category name").max(60, "Name is too long").optional(),
  description: optionalText(300),
  isVisible: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  version: z.number().int().positive().optional(),
});
export type UpdateCategoryInput = z.input<typeof updateCategorySchema>;

// ------------------------------------------------------------------ Items

export const variantInputSchema = z.object({
  /** Existing variant id (kept) or omitted for a new one. */
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Enter a variant name").max(40, "Name is too long"),
  price: money("price"),
  isDefault: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
});
export type VariantInput = z.input<typeof variantInputSchema>;

export const addonInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Enter an add-on name").max(60, "Name is too long"),
  price: money("price").default(0),
  isAvailable: z.boolean().default(true),
});

export const addonGroupInputSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, "Enter a group name").max(60, "Name is too long"),
    minSelect: z.number().int().min(0, "Cannot be negative").max(20),
    maxSelect: z.number().int().min(1, "Allow at least 1").max(20),
    addons: z.array(addonInputSchema).min(1, "Add at least one option").max(30),
  })
  .superRefine((g, ctx) => {
    if (g.minSelect > g.maxSelect) {
      ctx.addIssue({
        code: "custom",
        path: ["minSelect"],
        message: "Minimum cannot be more than maximum",
      });
    }
    if (g.maxSelect > g.addons.length) {
      ctx.addIssue({
        code: "custom",
        path: ["maxSelect"],
        message: `Maximum cannot exceed the ${g.addons.length} option(s)`,
      });
    }
    const seen = new Set<string>();
    g.addons.forEach((a, i) => {
      const k = a.name.trim().toLowerCase();
      if (seen.has(k))
        ctx.addIssue({ code: "custom", path: ["addons", i, "name"], message: "Duplicate option" });
      seen.add(k);
    });
  });
export type AddonGroupInput = z.input<typeof addonGroupInputSchema>;

const itemFields = {
  categoryId: z.uuid("Choose a category"),
  name: z.string().trim().min(1, "Enter an item name").max(80, "Name is too long"),
  description: optionalText(500),
  price: money("price"),
  discountedPrice: money("discounted price").nullable().optional(),
  dietary: z.enum(DIETARY_TYPES),
  allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length).default([]),
  prepTimeMinutes: z
    .number({ message: "Enter a prep time" })
    .int("Use whole minutes")
    .min(0, "Cannot be negative")
    .max(240, "At most 240 minutes"),
  isAvailable: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  imageKey: imageKeySchema.optional(),
  variants: z.array(variantInputSchema).max(20, "At most 20 variants").optional(),
  addonGroups: z.array(addonGroupInputSchema).max(10, "At most 10 add-on groups").optional(),
};

type ItemShape = {
  price?: number;
  discountedPrice?: number | null;
  variants?: { name: string; isDefault?: boolean }[];
};

function refineItem(item: ItemShape, ctx: z.RefinementCtx) {
  if (
    item.discountedPrice !== null &&
    item.discountedPrice !== undefined &&
    item.price !== undefined &&
    item.discountedPrice >= item.price
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["discountedPrice"],
      message: "Discounted price must be lower than the price",
    });
  }
  if (item.variants) {
    const seen = new Set<string>();
    item.variants.forEach((v, i) => {
      const k = v.name.trim().toLowerCase();
      if (seen.has(k)) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", i, "name"],
          message: "Variant names must be unique",
        });
      }
      seen.add(k);
    });
    if (item.variants.filter((v) => v.isDefault).length > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["variants"],
        message: "Only one variant can be the default",
      });
    }
  }
}

export const createItemSchema = z.object(itemFields).superRefine(refineItem);
export type CreateItemInput = z.input<typeof createItemSchema>;
export type CreateItemData = z.output<typeof createItemSchema>;

export const updateItemSchema = z
  .object({
    categoryId: itemFields.categoryId.optional(),
    name: itemFields.name.optional(),
    description: itemFields.description,
    price: itemFields.price.optional(),
    discountedPrice: itemFields.discountedPrice,
    dietary: itemFields.dietary.optional(),
    allergens: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length).optional(),
    prepTimeMinutes: itemFields.prepTimeMinutes.optional(),
    isAvailable: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    imageKey: imageKeySchema.optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    /** When present, replaces all variants (missing ids are soft-deleted). */
    variants: itemFields.variants,
    /** When present, replaces all add-on groups (missing ids are soft-deleted). */
    addonGroups: itemFields.addonGroups,
    version: z.number().int().positive().optional(),
  })
  .superRefine(refineItem);
export type UpdateItemInput = z.input<typeof updateItemSchema>;
export type UpdateItemData = z.output<typeof updateItemSchema>;

export const availabilitySchema = z.object({ isAvailable: z.boolean() });

export const branchOverrideSchema = z
  .object({
    price: money("price").nullable().optional(),
    discountedPrice: money("discounted price").nullable().optional(),
    isAvailable: z.boolean().nullable().optional(),
  })
  .superRefine((o, ctx) => {
    if (
      o.price !== null &&
      o.price !== undefined &&
      o.discountedPrice !== null &&
      o.discountedPrice !== undefined &&
      o.discountedPrice >= o.price
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["discountedPrice"],
        message: "Discounted price must be lower than the price",
      });
    }
  });
export type BranchOverrideInput = z.input<typeof branchOverrideSchema>;

// ------------------------------------------------------------------ DTOs

export interface VariantDto {
  id: string;
  name: string;
  price: number;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
}

export interface AddonDto {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  sortOrder: number;
}

export interface AddonGroupDto {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  addons: AddonDto[];
}

export interface MenuItemDto {
  id: string;
  restaurantId: string;
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
  imageUrl: string | null;
  sortOrder: number;
  version: number;
  variants: VariantDto[];
  addonGroups: AddonGroupDto[];
  createdAt: string;
  updatedAt: string;
}

export interface MenuCategoryDto {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isVisible: boolean;
  version: number;
}

export interface MenuCategoryTreeDto extends MenuCategoryDto {
  items: MenuItemDto[];
}

/** GET /restaurants/:restaurantId/menu */
export interface MenuTreeDto {
  restaurantId: string;
  menuId: string;
  categories: MenuCategoryTreeDto[];
}

export interface BranchOverrideDto {
  itemId: string;
  branchId: string;
  price: number | null;
  discountedPrice: number | null;
  isAvailable: boolean | null;
  updatedAt: string;
}

/** A menu item for one branch with overrides applied (pricing-engine shape + display fields). */
export type BranchMenuItem = PricedItem & {
  description: string | null;
  imageUrl: string | null;
  dietary: DietaryType;
  allergens: Allergen[];
  prepTimeMinutes: number;
  isFeatured: boolean;
  categoryId: string;
  sortOrder: number;
};

export interface BranchMenuCategory {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  items: BranchMenuItem[];
}

/** Branch-effective menu: visible categories → live items, overrides applied. */
export interface BranchMenu {
  categories: BranchMenuCategory[];
}

export const DIETARY_LABELS: Record<DietaryType, string> = {
  VEG: "Veg",
  NON_VEG: "Non-veg",
  EGG: "Contains egg",
  VEGAN: "Vegan",
};

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  GLUTEN: "Gluten",
  DAIRY: "Dairy",
  EGG: "Egg",
  PEANUT: "Peanut",
  TREE_NUT: "Tree nuts",
  SOY: "Soy",
  FISH: "Fish",
  SHELLFISH: "Shellfish",
  SESAME: "Sesame",
  MUSTARD: "Mustard",
  CELERY: "Celery",
  SULPHITES: "Sulphites",
};

export const UPLOAD_PURPOSE_LIST = UPLOAD_PURPOSES;

/** Read-only menu of one restaurant for Super Admin inspection. */
export interface AdminRestaurantMenuDto {
  workspace: { id: string; name: string };
  restaurant: { id: string; name: string; status: "ACTIVE" | "ARCHIVED" };
  branches: { id: string; name: string; code: string; city: string | null; status: string }[];
  /** Currency of the restaurant's branches (prices are stored in minor units). */
  currency: string;
  menu: MenuTreeDto;
  overrides: BranchOverrideDto[];
}
