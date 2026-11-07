import { describe, expect, it } from "vitest";

import type { DatabaseHandle } from "./client";
import { migratePersistentPglite, type MigratePersistentDeps } from "./migrate-persistent";

function fakeDeps(pending: string[], calls: string[]): MigratePersistentDeps {
  const handle = (dir: string) =>
    ({ db: {}, close: async () => void calls.push(`close:${dir}`) }) as unknown as DatabaseHandle;
  return {
    exists: async (dir) => dir !== "/data/new",
    snapshot: (async (dir: string) => {
      calls.push(`snapshot:${dir}`);
      return { dest: "/snap/copy", manifest: {}, totalRows: 0 };
    }) as unknown as MigratePersistentDeps["snapshot"],
    open: async (dir) => {
      calls.push(`open:${dir}`);
      return handle(dir);
    },
    pending: async () => {
      calls.push("pending");
      return pending;
    },
    migrate: async () => void calls.push("migrate"),
  };
}

describe("migratePersistentPglite", () => {
  it("creates and migrates a directory that does not exist yet, without a snapshot", async () => {
    const calls: string[] = [];
    const result = await migratePersistentPglite("/data/new", undefined, fakeDeps([], calls));
    expect(calls).toEqual(["open:/data/new", "migrate", "close:/data/new"]);
    expect(result.snapshotPath).toBeNull();
  });

  it("snapshots before opening the original and checks pending on the copy", async () => {
    const calls: string[] = [];
    const result = await migratePersistentPglite(
      "/data/pglite",
      undefined,
      fakeDeps(["0002_x"], calls),
    );
    expect(calls).toEqual([
      "snapshot:/data/pglite",
      "open:/snap/copy",
      "pending",
      "close:/snap/copy",
      "open:/data/pglite",
      "migrate",
      "close:/data/pglite",
    ]);
    expect(result).toEqual({ snapshotPath: "/snap/copy", pending: ["0002_x"] });
  });

  it("never opens the original when nothing is pending", async () => {
    const calls: string[] = [];
    await migratePersistentPglite("/data/pglite", undefined, fakeDeps([], calls));
    expect(calls).not.toContain("open:/data/pglite");
    expect(calls).not.toContain("migrate");
  });

  it("does not open the original when the snapshot fails", async () => {
    const calls: string[] = [];
    const deps = fakeDeps(["0002_x"], calls);
    deps.snapshot = async () => {
      throw new Error("disk full");
    };
    await expect(migratePersistentPglite("/data/pglite", undefined, deps)).rejects.toThrow(
      "disk full",
    );
    expect(calls).toEqual([]);
  });
});
