// Bundles an app's service worker after `next build` into .next/sw-prebuilt/
// (run from the app directory). The /serwist/[path] route serves these files,
// so production never bundles at request time.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(path.join(process.cwd(), "package.json"));
const { createSerwistRoute } = await import(
  pathToFileURL(require.resolve("@serwist/turbopack")).href
);

let revision;
try {
  revision = execSync("git rev-parse HEAD", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
} catch {
  revision = randomUUID();
}
const route = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
});
const out = path.join(process.cwd(), ".next", "sw-prebuilt");
await mkdir(out, { recursive: true });
for (const file of ["sw.js", "sw.js.map"]) {
  const res = await route.GET(new Request(`http://localhost/serwist/${file}`), {
    params: Promise.resolve({ path: file }),
  });
  if (!res.ok) throw new Error(`prebuild-sw: ${file} → ${res.status}`);
  const body = await res.text();
  if (file === "sw.js" && !body.includes("/_next/static/"))
    throw new Error("prebuild-sw: precache URLs are not /_next/static/ (wrong cwd?)");
  await writeFile(path.join(out, file), body);
}
console.log(`prebuild-sw: wrote ${path.relative(process.cwd(), out)}/sw.js`);
