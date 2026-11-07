import { afterEach, describe, expect, it, vi } from "vitest";

import { silentLogger } from "@/infrastructure/logging/console-logger";
import type { Logger } from "@/server/ports/observability";

import type { RealtimeEvent } from "../interfaces/realtime";
import { createPostgresBus } from "./postgres-bus";

const url = process.env.PG_TEST_URL;

const waitFor = async (fn: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe.skipIf(!url)("postgres realtime bus (set PG_TEST_URL to run)", () => {
  const buses: Array<{ close(): Promise<void> }> = [];
  const make = async (logger: Logger = silentLogger) => {
    const bus = createPostgresBus({ connectionString: url!, logger });
    buses.push(bus);
    await bus.ready;
    return bus;
  };
  afterEach(async () => {
    await Promise.all(buses.splice(0).map((b) => b.close()));
  });

  it("event published on bus A reaches a subscriber on bus B within 2 s", async () => {
    const [a, b] = [await make(), await make()];
    const got: RealtimeEvent[] = [];
    b.subscribe("branch:1", (e) => got.push(e));
    await a.publish("branch:1", { type: "order.created", data: { id: 7 } });
    await waitFor(() => got.length === 1);
    expect(got[0]).toMatchObject({ type: "order.created", data: { id: 7 } });
    expect(got[0]?.at).toBeTruthy();
  });

  it("unsubscribe stops delivery", async () => {
    const a = await make();
    const got: RealtimeEvent[] = [];
    const off = a.subscribe("branch:2", (e) => got.push(e));
    await a.publish("branch:2", { type: "x", data: {} });
    await waitFor(() => got.length === 1);
    off();
    await a.publish("branch:2", { type: "x", data: {} });
    await new Promise((r) => setTimeout(r, 300));
    expect(got).toHaveLength(1);
  });

  it("oversized payload is dropped and logged", async () => {
    const warn = vi.fn();
    const a = await make({ ...silentLogger, warn });
    const got: RealtimeEvent[] = [];
    a.subscribe("branch:3", (e) => got.push(e));
    await a.publish("branch:3", { type: "big", data: { blob: "x".repeat(8000) } });
    await new Promise((r) => setTimeout(r, 300));
    expect(got).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("realtime_payload_too_large", expect.anything());
  });
});

describe.skipIf(url)("postgres realtime bus", () => {
  it.skip("skipped: set PG_TEST_URL to run against Postgres", () => {});
});
