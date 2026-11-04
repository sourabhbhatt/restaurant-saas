import { and, eq, isNull, notInArray, sql } from "drizzle-orm";

import { PERMISSIONS, ROLE_TEMPLATE_LIST } from "@/domain/access/permissions";
import { DEFAULT_PLATFORM_SETTINGS } from "@/domain/platform/settings";
import type { FeatureKey, PlanLimits } from "@/domain/subscriptions/entitlements";

import type { Executor } from "./client";
import { permissions, platformSettings, rolePermissions, roles, subscriptionPlans } from "./schema";

/**
 * Idempotently sync reference data that the code depends on: permission
 * catalog, system role templates, default plans (only if no plans exist) and
 * default platform settings (only missing keys). Safe to run on every boot.
 */
export async function ensureSystemData(db: Executor): Promise<void> {
  await db.transaction(async (tx) => {
    const catalog = Object.entries(PERMISSIONS).map(([key, p]) => ({
      key,
      scope: p.scope,
      description: p.description,
    }));
    await tx
      .insert(permissions)
      .values(catalog)
      .onConflictDoUpdate({
        target: permissions.key,
        set: { scope: sql`excluded.scope`, description: sql`excluded.description` },
      });

    for (const template of ROLE_TEMPLATE_LIST) {
      const [existing] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(isNull(roles.workspaceId), eq(roles.key, template.key)))
        .limit(1);
      let roleId = existing?.id;
      if (roleId) {
        await tx
          .update(roles)
          .set({
            name: template.name,
            description: template.description,
            scope: template.scope,
            isSystem: true,
          })
          .where(eq(roles.id, roleId));
      } else {
        const [created] = await tx
          .insert(roles)
          .values({
            key: template.key,
            name: template.name,
            description: template.description,
            scope: template.scope,
            isSystem: true,
          })
          .returning({ id: roles.id });
        roleId = created!.id;
      }
      // System role permissions always mirror the code templates.
      await tx
        .delete(rolePermissions)
        .where(
          and(
            eq(rolePermissions.roleId, roleId),
            notInArray(rolePermissions.permissionKey, [...template.permissions]),
          ),
        );
      await tx
        .insert(rolePermissions)
        .values(template.permissions.map((p) => ({ roleId: roleId!, permissionKey: p })))
        .onConflictDoNothing();
    }

    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(subscriptionPlans);
    if (n === 0) await tx.insert(subscriptionPlans).values(DEFAULT_PLANS);

    await tx
      .insert(platformSettings)
      .values(Object.entries(DEFAULT_PLATFORM_SETTINGS).map(([key, value]) => ({ key, value })))
      .onConflictDoNothing();
  });
}

const allFeatures: FeatureKey[] = [
  "qr_ordering",
  "kitchen_display",
  "multi_branch",
  "analytics",
  "advanced_analytics",
  "custom_roles",
  "offline_mode",
  "push_notifications",
  "email_notifications",
  "data_export",
];

const limits = (l: Partial<PlanLimits>): PlanLimits => ({
  maxRestaurants: null,
  maxBranches: null,
  maxStaff: null,
  maxTables: null,
  maxMenuItems: null,
  storageMb: null,
  ...l,
});

/** Initial example plans. Super Admin edits these as data; nothing reads these constants at runtime. */
export const DEFAULT_PLANS: (typeof subscriptionPlans.$inferInsert)[] = [
  {
    key: "starter",
    name: "Starter",
    description: "One restaurant getting started with QR ordering.",
    currency: "INR",
    monthlyPrice: 49_900,
    annualPrice: 499_000,
    isTrialEligible: true,
    isPublic: true,
    limits: limits({
      maxRestaurants: 1,
      maxBranches: 1,
      maxStaff: 10,
      maxTables: 25,
      maxMenuItems: 150,
      storageMb: 200,
    }),
    features: [
      "qr_ordering",
      "kitchen_display",
      "analytics",
      "offline_mode",
      "email_notifications",
    ],
    sortOrder: 1,
  },
  {
    key: "pro",
    name: "Pro",
    description: "Growing restaurants with multiple branches and advanced reports.",
    currency: "INR",
    monthlyPrice: 99_900,
    annualPrice: 999_000,
    isTrialEligible: true,
    isPublic: true,
    limits: limits({
      maxRestaurants: 3,
      maxBranches: 10,
      maxStaff: 75,
      maxTables: 200,
      maxMenuItems: 1000,
      storageMb: 2000,
    }),
    features: allFeatures,
    sortOrder: 2,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "Custom limits, onboarding and support for restaurant groups.",
    currency: "INR",
    monthlyPrice: null,
    annualPrice: null,
    isTrialEligible: false,
    isPublic: true,
    limits: limits({}),
    features: allFeatures,
    sortOrder: 3,
  },
];
