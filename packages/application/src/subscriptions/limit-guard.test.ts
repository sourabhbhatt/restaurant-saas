import { describe, expect, it } from "vitest";

import type { Entitlements } from "@ros/domain/subscriptions/entitlements";

import type { WorkspaceUsage } from "../ports/core-repositories";
import { reserveLimit } from "./limit-guard";

const MIB = 1024 * 1024;

function world(limits: Partial<Entitlements["limits"]>, usage: Partial<WorkspaceUsage>) {
  const calls: string[] = [];
  const entitlements = {
    limits: {
      maxRestaurants: null,
      maxBranches: null,
      maxStaff: null,
      maxTables: null,
      maxMenuItems: null,
      storageMb: null,
      ...limits,
    },
  } as Entitlements;
  const repos = {
    limits: {
      async lockWorkspace(id: string) {
        calls.push(`lock:${id}`);
      },
      async countUsage(): Promise<WorkspaceUsage> {
        calls.push("count");
        return {
          restaurants: 0,
          branches: 0,
          staff: 0,
          tables: 0,
          menuItems: 0,
          storageBytes: 0,
          ...usage,
        };
      },
    },
  };
  return { entitlements, repos, calls };
}

describe("reserveLimit", () => {
  it("locks the workspace before counting", async () => {
    const w = world({ maxTables: 3 }, { tables: 1 });
    await reserveLimit(w.repos, {
      entitlements: w.entitlements,
      workspaceId: "ws",
      key: "maxTables",
    });
    expect(w.calls).toEqual(["lock:ws", "count"]);
  });

  it("refuses the row that would exceed a count limit, allows the last slot", async () => {
    const w = world({ maxTables: 3 }, { tables: 2 });
    await expect(
      reserveLimit(w.repos, { entitlements: w.entitlements, workspaceId: "ws", key: "maxTables" }),
    ).resolves.toBeUndefined();
    const full = world({ maxTables: 3 }, { tables: 3 });
    await expect(
      reserveLimit(full.repos, {
        entitlements: full.entitlements,
        workspaceId: "ws",
        key: "maxTables",
      }),
    ).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    const bulk = world({ maxTables: 3 }, { tables: 1 });
    await expect(
      reserveLimit(bulk.repos, {
        entitlements: bulk.entitlements,
        workspaceId: "ws",
        key: "maxTables",
        adding: 3,
      }),
    ).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });

  it("skips unlimited keys without locking", async () => {
    const w = world({}, { tables: 999 });
    await reserveLimit(w.repos, {
      entitlements: w.entitlements,
      workspaceId: "ws",
      key: "maxTables",
    });
    expect(w.calls).toEqual([]);
  });

  it("reserves storage from the fresh byte count: ceil((fresh + file) / MiB) must not exceed the plan", async () => {
    // The race the pre-check cannot see: another upload just committed 1.9 MiB.
    const racy = world({ storageMb: 2 }, { storageBytes: 1.9 * MIB });
    await expect(
      reserveLimit(racy.repos, {
        entitlements: racy.entitlements,
        workspaceId: "ws",
        key: "storageMb",
        addingBytes: 0.2 * MIB,
      }),
    ).rejects.toMatchObject({ code: "LIMIT_REACHED" });
    // Exactly at the limit is allowed.
    const fits = world({ storageMb: 2 }, { storageBytes: 1.7 * MIB });
    await expect(
      reserveLimit(fits.repos, {
        entitlements: fits.entitlements,
        workspaceId: "ws",
        key: "storageMb",
        addingBytes: 0.3 * MIB,
      }),
    ).resolves.toBeUndefined();
    // One byte over the last MB is refused.
    const over = world({ storageMb: 2 }, { storageBytes: 2 * MIB });
    await expect(
      reserveLimit(over.repos, {
        entitlements: over.entitlements,
        workspaceId: "ws",
        key: "storageMb",
        addingBytes: 1,
      }),
    ).rejects.toMatchObject({ code: "LIMIT_REACHED" });
  });
});
