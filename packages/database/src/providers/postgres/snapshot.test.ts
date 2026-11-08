import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { connectPglite, runMigrations } from "./client";
import { pendingMigrations } from "./row-counts";
import { snapshotPglite } from "./snapshot";
import { users } from "./schema";

describe("snapshotPglite", () => {
  it("copies a data dir, records counts, and leaves the source untouched", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "snap-"));
    try {
      const src = path.join(root, "pglite");
      const handle = await connectPglite(src);
      await runMigrations(handle, "pglite");
      await handle.db.insert(users).values({ email: "a@example.com", name: "A" });
      await handle.close();

      const { dest, manifest, totalRows } = await snapshotPglite(src);
      expect(path.dirname(dest)).toBe(path.join(root, "snapshots"));
      expect(manifest.rowCounts.users).toBe(1);
      expect(totalRows).toBeGreaterThanOrEqual(1);
      expect(Object.keys(manifest.files).length).toBeGreaterThan(0);
      expect(
        JSON.parse(await readFile(path.join(dest, "manifest.json"), "utf8")).rowCounts,
      ).toEqual(manifest.rowCounts);

      const reopened = await connectPglite(src);
      expect(await pendingMigrations(reopened)).toEqual([]);
      await reopened.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000); // migrates and opens PGlite twice: slow on 2-core CI runners
});
