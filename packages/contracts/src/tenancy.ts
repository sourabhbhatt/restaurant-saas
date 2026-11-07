import { z } from "zod";

import {
  ALL_PERMISSIONS,
  isPermission,
  PERMISSIONS,
  type Permission,
  type RoleScope,
} from "@ros/domain/access/permissions";
import { PAYMENT_METHODS, type PaymentMethod } from "@ros/domain/billing/payments";
import { MAX_BPS, SUPPORTED_CURRENCIES } from "@ros/domain/shared/money";

import { emailSchema } from "./auth";
import { OBJECT_KEY } from "./menu";

/**
 * Tenancy contracts: restaurants, branches, settings, members, invitations,
 * roles. Shared by the API handlers (validation) and the forms (zodResolver).
 */

// ------------------------------------------------------------------ helpers

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .transform((v) => (v === "" ? null : v.toLowerCase()))
  .pipe(z.email("Enter a valid email").nullable())
  .nullable()
  .optional();

const optionalWebsite = z
  .string()
  .trim()
  .max(200, "Use at most 200 characters")
  .transform((v) => (v === "" ? null : /^https?:\/\//i.test(v) ? v : `https://${v}`))
  .pipe(
    z
      .string()
      .regex(/^https?:\/\/[^\s/$.?#][^\s]*\.[^\s]+$/i, "Enter a valid website address")
      .nullable(),
  )
  .nullable()
  .optional();

const optionalFileKey = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || OBJECT_KEY.test(v), "Upload the image again")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** "" from a <Select> means "none". */
const optionalId = z
  .union([z.literal("").transform(() => null), z.uuid("Invalid id")])
  .nullable()
  .optional();

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ restaurants

export const restaurantFieldsSchema = z.object({
  name: z.string().trim().min(2, "Enter a restaurant name").max(80, "Name is too long"),
  description: optionalText(500),
  cuisineTypes: z
    .array(z.string().trim().min(1).max(30, "Use at most 30 characters per cuisine"))
    .max(10, "Add at most 10 cuisines")
    .transform((list) => [...new Set(list)])
    .optional(),
  logoKey: optionalFileKey,
  coverKey: optionalFileKey,
  contactEmail: optionalEmail,
  contactPhone: optionalText(30),
  website: optionalWebsite,
  brandColor: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .pipe(
      z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #E4572E")
        .nullable(),
    )
    .nullable()
    .optional(),
});

export const createRestaurantSchema = restaurantFieldsSchema;
export type CreateRestaurantInput = z.input<typeof createRestaurantSchema>;

export const restaurantSettingsSchema = z.object({
  showPrepTime: z.boolean().optional(),
  showAllergens: z.boolean().optional(),
  welcomeMessage: optionalText(300),
});

export const updateRestaurantSchema = restaurantFieldsSchema.partial().extend({
  settings: restaurantSettingsSchema.optional(),
  version: z.number().int().positive().optional(),
});
export type UpdateRestaurantInput = z.input<typeof updateRestaurantSchema>;

// ------------------------------------------------------------------ branches

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

export const businessHoursDaySchema = z
  .object({
    day: z.number().int().min(0).max(6),
    closed: z.boolean(),
    open: hhmm,
    close: hhmm,
  })
  .refine((d) => d.closed || d.open !== d.close, {
    message: "Opening and closing time can't be the same",
    path: ["close"],
  });

export const businessHoursSchema = z
  .array(businessHoursDaySchema)
  .max(7)
  .refine((days) => new Set(days.map((d) => d.day)).size === days.length, {
    message: "Each weekday can appear only once",
  });

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface BusinessHoursDayDto {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  closed: boolean;
  open: string;
  close: string;
}

export function defaultBusinessHours(): BusinessHoursDayDto[] {
  return ([0, 1, 2, 3, 4, 5, 6] as const).map((day) => ({
    day,
    closed: false,
    open: "09:00",
    close: "22:00",
  }));
}

export const branchCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, "Use 2–20 letters, digits or dashes");

export const branchFieldsSchema = z.object({
  name: z.string().trim().min(2, "Enter a branch name").max(80, "Name is too long"),
  code: z.union([z.literal("").transform(() => undefined), branchCodeSchema]).optional(),
  addressLine1: optionalText(120),
  addressLine2: optionalText(120),
  city: optionalText(80),
  state: optionalText(80),
  postalCode: optionalText(20),
  country: z.string().trim().toUpperCase().length(2, "Use a 2-letter country code").optional(),
  phone: optionalText(30),
  email: optionalEmail,
  timezone: z
    .string()
    .trim()
    .min(1, "Choose a time zone")
    .refine(isValidTimeZone, "Unknown time zone")
    .optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  businessHours: businessHoursSchema.optional(),
});

export const createBranchSchema = branchFieldsSchema;
export type CreateBranchInput = z.input<typeof createBranchSchema>;

export const updateBranchSchema = branchFieldsSchema.partial().extend({
  version: z.number().int().positive().optional(),
});
export type UpdateBranchInput = z.input<typeof updateBranchSchema>;

// ------------------------------------------------------------------ branch settings

export const taxRateSchema = z.object({
  name: z.string().trim().min(1, "Name the tax").max(30, "Use at most 30 characters"),
  rateBps: z
    .number({ error: "Enter a rate" })
    .int("Use at most 2 decimals")
    .min(0, "Rate can't be negative")
    .max(MAX_BPS, "Rate can't exceed 100%"),
});

export const branchSettingsSchema = z
  .object({
    taxes: z.array(taxRateSchema).max(6, "Add at most 6 taxes"),
    pricesIncludeTax: z.boolean(),
    serviceChargeBps: z
      .number({ error: "Enter a service charge" })
      .int("Use at most 2 decimals")
      .min(0, "Can't be negative")
      .max(5000, "Service charge can be at most 50%"),
    paymentMethods: z
      .array(z.enum(PAYMENT_METHODS))
      .min(1, "Enable at least one payment method")
      .refine((m) => new Set(m).size === m.length, "Each payment method only once"),
    requireFullPaymentToClose: z.boolean(),
    autoCompleteOnPayment: z.boolean(),
    allowCustomerBillRequest: z.boolean(),
    acceptingOrders: z.boolean(),
    kitchenDelayMinutes: z
      .number({ error: "Enter minutes" })
      .int("Whole minutes only")
      .min(1, "At least 1 minute")
      .max(240, "At most 240 minutes"),
    kitchenSoundEnabled: z.boolean(),
    waiterSoundEnabled: z.boolean(),
    receiptHeader: optionalText(300),
    receiptFooter: optionalText(300),
    version: z.number().int().positive().optional(),
  })
  .refine((s) => s.taxes.reduce((a, t) => a + t.rateBps, 0) <= MAX_BPS, {
    message: "Total tax can't exceed 100%",
    path: ["taxes"],
  });
export type BranchSettingsInput = z.input<typeof branchSettingsSchema>;

// ------------------------------------------------------------------ roles

/** Which permissions a role of each scope may contain. */
export function allowedPermissionsForScope(scope: RoleScope): Permission[] {
  if (scope === "WORKSPACE") return ALL_PERMISSIONS;
  if (scope === "RESTAURANT")
    return ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].scope !== "WORKSPACE");
  return ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].scope === "BRANCH");
}

