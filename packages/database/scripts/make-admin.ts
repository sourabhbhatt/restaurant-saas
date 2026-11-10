/**
 * Grant Super Admin to an existing user.
 * Usage: pnpm db:make-admin you@example.com   (stop `pnpm dev` first when using PGlite)
 */
import { eq } from "drizzle-orm";

import { connectPglite, connectPostgresForMaintenance } from "../src/providers/postgres/client";
import { users } from "../src/providers/postgres/schema";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error("Usage: pnpm db:make-admin <email>");
  const pglite = process.env.DATABASE_PROVIDER === "pglite";
  const handle = pglite
    ? await connectPglite(process.env.PGLITE_DATA_DIR)
    : await connectPostgresForMaintenance(
        process.env.DATABASE_URL ??
          "postgres://restaurantos:restaurantos@localhost:5432/restaurantos_dev",
        2,
      );
  try {
    const rows = await handle.db
      .update(users)
      .set({ platformRole: "SUPER_ADMIN" })
      .where(eq(users.email, email))
      .returning({ id: users.id });
    if (rows.length === 0) throw new Error(`No user with email ${email}. Sign up first.`);
    console.log(`${email} is now a Super Admin.`);
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
