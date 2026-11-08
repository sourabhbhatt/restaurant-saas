import { sql } from "drizzle-orm";
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

  it("the runtime role (the API's login) sees no pending migrations after migrating", async () => {
    const handle = await connectPglite();
    try {
      await runMigrations(handle, "pglite");
      await handle.db.execute(sql`set role ros_runtime`);
      expect(await pendingMigrations(handle)).toEqual([]);
      const write = await handle.db
        .execute(sql`delete from drizzle.__drizzle_migrations`)
        .catch((error: unknown) => error as Error & { cause?: unknown });
      expect(String((write as { cause?: unknown }).cause ?? write)).toMatch(/permission denied/);
      await handle.db.execute(sql`reset role`);
    } finally {
      await handle.close();
    }
  });
});