const permissionKey = z.string().refine(isPermission, "Unknown permission");

export const createRoleSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a role name").max(40, "Name is too long"),
    description: optionalText(200),
    scope: z.enum(["WORKSPACE", "RESTAURANT", "BRANCH"]),
    permissions: z
      .array(permissionKey)
      .min(1, "Choose at least one permission")
      .transform((list) => [...new Set(list)] as Permission[]),
  })
  .superRefine((v, ctx) => {
    const allowed = new Set<string>(allowedPermissionsForScope(v.scope));
    const bad = v.permissions.filter((p) => !allowed.has(p));
    if (bad.length) {
      ctx.addIssue({
        code: "custom",
        path: ["permissions"],
        message: `Not allowed for a ${v.scope.toLowerCase()} role: ${bad.join(", ")}`,
      });
    }
  });
export type CreateRoleInput = z.input<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2, "Enter a role name").max(40, "Name is too long").optional(),
  description: optionalText(200),
  permissions: z
    .array(permissionKey)
    .min(1, "Choose at least one permission")
    .transform((list) => [...new Set(list)] as Permission[])
    .optional(),
});
export type UpdateRoleInput = z.input<typeof updateRoleSchema>;

// ------------------------------------------------------------------ members & assignments

export const updateMemberSchema = z
  .object({
    roleId: z.uuid("Choose a role").optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  })
  .refine((v) => v.roleId !== undefined || v.status !== undefined, {
    message: "Nothing to change",
  });

export const createAssignmentSchema = z.object({
  roleId: z.uuid("Choose a role"),
  restaurantId: z.uuid("Choose a restaurant"),
  branchId: optionalId,
});
export type CreateAssignmentInput = z.input<typeof createAssignmentSchema>;

export const assignBranchStaffSchema = z.object({
  membershipId: z.uuid("Choose a member"),
  roleId: z.uuid("Choose a role"),
  /** true = assign across the whole restaurant instead of this branch only. */
  restaurantWide: z.boolean().default(false),
});
export type AssignBranchStaffInput = z.input<typeof assignBranchStaffSchema>;

// ------------------------------------------------------------------ invitations

export const createInvitationSchema = z
  .object({
    email: emailSchema,
    workspaceRoleId: z.uuid("Choose a workspace role"),
    assignmentRoleId: optionalId,
    restaurantId: optionalId,
    branchId: optionalId,
  })
  .superRefine((v, ctx) => {
    if (v.branchId && !v.restaurantId) {
      ctx.addIssue({ code: "custom", path: ["restaurantId"], message: "Choose the restaurant" });
    }
    if (v.assignmentRoleId && !v.restaurantId) {
      ctx.addIssue({ code: "custom", path: ["restaurantId"], message: "Choose a restaurant" });
    }
    if (v.restaurantId && !v.assignmentRoleId) {
      ctx.addIssue({
        code: "custom",
        path: ["assignmentRoleId"],
        message: "Choose a role for this restaurant or branch",
      });
    }
  });
