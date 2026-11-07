import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  connectPglite,
  runMigrations,
  type DatabaseHandle,
} from "@/infrastructure/database/providers/postgres/client";
import {
  assertEmptyTarget,
  diffCounts,
  dumpPgliteSql,
  NonEmptyTargetError,
} from "@/infrastructure/database/providers/postgres/db-tools";
import { countRows } from "@/infrastructure/database/providers/postgres/row-counts";

const handles: DatabaseHandle[] = [];
afterAll(async () => {
  for (const h of handles) await h.close();
});

async function migrated() {
  const h = await connectPglite();
  handles.push(h);
  await runMigrations(h, "pglite");
  return h;
}

describe("db tools", () => {
  it("restore refuses a non-empty target", async () => {
    const h = await migrated();
    await expect(assertEmptyTarget(h.db)).rejects.toBeInstanceOf(NonEmptyTargetError);
    const empty = await connectPglite();
    handles.push(empty);
    await expect(assertEmptyTarget(empty.db)).resolves.toBeUndefined();
  });

  it("verify detects a missing row", async () => {
    const h = await migrated();
    await h.db.execute(
      sql`insert into users (email, name) values ('a@example.com', 'A'), ('b@example.com', 'B')`,
    );
    const manifest = await countRows(h.db);
    expect(diffCounts(manifest, await countRows(h.db))).toEqual([]);
    await h.db.execute(sql`delete from users where email = 'b@example.com'`);
    expect(diffCounts(manifest, await countRows(h.db))).toEqual([
      { table: "users", expected: 2, actual: 1 },
    ]);
    expect(diffCounts({ gone: 1 }, {})).toEqual([{ table: "gone", expected: 1, actual: null }]);
  });

  it("dump→restore round-trip preserves counts", async () => {
    const src = await migrated();
    await src.db.execute(sql`insert into users (email, name) values ('a@example.com', 'A')`);
    const before = await countRows(src.db);
    const dump = await dumpPgliteSql(src.pglite!);

    const dest = await connectPglite();
    handles.push(dest);
    await dest.pglite!.exec(dump);
    // pg_dump clears search_path for the session that loads it; psql gets its own session.
    await dest.pglite!.exec("set search_path to public");
    expect(diffCounts(before, await countRows(dest.db))).toEqual([]);
    expect(before.users).toBe(1);
  });
});
