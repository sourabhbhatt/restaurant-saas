import path from "node:path";

/** Accounts created by `apps/api/scripts/seed.ts` (local demo data only). */
export const STAFF_PASSWORD = "Demo-Staff-2026";

export const DEMO_ACCOUNTS = {
  admin: { email: "admin@restaurantos.local", password: "ChangeMe-Admin-2026" },
  owner: { email: "owner@demo.local", password: "Demo-Owner-2026" },
  manager: { email: "manager@demo.local", password: STAFF_PASSWORD },
  waiter: { email: "waiter@demo.local", password: STAFF_PASSWORD },
  kitchen: { email: "kitchen@demo.local", password: STAFF_PASSWORD },
  cashier: { email: "cashier@demo.local", password: STAFF_PASSWORD },
} as const;

export type DemoRole = keyof typeof DEMO_ACCOUNTS;

export const DEMO = {
  workspaceName: "Demo Hospitality Group",
  restaurantName: "Saffron Table",
  branchName: "Indiranagar",
  otherBranchName: "Koramangala",
} as const;

/** Saved sessions live under the git-ignored .data directory. */
export const AUTH_DIR = path.resolve(__dirname, "../../../.data/e2e-auth");

export const authFile = (role: DemoRole) => path.join(AUTH_DIR, `${role}.json`);
