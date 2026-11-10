/**
 * Origins of the apps under test. Defaults are the dedicated E2E ports; set
 * E2E_PORT / E2E_OPS_PORT / E2E_ADMIN_PORT / E2E_API_PORT to move them, or
 * E2E_BASE_URL (+ E2E_OPS_URL, E2E_ADMIN_URL) to test running servers.
 */
const local = (envPort: string | undefined, fallback: number) =>
  `http://localhost:${Number(envPort ?? fallback)}`;

const external = Boolean(process.env.E2E_BASE_URL);

export const E2E_URLS = {
  external,
  console: process.env.E2E_BASE_URL ?? local(process.env.E2E_PORT, 3100),
  ops: process.env.E2E_OPS_URL ?? local(process.env.E2E_OPS_PORT, 3101),
  admin: process.env.E2E_ADMIN_URL ?? local(process.env.E2E_ADMIN_PORT, 3102),
  api: local(process.env.E2E_API_PORT, 4100),
};
