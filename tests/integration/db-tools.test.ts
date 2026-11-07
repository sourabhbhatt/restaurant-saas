import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
  dumpPgliteDir,
  NonEmptyTargetError,
  resolvePostgresUrl,
  spawnFromFile,
  spawnToFile,
  type DumpPgliteDeps,
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

  it("treats an existing drizzle schema as a non-empty target", async () => {
    const h = await connectPglite();
    handles.push(h);
    await h.db.execute(sql`create schema drizzle`);
    await expect(assertEmptyTarget(h.db)).rejects.toBeInstanceOf(NonEmptyTargetError);
  });

  it("never opens the original persistent dir; dumps the snapshot copy", async () => {
    const calls: string[] = [];
    const deps: DumpPgliteDeps = {
      snapshot: (async (dir: string) => {
        calls.push(`snapshot:${dir}`);
        return { dest: "/snap/copy", manifest: {}, totalRows: 0 };
      }) as unknown as DumpPgliteDeps["snapshot"],
      open: (async (dir: string) => {
        calls.push(`open:${dir}`);
        return { db: {}, pglite: {}, close: async () => void calls.push(`close:${dir}`) };
      }) as unknown as DumpPgliteDeps["open"],
      count: async () => ({ users: 1 }),
      dump: async () => "-- sql",
    };
    const out = await dumpPgliteDir("/data/pglite", deps);
    expect(out).toEqual({ sql: "-- sql", counts: { users: 1 } });
    expect(calls).toEqual(["snapshot:/data/pglite", "open:/snap/copy", "close:/snap/copy"]);
  });

  it("opens an in-memory dir directly without a snapshot", async () => {
    const calls: string[] = [];
    const deps = {
      snapshot: (async () => void calls.push("snapshot")) as unknown as DumpPgliteDeps["snapshot"],
      open: (async (dir?: string) => {
        calls.push(`open:${dir}`);
        return { db: {}, pglite: {}, close: async () => {} };
      }) as unknown as DumpPgliteDeps["open"],
      count: async () => ({}),
      dump: async () => "",
    };
    await dumpPgliteDir("memory://", deps);
    expect(calls).toEqual(["open:memory://"]);
  });

  it("resolvePostgresUrl uses DATABASE_URL, the dev default, or fails for non-postgres URLs", () => {
    expect(resolvePostgresUrl({ DATABASE_URL: "postgres://u:p@h/db" })).toBe("postgres://u:p@h/db");
    expect(resolvePostgresUrl({})).toContain("restaurantos_dev");
    expect(() => resolvePostgresUrl({ DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL/);
  });

  it("spawnToFile rejects when the output cannot be written", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dbt-"));
    await expect(
      spawnToFile("sh", ["-c", "echo hi"], path.join(dir, "missing", "out.dump")),
    ).rejects.toThrow();
    const ok = path.join(dir, "out.txt");
    await spawnToFile("sh", ["-c", "echo hi"], ok);
    expect(await readFile(ok, "utf8")).toBe("hi\n");
    await expect(spawnToFile("sh", ["-c", "exit 3"], path.join(dir, "x"))).rejects.toThrow(/3/);
  });

  it("spawnFromFile rejects when the input is missing or the process fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dbt-"));
    await expect(spawnFromFile("cat", [], path.join(dir, "nope"))).rejects.toThrow();
    const f = path.join(dir, "in.txt");
    await writeFile(f, "data");
    await expect(spawnFromFile("sh", ["-c", "cat >/dev/null"], f)).resolves.toBeUndefined();
    await expect(spawnFromFile("sh", ["-c", "exit 4"], f)).rejects.toThrow();
  });
});
