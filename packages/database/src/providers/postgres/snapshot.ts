import { createHash } from "node:crypto";
import { cp, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { sql } from "drizzle-orm";

import { connectPglite } from "./client";
import { countRows } from "./row-counts";

/** True for an on-disk PGlite directory (unset and `memory:` mean in-memory). */
export function isPersistentPgliteDir(dir: string | undefined): dir is string {
  return Boolean(dir) && !dir!.startsWith("memory:");
}

export interface SnapshotManifest {
  createdAt: string;
  sourceDir: string;
  pgVersion: string;
  rowCounts: Record<string, number>;
  files: Record<string, string>;
}

async function listFiles(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(root, rel), { withFileTypes: true })) {
    const next = path.join(rel, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(root, next)));
    else if (entry.isFile()) out.push(next);
  }
  return out.sort();
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Copies a PGlite data directory and records row counts and file hashes. Only
 * the copy is ever opened; the source is read as plain files.
 */
export async function snapshotPglite(
  sourceDir: string,
  snapshotsRoot = path.join(path.dirname(path.resolve(sourceDir)), "snapshots"),
  now = new Date(),
): Promise<{ dest: string; manifest: SnapshotManifest; totalRows: number }> {
  const dest = path.join(snapshotsRoot, `pglite-${stamp(now)}`);
  await cp(sourceDir, dest, { recursive: true, errorOnExist: true });

  const handle = await connectPglite(dest);
  let rowCounts: Record<string, number>;
  let pgVersion: string;
  try {
    rowCounts = await countRows(handle.db);
    const res = (await handle.db.execute(sql`select version() as v`)) as unknown as {
      rows: { v: string }[];
    };
    pgVersion = res.rows[0]?.v ?? "unknown";
  } finally {
    await handle.close();
  }

  const files: Record<string, string> = {};
  for (const rel of await listFiles(dest)) {
    if (rel === "manifest.json") continue;
    files[rel] = createHash("sha256")
      .update(await readFile(path.join(dest, rel)))
      .digest("hex");
  }
  const manifest: SnapshotManifest = {
    createdAt: now.toISOString(),
    sourceDir: path.resolve(sourceDir),
    pgVersion,
    rowCounts,
    files,
  };
  await writeFile(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);
  return { dest, manifest, totalRows };
}
