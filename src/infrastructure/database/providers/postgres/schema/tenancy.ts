import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { OnboardingProgress } from "@/contracts/workspaces";
import type { RoleScope } from "@/domain/access/permissions";
import type { WorkspaceStatus } from "@/domain/subscriptions/entitlements";

import { id, softDelete, timestamps, tstz, version } from "./_helpers";
import { users } from "./identity";

export type { OnboardingProgress };

export const ORGANIZATION_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const ORGANIZATION_ROLES = ["OWNER", "BILLING_ADMIN"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

/**
 * The billing owner (spec section 7.1): one subscription per organization,
 * shared by all of its workspaces. Backfilled organizations reuse their
 * workspace's id (migration 0003).
 */
export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    status: text("status").$type<OrganizationStatus>().notNull().default("ACTIVE"),
    /** Super Admin per-organization workspace limit; wins over the plan and fair use. */
    maxWorkspacesOverride: integer("max_workspaces_override"),
    ...timestamps,
  },
  (t) => [check("organizations_status_ck", sql`${t.status} in ('ACTIVE', 'SUSPENDED')`)],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<OrganizationRole>().notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("organization_members_uq").on(t.organizationId, t.userId),
    index("organization_members_user_idx").on(t.userId),
    check("organization_members_role_ck", sql`${t.role} in ('OWNER', 'BILLING_ADMIN')`),
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    /** Nullable until the contract step (spec section 9.2); backfilled for every row. */
    organizationId: uuid("organization_id").references(() => organizations.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").$type<WorkspaceStatus>().notNull().default("ACTIVE"),
    legalName: text("legal_name"),
    businessEmail: text("business_email"),
    businessPhone: text("business_phone"),
    country: text("country").notNull().default("IN"),
    taxId: text("tax_id"),
    defaultCurrency: text("default_currency").notNull().default("INR"),
    onboarding: jsonb("onboarding")
      .$type<OnboardingProgress>()
      .notNull()
      .default({ completedSteps: [], currentStep: "business" }),
    statusReason: text("status_reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    version: version(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("workspaces_slug_uq").on(t.slug),
    index("workspaces_organization_idx").on(t.organizationId),
    check("workspaces_status_ck", sql`${t.status} in ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')`),
  ],
);

/** Permission catalog, synced from src/domain/access/permissions.ts by the seed. */
export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  scope: text("scope").$type<RoleScope>().notNull(),
  description: text("description").notNull(),
});

/** Roles: system templates have workspace_id = null; custom roles belong to a workspace. */
export const roles = pgTable(
  "roles",
  {
    id: id(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    scope: text("scope").$type<RoleScope>().notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("roles_workspace_key_uq").on(
      sql`coalesce(${t.workspaceId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.key,
    ),
    check("roles_scope_ck", sql`${t.scope} in ('WORKSPACE', 'RESTAURANT', 'BRANCH')`),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Workspace-scope role (owner / admin / member / custom). */
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    status: text("status").$type<"ACTIVE" | "DISABLED">().notNull().default("ACTIVE"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("workspace_memberships_uq").on(t.workspaceId, t.userId),
    index("workspace_memberships_user_idx").on(t.userId),
    check("workspace_memberships_status_ck", sql`${t.status} in ('ACTIVE', 'DISABLED')`),
  ],
);

export const restaurants = pgTable(
  "restaurants",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    cuisineTypes: text("cuisine_types")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    logoKey: text("logo_key"),
    coverKey: text("cover_key"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    website: text("website"),
    brandColor: text("brand_color"),
    status: text("status").$type<"ACTIVE" | "ARCHIVED">().notNull().default("ACTIVE"),
    version: version(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("restaurants_workspace_slug_uq")
      .on(t.workspaceId, t.slug)
      .where(sql`${t.deletedAt} is null`),
    index("restaurants_workspace_idx").on(t.workspaceId),
  ],
);

export interface BusinessHoursDay {
  day: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  closed: boolean;
  /** "HH:MM" 24h, branch local time */
  open: string;
  close: string;
}

export const branches = pgTable(
  "branches",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postal_code"),
    country: text("country").notNull().default("IN"),
    phone: text("phone"),
    email: text("email"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    currency: text("currency").notNull().default("INR"),
    businessHours: jsonb("business_hours").$type<BusinessHoursDay[]>().notNull().default([]),
    status: text("status").$type<"ACTIVE" | "ARCHIVED">().notNull().default("ACTIVE"),
    version: version(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex("branches_restaurant_code_uq")
      .on(t.restaurantId, t.code)
      .where(sql`${t.deletedAt} is null`),
    index("branches_workspace_idx").on(t.workspaceId),
    index("branches_restaurant_idx").on(t.restaurantId),
  ],
);

/**
 * Role assignment at restaurant or branch scope. This is the
 * "RestaurantMembership" of the domain model: restaurant_id set and branch_id
 * null grants the role across the restaurant; branch_id set limits it to one
 * branch.
 */
export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => workspaceMemberships.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    restaurantId: uuid("restaurant_id")
      .notNull()
      .references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("role_assignments_uq").on(
      t.membershipId,
      t.roleId,
      t.restaurantId,
      sql`coalesce(${t.branchId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index("role_assignments_workspace_idx").on(t.workspaceId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** Workspace-scope role granted on acceptance. */
    workspaceRoleId: uuid("workspace_role_id")
      .notNull()
      .references(() => roles.id),
    /** Optional restaurant/branch assignment granted on acceptance. */
    assignmentRoleId: uuid("assignment_role_id").references(() => roles.id),
    restaurantId: uuid("restaurant_id").references(() => restaurants.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<"PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED">()
      .notNull()
      .default("PENDING"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: tstz("expires_at").notNull(),
    acceptedAt: tstz("accepted_at"),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("invitations_token_uq").on(t.tokenHash),
    index("invitations_workspace_idx").on(t.workspaceId, t.status),
    uniqueIndex("invitations_pending_email_uq")
      .on(t.workspaceId, t.email)
      .where(sql`${t.status} = 'PENDING'`),
  ],
);
