/**
 * Revoke the sessions named in Netscape cookie-jar files (e.g. curl -c output).
 * Usage: pnpm db:revoke-cookie-jar <file...>   (uses DATABASE_PROVIDER / DATABASE_URL)
 * Prints counts only, never token values. Stop `pnpm dev` first when using PGlite.
 */
import { readFile } from "node:fs/promises";

import { revokeSessionsFromCookieJar } from "../src/infrastructure/auth/providers/revoke-cookie-jar";
import {
  connectPglite,
  connectPostgres,
} from "../src/infrastructure/database/providers/postgres/client";

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error("Usage: pnpm db:revoke-cookie-jar <file...>");
  const text = (await Promise.all(files.map((f) => readFile(f, "utf8")))).join("\n");
  const handle =
    process.env.DATABASE_PROVIDER === "pglite"
      ? await connectPglite(process.env.PGLITE_DATA_DIR)
      : await connectPostgres(
          process.env.DATABASE_URL ??
            "postgres://restaurantos:restaurantos@localhost:5432/restaurantos_dev",
          2,
        );
  try {
    const result = await revokeSessionsFromCookieJar(handle.db, text, new Date());
    console.log(JSON.stringify({ level: "info", msg: "cookie_jar_revoked", ...result }));
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
