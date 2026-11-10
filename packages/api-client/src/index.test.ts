import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, onApiSuccess, type ApiSuccess } from "./index";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("onApiSuccess", () => {
  it("reports accepted mutations only, without the query string", async () => {
    const seen: ApiSuccess[] = [];
    const off = onApiSuccess((s) => seen.push(s));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("fail")
          ? json(422, { error: { code: "VALIDATION_FAILED" } })
          : json(201, { data: { id: "w1" } }),
      ),
    );

    await api.post("/workspaces", { name: "A" }, { query: { token: "secret-from-query" } });
    await api.get("/workspaces", { page: 1 });
    await expect(api.post("/fail", {})).rejects.toBeInstanceOf(ApiError);
    off();
    await api.post("/workspaces", { name: "B" });

    expect(seen).toEqual([{ method: "POST", url: "/api/v1/workspaces", data: { id: "w1" } }]);
  });

  it("a throwing observer never fails the call", async () => {
    const off = onApiSuccess(() => {
      throw new Error("observer bug");
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(200, { data: { ok: true } })),
    );
    await expect(api.post("/auth/signin", {})).resolves.toEqual({ ok: true });
    off();
  });
});
