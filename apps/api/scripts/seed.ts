/**
 * Demo data for local development. Idempotent (skips if the demo owner exists).
 * Usage: pnpm db:seed          (refuses to run when NODE_ENV=production)
 *
 * Local logins (PGlite or a localhost Postgres):
 *   admin@restaurantos.local   / ChangeMe-Admin-2026   (Super Admin)
 *   owner@demo.local           / Demo-Owner-2026       (Workspace Owner)
 *   manager|waiter|kitchen|cashier@demo.local / Demo-Staff-2026 (Indiranagar branch)
 *
 * Any other database (staging) needs SEED_ADMIN_PASSWORD, SEED_OWNER_PASSWORD
 * and SEED_STAFF_PASSWORD (12+ characters, not the published defaults): the
 * defaults above are in the README, so they must never work on a public URL.
 */
import { and, eq, isNull } from "drizzle-orm";

import { addDays } from "@ros/domain/subscriptions/entitlements";
import { hashPasswordScrypt } from "@ros/adapters/auth/providers/local-identity";
import {
  connectPglite,
  connectPostgres,
  runMigrations,
  type Executor,
} from "@ros/database/providers/postgres/client";
import {
  addonGroups,
  addons,
  branchSettings,
  branches,
  diningTables,
  menuCategories,
  menuItems,
  menuVariants,
  menus,
  organizationMembers,
  organizations,
  restaurantSettings,
  restaurants,
  roleAssignments,
  roles,
  subscriptionPlans,
  subscriptions,
  tableQrTokens,
  users,
  workspaceMemberships,
  workspaces,
} from "@ros/database/providers/postgres/schema";
import { ensureSystemData } from "@ros/database/providers/postgres/system-data";
import { newQrToken, qrUrl } from "@ros/application/modules/tables/qr-tokens";

const QR_BASE_URL = process.env.QR_BASE_URL ?? process.env.APP_URL ?? "http://localhost:3000";
const APP_SECRET = process.env.APP_SECRET ?? "dev-only-insecure-secret-change-me-0123456789";

async function user(db: Executor, email: string, name: string, password: string, admin = false) {
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(users)
    .values({
      email,
      name,
      passwordHash: await hashPasswordScrypt(password),
      emailVerifiedAt: new Date(),
      platformRole: admin ? "SUPER_ADMIN" : null,
    })
    .returning({ id: users.id });
  return row!.id;
}

async function roleId(db: Executor, key: string) {
  const [r] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(isNull(roles.workspaceId), eq(roles.key, key)))
    .limit(1);
  return r!.id;
}

const MENU: Record<string, { name: string; price: number; veg: boolean; prep: number }[]> = {
  Starters: [
    { name: "Paneer Tikka", price: 28900, veg: true, prep: 15 },
    { name: "Chicken 65", price: 31900, veg: false, prep: 18 },
    { name: "Veg Spring Rolls", price: 21900, veg: true, prep: 12 },
    { name: "Hara Bhara Kebab", price: 24900, veg: true, prep: 14 },
  ],
  "Main Course": [
    { name: "Butter Chicken", price: 38900, veg: false, prep: 20 },
    { name: "Dal Makhani", price: 27900, veg: true, prep: 15 },
    { name: "Paneer Butter Masala", price: 33900, veg: true, prep: 18 },
    { name: "Lamb Rogan Josh", price: 44900, veg: false, prep: 25 },
  ],
  Breads: [
    { name: "Butter Naan", price: 6900, veg: true, prep: 6 },
    { name: "Garlic Naan", price: 7900, veg: true, prep: 6 },
    { name: "Tandoori Roti", price: 4900, veg: true, prep: 5 },
  ],
  Rice: [
    { name: "Veg Biryani", price: 28900, veg: true, prep: 20 },
    { name: "Chicken Biryani", price: 34900, veg: false, prep: 22 },
  ],
  Desserts: [
    { name: "Gulab Jamun", price: 12900, veg: true, prep: 5 },
    { name: "Kulfi Falooda", price: 15900, veg: true, prep: 5 },
  ],
  Drinks: [
    { name: "Masala Chai", price: 7900, veg: true, prep: 5 },
    { name: "Fresh Lime Soda", price: 9900, veg: true, prep: 4 },
    { name: "Mango Lassi", price: 12900, veg: true, prep: 4 },
  ],
};

const DEFAULT_PASSWORDS = {
  admin: "ChangeMe-Admin-2026",
  owner: "Demo-Owner-2026",
  staff: "Demo-Staff-2026",
} as const;

