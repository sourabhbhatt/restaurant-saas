import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as me } from "@/app/api/v1/auth/me/route";
import { GET as listWorkspaces } from "@/app/api/v1/workspaces/route";
import * as client from "@/infrastructure/database/providers/postgres/client";
import type { Container } from "@/server/container";
import { createWorkspaceAs, signUpUser } from "@/test/fixtures";
import { call, createTestContainer } from "@/test/harness";

/**
 * Files allowed to reach the database as the connection owner, which bypasses
 * row-level security. Each entry states why it cannot use the tenant runner.
 */
const SYSTEM_ALLOW_LIST: Record<string, string> = {
  "src/server/container.ts":
    "core repos (identity, access, audit, idempotency, rate limit, outbox) and entitlements: authentication and the authorization lookup itself",
  "src/server/composition/platform.ts": "Super Admin console and scheduled jobs span workspaces",
  "src/server/composition/dev-mailbox.ts": "local/test mailbox reads the outbox",
  "src/server/composition/ordering.ts":
    "lookup runner: QR token and guest token resolve the workspace, then bind it",
  "src/server/composition/tenancy.ts":
    "lookup runner: invitation token resolves the workspace, then binds it",
  "src/server/composition/workspaces.ts":
    "bootstrap: the workspace does not exist yet when it is created",
  // Authorization lookups: an id from the URL is resolved to its owning branch/restaurant
  // before the access service can verify membership and bind the workspace.
  "src/server/composition/billing.ts": "lookup: bill/payment id → branch, then access.forBranch",
  "src/server/composition/menu.ts":
    "lookup: category/item id → restaurant, then access.forRestaurant",
  "src/server/composition/staff-ops.ts": "lookup: order id → branch, then access.forBranch",
  "src/server/composition/tables.ts": "lookup: table id → branch, then access.forBranch",
  "src/server/composition/analytics.ts":
    "Super Admin platform aggregates (route auth platform) count across workspaces",
  "src/server/composition/notifications.ts":
    "the actor's own notification writes span workspaces and workspace-less rows; filtered by user",
};

const ROOT = process.cwd();

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
    /createSystemRunner\(/.test(source) ||
    /\bc\.db\b/.test(withoutRunnerArgs) ||
    /Repository\(\s*db\s*[,)]/.test(source)
  );
}

describe("system runner allow-list", () => {
  it("createSystemRunner is only used in allow-listed files", async () => {
    const files = [...(await sourceFiles("src/server")), ...(await sourceFiles("src/app"))];
    const system: string[] = [];
    for (const file of files) {
      if (usesSystemAccess(await readFile(path.join(ROOT, file), "utf8"))) system.push(file);
    }
    expect(system.sort()).toEqual(Object.keys(SYSTEM_ALLOW_LIST).sort());
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