export type CreateInvitationInput = z.input<typeof createInvitationSchema>;

export const invitationTokenParam = z.string().min(20).max(100);

// ------------------------------------------------------------------ DTOs

export interface RestaurantDto {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  cuisineTypes: string[];
  logoKey: string | null;
  coverKey: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  brandColor: string | null;
  status: "ACTIVE" | "ARCHIVED";
  version: number;
  createdAt: string;
}

export interface RestaurantSettingsDto {
  showPrepTime: boolean;
  showAllergens: boolean;
  welcomeMessage: string | null;
  version: number;
}

export interface BranchSummaryDto {
  id: string;
  name: string;
  code: string;
  city: string | null;
  status: "ACTIVE" | "ARCHIVED";
}

export interface RestaurantListItemDto extends RestaurantDto {
  branches: BranchSummaryDto[];
}

export interface BranchDto {
  id: string;
  workspaceId: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  code: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  timezone: string;
  currency: string;
  businessHours: BusinessHoursDayDto[];
  status: "ACTIVE" | "ARCHIVED";
  version: number;
  createdAt: string;
}

export interface RestaurantDetailDto extends RestaurantDto {
  settings: RestaurantSettingsDto;
  branches: BranchDto[];
  /** Caller's effective permissions at this restaurant (display only). */
  permissions: Permission[];
}

export interface BranchSettingsDto {
  branchId: string;
  taxes: { name: string; rateBps: number }[];
  pricesIncludeTax: boolean;
  serviceChargeBps: number;
  paymentMethods: PaymentMethod[];
  requireFullPaymentToClose: boolean;
  autoCompleteOnPayment: boolean;
  allowCustomerBillRequest: boolean;
  acceptingOrders: boolean;
  kitchenDelayMinutes: number;
  kitchenSoundEnabled: boolean;
  waiterSoundEnabled: boolean;
  receiptHeader: string | null;
  receiptFooter: string | null;
  version: number;
  updatedAt: string;
}

export interface RoleRefDto {
  id: string;
  key: string;
  name: string;
  scope: RoleScope;
}

export interface RoleDto extends RoleRefDto {
  description: string | null;
  isSystem: boolean;
  permissions: Permission[];
  /** Memberships + assignments + pending invitations using the role. */
  usageCount: number;
}

export interface AssignmentDto {
  id: string;
  role: RoleRefDto;
  restaurantId: string;
  restaurantName: string;
  branchId: string | null;
  branchName: string | null;
}

export interface MemberDto {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  status: "ACTIVE" | "DISABLED";
  role: RoleRefDto;
  joinedAt: string;
  assignments: AssignmentDto[];
}

export interface StaffAssignmentDto extends AssignmentDto {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  memberStatus: "ACTIVE" | "DISABLED";
}

export interface BranchStaffDto {
  assignments: StaffAssignmentDto[];
  /** Active workspace members that can be assigned. */
  candidates: { membershipId: string; name: string; email: string; roleName: string }[];
  /** Restaurant/branch roles that can be assigned. */
  roles: RoleRefDto[];
  /** Workspace role id used for "invite to this branch". */
  memberRoleId: string;
}

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface InvitationDto {
  id: string;
  email: string;
  status: InvitationStatus;
  expired: boolean;
  workspaceRole: RoleRefDto;
  assignmentRole: RoleRefDto | null;
  restaurantId: string | null;
  restaurantName: string | null;
  branchId: string | null;
  branchName: string | null;
  invitedByName: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface CreatedInvitationDto {
  invitation: InvitationDto;
  /** Shown once so it can be copied (email may not be delivered in dev). */
  inviteUrl: string;
}

export interface InvitationPreviewDto {
  workspaceName: string;
  inviterName: string | null;
  email: string;
  roleName: string;
  assignmentRoleName: string | null;
  restaurantName: string | null;
  branchName: string | null;
  status: InvitationStatus;
  expired: boolean;
  expiresAt: string;
}

export interface AcceptInvitationResultDto {
  workspaceId: string;
  /** Branch to land on when the invitation granted a branch role. */
  branchId: string | null;
}

/** Permission catalog grouped by scope, for the role editor. */
export function permissionGroups(): {
  scope: RoleScope;
  permissions: { key: Permission; description: string }[];
}[] {
  return (["WORKSPACE", "RESTAURANT", "BRANCH"] as const).map((scope) => ({
    scope,
    permissions: ALL_PERMISSIONS.filter((p) => PERMISSIONS[p].scope === scope).map((key) => ({
      key,
      description: PERMISSIONS[key].description,
    })),
  }));
}
