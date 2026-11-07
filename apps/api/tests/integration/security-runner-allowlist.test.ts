import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as me } from "@/app/api/v1/auth/me/route";
import { GET as listWorkspaces } from "@/app/api/v1/workspaces/route";
import * as client from "@ros/database/providers/postgres/client";
import type { Container } from "@/composition/container";
import { createWorkspaceAs, signUpUser } from "@/test/fixtures";
import { call, createTestContainer } from "@/test/harness";

/**
 * Files allowed to reach the database as the connection owner, which bypasses
 * row-level security. Each entry states why it cannot use the tenant runner.
 */
const SYSTEM_ALLOW_LIST: Record<string, string> = {
  "src/composition/container.ts":
    "core repos (identity, access, audit, idempotency, rate limit, outbox) and entitlements: authentication and the authorization lookup itself",
  "src/composition/platform.ts": "Super Admin console and scheduled jobs span workspaces",
  "src/composition/dev-mailbox.ts": "local/test mailbox reads the outbox",
  "src/composition/ordering.ts":
    "lookup runner: QR token and guest token resolve the workspace, then bind it",
  "src/composition/tenancy.ts":
    "lookup runner: invitation token resolves the workspace, then binds it",
  "src/composition/workspaces.ts": "bootstrap: the workspace does not exist yet when it is created",
  // Authorization lookups: an id from the URL is resolved to its owning branch/restaurant
  // before the access service can verify membership and bind the workspace.
  "src/composition/billing.ts": "lookup: bill/payment id → branch, then access.forBranch",
  "src/composition/menu.ts": "lookup: category/item id → restaurant, then access.forRestaurant",
  "src/composition/staff-ops.ts": "lookup: order id → branch, then access.forBranch",
  "src/composition/tables.ts": "lookup: table id → branch, then access.forBranch",
  "src/composition/analytics.ts":
    "Super Admin platform aggregates (route auth platform) count across workspaces",
  "src/composition/notifications.ts":
    "the actor's own notification writes span workspaces and workspace-less rows; filtered by user",
  "src/composition/payments.ts":
    "payment orders/events are tenant read-only and activation rewrites the organization's subscription; the webhook has no user. Checkout/verify first pass a tenant-scoped membership check",
};

/**
 * Route handlers that call the container's owner-level core repositories
 * directly. Each is filtered by the actor or follows an authorization check.
 */
const ROUTE_CORE_REPO_USES: Record<string, string[]> = {
  // Super Admin (auth "platform"); the restaurant must belong to the workspace in the URL.
  "src/app/api/v1/admin/workspaces/[workspaceId]/restaurants/[restaurantId]/menu/route.ts": [
    "access.findBranchRef",
    "access.findRestaurantRef",
    "access.findWorkspaceName",
    "access.listStructure",
  ],
  // The caller's own workspaces (filtered by actor.userId in SQL).
  "src/app/api/v1/auth/me/route.ts": ["access.listUserWorkspaces"],
  "src/app/api/v1/workspaces/route.ts": ["access.listUserWorkspaces"],
  // After access.forWorkspace, with the scope's workspace id.
  "src/app/api/v1/workspaces/[workspaceId]/structure/route.ts": ["access.listStructure"],
};

/** apps/api; the application package is scanned through the repo root. */
const ROOT = path.resolve(import.meta.dirname, "../..");
const APPLICATION_SRC = "../../packages/application/src";

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(rel)));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** System access: the system runner, or the container's raw executor handed to a repository. */
function usesSystemAccess(source: string): boolean {
  const withoutRunnerArgs = source.replace(/create(Tenant|System)Runner\(\s*c\.db\b/g, "");
  return (
    /createSystem(Runner|Lookup)\(/.test(source) ||
    /\bc\.db\b/.test(withoutRunnerArgs) ||
    /Repository\(\s*db\s*[,)]/.test(source)
  );
}

describe("system runner allow-list", () => {
  it("createSystemRunner is only used in allow-listed files", async () => {
    const files = [
      ...(await sourceFiles(APPLICATION_SRC)),
      ...(await sourceFiles("src/composition")),
      ...(await sourceFiles("src/handlers")),
      ...(await sourceFiles("src/app")),
    ];
    const system: string[] = [];
    for (const file of files) {
      if (usesSystemAccess(await readFile(path.join(ROOT, file), "utf8"))) system.push(file);
    }
    expect(system.sort()).toEqual(Object.keys(SYSTEM_ALLOW_LIST).sort());
  });

  it("route handlers use core repositories only where listed", async () => {
    const uses: Record<string, string[]> = {};
    for (const file of await sourceFiles("src/app/api")) {
      const source = await readFile(path.join(ROOT, file), "utf8");
      const found = [...source.matchAll(/\bc\.repos\.(\w+)\.(\w+)/g)].map((m) => `${m[1]}.${m[2]}`);
      const bare = /\bc\.repos\b(?!\.\w+\.\w+)/.test(source.replace(/\bc\.repos\.\w+\.\w+/g, ""));
      if (bare) found.push("<unlisted c.repos access>");
      if (found.length) uses[file] = [...new Set(found)].sort();
    }
    expect(uses).toEqual(ROUTE_CORE_REPO_USES);
  });

  it("createTransactionRunner no longer exists", () => {
    expect("createTransactionRunner" in client).toBe(false);
  });
});

describe("workspace listing", () => {
  let c: Container;
  beforeAll(async () => {
    c = await createTestContainer();
  });
  afterAll(() => c.close());

  it("workspace listing returns only the caller's workspaces", async () => {
    const userA = await signUpUser("Lister A");
    const userB = await signUpUser("Lister B");
    const a = await createWorkspaceAs(userA, "Listing A");
    const b = await createWorkspaceAs(userB, "Listing B");

    const list = await call<{ workspaceId: string }[]>(listWorkspaces, { cookie: userA.cookie });
    expect(list.status).toBe(200);
    expect(list.body.data!.map((w) => w.workspaceId)).toEqual([a.id]);

    const mine = await call<{ workspaces: { id: string }[] }>(me, { cookie: userA.cookie });
    expect(mine.status).toBe(200);
    expect(mine.body.data!.workspaces.map((w) => w.id)).toEqual([a.id]);
    expect(mine.body.data!.workspaces.map((w) => w.id)).not.toContain(b.id);
  });
});