/** Local databases may use the published passwords; anything else must set its own. */
function seedPasswords(isLocal: boolean): Record<keyof typeof DEFAULT_PASSWORDS, string> {
  const fromEnv = {
    admin: process.env.SEED_ADMIN_PASSWORD,
    owner: process.env.SEED_OWNER_PASSWORD,
    staff: process.env.SEED_STAFF_PASSWORD,
  };
  if (isLocal)
    return {
      admin: fromEnv.admin || DEFAULT_PASSWORDS.admin,
      owner: fromEnv.owner || DEFAULT_PASSWORDS.owner,
      staff: fromEnv.staff || DEFAULT_PASSWORDS.staff,
    };
  for (const key of Object.keys(DEFAULT_PASSWORDS) as (keyof typeof DEFAULT_PASSWORDS)[]) {
    const value = fromEnv[key];
    if (!value || value.length < 12 || value === DEFAULT_PASSWORDS[key])
      throw new Error(
        `Seeding a non-local database needs SEED_${key.toUpperCase()}_PASSWORD (12+ characters, not the published default)`,
      );
  }
  return fromEnv as Record<keyof typeof DEFAULT_PASSWORDS, string>;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");
  const provider = process.env.DATABASE_PROVIDER === "pglite" ? "pglite" : "postgres";
  const url =
    process.env.DATABASE_URL ??
    "postgres://restaurantos:restaurantos@localhost:5432/restaurantos_dev";
  // A Cloud SQL Auth Proxy also listens on 127.0.0.1: SEED_REMOTE=1 marks such a target as shared.
  const isLocal =
    process.env.SEED_REMOTE !== "1" &&
    (provider === "pglite" ||
      /^postgres(ql)?:\/\/[^@]*@(localhost|127\.0\.0\.1|postgres)[:/]/.test(url));
  const passwords = seedPasswords(isLocal);
  const handle =
    provider === "pglite"
      ? await connectPglite(process.env.PGLITE_DATA_DIR)
      : await connectPostgres(url, 2);
  const db = handle.db;
  try {
    await runMigrations(handle, provider);
    await ensureSystemData(db);

    await user(db, "admin@restaurantos.local", "Platform Admin", passwords.admin, true);
    if (
      await db
        .select()
        .from(users)
        .where(eq(users.email, "owner@demo.local"))
        .then((r) => r.length)
    ) {
      console.log("Demo data already present. Nothing to do.");
      return;
    }
    const ownerId = await user(db, "owner@demo.local", "Demo Owner", passwords.owner);

    // Organizations own billing (migration 0003): one per workspace, the owner as OWNER.
    const [org] = await db
      .insert(organizations)
      .values({ name: "Demo Hospitality Group", createdBy: ownerId })
      .returning({ id: organizations.id });
    const organizationId = org!.id;
    await db.insert(organizationMembers).values({ organizationId, userId: ownerId, role: "OWNER" });
    const [ws] = await db
      .insert(workspaces)
      .values({
        organizationId,
        name: "Demo Hospitality Group",
        slug: `demo-hospitality-${Date.now().toString(36)}`,
        createdBy: ownerId,
        onboarding: {
          completedSteps: ["business", "restaurant", "branch", "menu", "tables"],
          currentStep: "done",
        },
      })
      .returning({ id: workspaces.id });
    const workspaceId = ws!.id;
    const [ownerM] = await db
      .insert(workspaceMemberships)
      .values({ workspaceId, userId: ownerId, roleId: await roleId(db, "workspace_owner") })
      .returning({ id: workspaceMemberships.id });
    void ownerM;

    const [plan] = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.key, "pro"))
      .limit(1);
    const now = new Date();
    await db.insert(subscriptions).values({
      workspaceId,
      organizationId,
      planId: plan!.id,
      status: "TRIALING",
      trialStartsAt: now,
      trialEndsAt: addDays(now, 15),
    });

    const [rest] = await db
      .insert(restaurants)
      .values({
        workspaceId,
        name: "Saffron Table",
        slug: "saffron-table",
        description: "Modern North Indian kitchen.",
        cuisineTypes: ["North Indian", "Tandoor"],
        brandColor: "#c24300",
      })
      .returning({ id: restaurants.id });
    const restaurantId = rest!.id;
    await db.insert(restaurantSettings).values({ restaurantId, workspaceId });

    const [menu] = await db
      .insert(menus)
      .values({ workspaceId, restaurantId, name: "Main Menu" })
      .returning({ id: menus.id });
    let order = 0;
    for (const [category, items] of Object.entries(MENU)) {
      const [cat] = await db
        .insert(menuCategories)
        .values({ workspaceId, restaurantId, menuId: menu!.id, name: category, sortOrder: order++ })
        .returning({ id: menuCategories.id });
      let i = 0;
      for (const it of items) {
        const [item] = await db
          .insert(menuItems)
          .values({
            workspaceId,
            restaurantId,
            categoryId: cat!.id,
            name: it.name,
            description: `${it.name}, made fresh to order.`,
            price: it.price,
            dietary: it.veg ? "VEG" : "NON_VEG",
            prepTimeMinutes: it.prep,
            isFeatured: i === 0,
            allergens: it.veg ? ["DAIRY"] : [],
            sortOrder: i++,
          })
          .returning({ id: menuItems.id });
        if (category === "Main Course" || category === "Rice") {
          await db.insert(menuVariants).values([
            {
              workspaceId,
              itemId: item!.id,
              name: "Half",
              price: Math.round(it.price * 0.65),
              sortOrder: 0,
            },
            {
              workspaceId,
              itemId: item!.id,
              name: "Full",
              price: it.price,
              isDefault: true,
              sortOrder: 1,
            },
          ]);
        }
        if (category === "Starters" || category === "Breads") {
          const [g] = await db
            .insert(addonGroups)
            .values({ workspaceId, itemId: item!.id, name: "Extras", minSelect: 0, maxSelect: 2 })
            .returning({ id: addonGroups.id });
          await db.insert(addons).values([
            { workspaceId, groupId: g!.id, name: "Extra Cheese", price: 4000, sortOrder: 0 },
            { workspaceId, groupId: g!.id, name: "Mint Chutney", price: 1500, sortOrder: 1 },
          ]);
        }
      }
    }

    const staff: [string, string, string][] = [
      ["manager@demo.local", "Maya Manager", "restaurant_manager"],
      ["waiter@demo.local", "Wasim Waiter", "waiter"],
      ["kitchen@demo.local", "Kiran Kitchen", "kitchen_staff"],
      ["cashier@demo.local", "Chitra Cashier", "cashier"],
    ];
    const qrLinks: string[] = [];
    for (const branchName of ["Indiranagar", "Koramangala"]) {
      const [b] = await db
        .insert(branches)
        .values({
          workspaceId,
          restaurantId,
          name: branchName,
          code: branchName.slice(0, 3).toUpperCase(),
          city: "Bengaluru",
          state: "Karnataka",
        })
        .returning({ id: branches.id });
      const branchId = b!.id;
      await db.insert(branchSettings).values({
        branchId,
        workspaceId,
        taxes: [
          { name: "CGST", rateBps: 250 },
          { name: "SGST", rateBps: 250 },
        ],
      });
      for (let n = 1; n <= 12; n++) {
        const [t] = await db
          .insert(diningTables)
          .values({
            workspaceId,
            restaurantId,
            branchId,
            name: `T${n}`,
            capacity: n % 3 === 0 ? 6 : 4,
            sortOrder: n,
          })
          .returning({ id: diningTables.id });
        const q = await newQrToken(APP_SECRET);
        await db.insert(tableQrTokens).values({
          workspaceId,
          branchId,
          tableId: t!.id,
          tokenHash: q.tokenHash,
          tokenCiphertext: q.tokenCiphertext,
        });
        if (n <= 2) qrLinks.push(`${branchName} T${n}: ${qrUrl(QR_BASE_URL, q.token)}`);
      }
      if (branchName === "Indiranagar") {
        for (const [email, name, role] of staff) {
          const uid = await user(db, email, name, passwords.staff);
          const [m] = await db
            .insert(workspaceMemberships)
            .values({ workspaceId, userId: uid, roleId: await roleId(db, "workspace_member") })
            .returning({ id: workspaceMemberships.id });
          await db.insert(roleAssignments).values({
            workspaceId,
            membershipId: m!.id,
            roleId: await roleId(db, role),
            restaurantId,
            branchId: role === "restaurant_manager" ? null : branchId,
          });
        }
        console.log(`Indiranagar branch id: ${branchId}`);
      }
    }
    console.log("\nSeeded. Sample customer QR links:\n" + qrLinks.join("\n"));
    console.log(
      isLocal &&
        !process.env.SEED_ADMIN_PASSWORD &&
        !process.env.SEED_OWNER_PASSWORD &&
        !process.env.SEED_STAFF_PASSWORD
        ? `\nLogins: owner@demo.local / ${passwords.owner} · staff (manager|waiter|kitchen|cashier)@demo.local / ${passwords.staff} · admin@restaurantos.local / ${passwords.admin}`
        : "\nLogins: owner@demo.local, (manager|waiter|kitchen|cashier)@demo.local, admin@restaurantos.local — passwords from SEED_*_PASSWORD (not printed).",
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
