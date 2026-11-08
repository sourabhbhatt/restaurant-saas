import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@serwist/turbopack", () => ({
  createSerwistRoute: () => ({
    GET: async () => new Response("bundled-at-runtime", { status: 200 }),
    generateStaticParams: async () => [{ path: "sw.js" }],
  }),
}));

const { serwistRoute, PREBUILT_SW_DIR } = await import("./serwist-route");

let dir: string;
const cwd = process.cwd();
afterEach(async () => {
  process.chdir(cwd);
  if (dir) await rm(dir, { recursive: true, force: true });
});
const ctx = (file: string) => ({ params: Promise.resolve({ path: file }) });

describe("serwistRoute", () => {
  it("serves the worker prebuilt at build time", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "sw-"));
    await mkdir(path.join(dir, PREBUILT_SW_DIR), { recursive: true });
    await writeFile(path.join(dir, PREBUILT_SW_DIR, "sw.js"), "prebuilt-worker");
    process.chdir(dir);
    const res = await serwistRoute().GET(new Request("http://x/serwist/sw.js"), ctx("sw.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(res.headers.get("service-worker-allowed")).toBe("/");
    expect(await res.text()).toBe("prebuilt-worker");
  });

  it("falls back to Serwist's bundler when nothing was prebuilt (next dev)", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "sw-"));
    process.chdir(dir);
    const res = await serwistRoute().GET(new Request("http://x/serwist/sw.js"), ctx("sw.js"));
    expect(await res.text()).toBe("bundled-at-runtime");
  });
});
