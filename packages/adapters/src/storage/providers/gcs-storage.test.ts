import { describe, expect, it } from "vitest";

import { createGcsStorage } from "./gcs-storage";

interface Seen {
  url: string;
  method: string;
  auth: string | null;
  contentType: string | null;
}

function fakeGcs() {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  const seen: Seen[] = [];
  const fetchFake = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const method = init.method ?? "GET";
    seen.push({
      url: url.toString(),
      method,
      auth: headers.get("authorization"),
      contentType: headers.get("content-type"),
    });
    if (url.pathname.startsWith("/upload/")) {
      const name = url.searchParams.get("name")!;
      objects.set(name, {
        body: new Uint8Array(init.body as Uint8Array),
        contentType: headers.get("content-type")!,
      });
      return Response.json({ name });
    }
    const name = decodeURIComponent(url.pathname.split("/o/")[1]!);
    const found = objects.get(name);
    if (method === "DELETE") {
      if (!found) return new Response("", { status: 404 });
      objects.delete(name);
      return new Response(null, { status: 204 });
    }
    if (!found) return new Response("not found", { status: 404 });
    return new Response(found.body as BodyInit, { headers: { "content-type": found.contentType } });
  }) as unknown as typeof fetch;
  return { fetchFake, seen, objects };
}

describe("createGcsStorage", () => {
  it("uploads, reads back and deletes through the JSON API with a bearer token", async () => {
    const gcs = fakeGcs();
    const storage = createGcsStorage({
      bucket: "ros-uploads",
      accessToken: async () => "tok-1",
      fetch: gcs.fetchFake,
    });
    await storage.put({
      key: "ws/abc/logo.png",
      body: new Uint8Array([1, 2, 3]),
      contentType: "image/png",
    });
    expect(gcs.seen[0]).toMatchObject({
      method: "POST",
      auth: "Bearer tok-1",
      contentType: "image/png",
    });
    expect(gcs.seen[0]!.url).toBe(
      "https://storage.googleapis.com/upload/storage/v1/b/ros-uploads/o?uploadType=media&name=ws%2Fabc%2Flogo.png",
    );

    const got = await storage.get("ws/abc/logo.png");
    expect(got).toEqual({ body: new Uint8Array([1, 2, 3]), contentType: "image/png" });
    expect(gcs.seen[1]!.url).toBe(
      "https://storage.googleapis.com/storage/v1/b/ros-uploads/o/ws%2Fabc%2Flogo.png?alt=media",
    );

    await storage.delete("ws/abc/logo.png");
    expect(await storage.get("ws/abc/logo.png")).toBeNull();
    await expect(storage.delete("ws/abc/logo.png")).resolves.toBeUndefined();
    expect(storage.url("ws/abc/logo.png")).toBe("/api/v1/files/ws/abc/logo.png");
  });

  it("rejects unsafe keys before any request", async () => {
    const gcs = fakeGcs();
    const storage = createGcsStorage({
      bucket: "b",
      accessToken: async () => "t",
      fetch: gcs.fetchFake,
    });
    await expect(storage.get("../secret")).rejects.toThrow("Invalid object key");
    await expect(
      storage.put({ key: "a b", body: new Uint8Array(), contentType: "text/plain" }),
    ).rejects.toThrow("Invalid object key");
    expect(gcs.seen).toEqual([]);
  });

  it("surfaces provider errors with the status", async () => {
    const failing = (async () =>
      new Response("denied", { status: 403 })) as unknown as typeof fetch;
    const storage = createGcsStorage({ bucket: "b", accessToken: async () => "t", fetch: failing });
    await expect(storage.get("ws/a/b.png")).rejects.toThrow("GCS download failed: 403 denied");
  });

  it("takes the token from the metadata server and caches it", async () => {
    let tokenCalls = 0;
    const calls: string[] = [];
    const fetchFake = (async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("http://metadata.google.internal/")) {
        tokenCalls += 1;
        expect(new Headers(init.headers).get("metadata-flavor")).toBe("Google");
        return Response.json({ access_token: "meta-token", expires_in: 3600 });
      }
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer meta-token");
      return new Response("x", { headers: { "content-type": "text/plain" } });
    }) as unknown as typeof fetch;
    const storage = createGcsStorage({ bucket: "b", fetch: fetchFake });
    await storage.get("ws/a/1.png");
    await storage.get("ws/a/2.png");
    expect(tokenCalls).toBe(1);
    expect(calls).toHaveLength(3);
  });
});
