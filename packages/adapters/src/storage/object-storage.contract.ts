import { expect, it } from "vitest";

import type { ObjectStorage } from "./interfaces/object-storage";

/** Behaviour every ObjectStorage adapter must satisfy. */
export function runObjectStorageContract(make: () => Promise<ObjectStorage>) {
  const key = () => `contract/${crypto.randomUUID()}.txt`;

  it("round-trips bytes and content type", async () => {
    const storage = await make();
    const k = key();
    await storage.put({
      key: k,
      body: new TextEncoder().encode("hello"),
      contentType: "text/plain",
    });
    const got = await storage.get(k);
    expect(got?.contentType).toBe("text/plain");
    expect(new TextDecoder().decode(got?.body)).toBe("hello");
    await storage.delete(k);
  });

  it("returns null for a missing key", async () => {
    const storage = await make();
    expect(await storage.get(key())).toBeNull();
  });

  it("deletes objects", async () => {
    const storage = await make();
    const k = key();
    await storage.put({
      key: k,
      body: new Uint8Array([1]),
      contentType: "application/octet-stream",
    });
    await storage.delete(k);
    expect(await storage.get(k)).toBeNull();
  });

  it("rejects keys containing ..", async () => {
    const storage = await make();
    await expect(
      storage.put({ key: "a/../b", body: new Uint8Array([1]), contentType: "text/plain" }),
    ).rejects.toThrow();
  });

  it("builds URLs through the file route", async () => {
    const storage = await make();
    expect(storage.url("a/b.png")).toBe("/api/v1/files/a/b.png");
  });
}
