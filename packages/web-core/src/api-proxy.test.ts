import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiProxy } from "./api-proxy";

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

let server: Server;
let base = "";
const seen: Seen[] = [];

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => resolve(data));
  });
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
    if (req.url?.startsWith("/api/v1/auth/signin")) {
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": ["ros_session=abc; Path=/; HttpOnly", "ros_guest=xyz; Path=/t"],
      });
      res.end(JSON.stringify({ data: { ok: true } }));
      return;
    }
    if (req.url?.startsWith("/api/v1/events")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: first\n\n");
      // The second chunk only arrives after a delay; the first must already be readable.
      setTimeout(() => {
        res.write("data: second\n\n");
        res.end();
      }, 1500);
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { echoed: body } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const ctx = { params: Promise.resolve({ path: [] as string[] }) };

describe("createApiProxy", () => {
  it("forwards cookies and returns all set-cookie headers", async () => {
    const proxy = createApiProxy({ apiInternalUrl: () => base });
    const res = await proxy.POST(
      new Request("http://console.local/api/v1/auth/signin?x=1", {
        method: "POST",
        headers: {
          cookie: "ros_session=old",
          "content-type": "application/json",
          origin: "http://console.local",
          "sec-fetch-site": "same-origin",
          "x-forwarded-for": "203.0.113.9",
          host: "console.local",
        },
        body: JSON.stringify({ email: "a@b.c" }),
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([
      "ros_session=abc; Path=/; HttpOnly",
      "ros_guest=xyz; Path=/t",
    ]);
    const last = seen.at(-1)!;
    expect(last.method).toBe("POST");
    expect(last.url).toBe("/api/v1/auth/signin?x=1");
    expect(last.headers.cookie).toBe("ros_session=old");
    expect(last.headers.origin).toBe("http://console.local");
    expect(last.headers["sec-fetch-site"]).toBe("same-origin");
    expect(last.headers["x-forwarded-for"]).toBe("203.0.113.9");
    expect(last.headers["x-forwarded-host"]).toBe("console.local");
  });

  it("streams SSE chunks without buffering", async () => {
    const proxy = createApiProxy({ apiInternalUrl: () => base });
    const started = Date.now();
    const res = await proxy.GET(new Request("http://console.local/api/v1/events"), ctx);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("data: first");
    expect(Date.now() - started).toBeLessThan(500);
    await reader.cancel();
  });

  it("passes request body and idempotency-key", async () => {
    const proxy = createApiProxy({ apiInternalUrl: () => base });
    const res = await proxy.POST(
      new Request("http://console.local/api/v1/orders", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "k-123" },
        body: JSON.stringify({ items: [1, 2] }),
      }),
      ctx,
    );
    expect(await res.json()).toEqual({ data: { echoed: JSON.stringify({ items: [1, 2] }) } });
    expect(seen.at(-1)!.headers["idempotency-key"]).toBe("k-123");
  });

  it("502 when upstream is down", async () => {
    const proxy = createApiProxy({ apiInternalUrl: () => "http://127.0.0.1:1" });
    const res = await proxy.GET(new Request("http://console.local/api/v1/health"), ctx);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      error: { code: "INTERNAL_ERROR", message: "API unavailable" },
    });
  });

  it("reads API_INTERNAL_URL at request time", async () => {
    let url = "http://127.0.0.1:1";
    const proxy = createApiProxy({ apiInternalUrl: () => url });
    expect((await proxy.GET(new Request("http://console.local/api/v1/health"), ctx)).status).toBe(
      502,
    );
    url = base;
    expect((await proxy.GET(new Request("http://console.local/api/v1/health"), ctx)).status).toBe(
      200,
    );
  });
});
