import { describe, expect, it } from "vitest";

import { connectPglite, runMigrations } from "./client";
import { countRows, pendingMigrations, readJournalTags } from "./row-counts";
import { users } from "./schema";

describe("countRows", () => {
  it("returns every public table with exact counts", async () => {
    const handle = await connectPglite();
    try {
      await runMigrations(handle, "pglite");
      await handle.db.insert(users).values([
        { email: "a@example.com", name: "A" },
        { email: "b@example.com", name: "B" },
      ]);
      const counts = await countRows(handle.db);
      expect(counts.users).toBe(2);
      expect(Object.keys(counts)).toContain("workspaces");
      const keys = Object.keys(counts);
      expect(keys).toEqual([...keys].sort());
    } finally {
      await handle.close();
    }
  });
});

describe("pendingMigrations", () => {
  it("lists unapplied tags", async () => {
    const handle = await connectPglite();
    try {
      const tags = await readJournalTags();
      expect(tags.length).toBeGreaterThan(0);
      expect(await pendingMigrations(handle)).toEqual(tags);
      await runMigrations(handle, "pglite");
      expect(await pendingMigrations(handle)).toEqual([]);
    } finally {
      await handle.close();
    }
  });
});
