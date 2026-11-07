import { connection } from "next/server";

import { DEFAULT_APP_LINKS, SetAppLinks } from "./app-links";

/**
 * Server component that reads CONSOLE_URL, OPS_URL and ADMIN_URL at request
 * time (never baked in at build) and hands them to the client store. Mount it
 * inside a Suspense boundary in each root layout; `connection()` keeps it out
 * of the static shell so the rest of the page can still prerender.
 */
export async function RuntimeAppLinks() {
  await connection();
  return (
    <SetAppLinks
      links={{
        console: process.env.CONSOLE_URL || DEFAULT_APP_LINKS.console,
        ops: process.env.OPS_URL || DEFAULT_APP_LINKS.ops,
        admin: process.env.ADMIN_URL || DEFAULT_APP_LINKS.admin,
      }}
    />
  );
}
