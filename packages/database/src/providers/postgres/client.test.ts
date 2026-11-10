import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { attachPoolErrorHandler, POSTGRES_POOL_OPTIONS } from "./client";

describe("attachPoolErrorHandler", () => {
  it("keeps an idle-client error from crashing the process and logs it without the connection string", () => {
    const pool = new EventEmitter();
    const log = vi.fn();
    attachPoolErrorHandler(pool, log);
    const err = Object.assign(new Error("Connection terminated unexpectedly"), { code: "57P01" });
    // Without a listener EventEmitter#emit("error") throws (Node: "Unhandled 'error' event").
    expect(() => pool.emit("error", err)).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
    const line = JSON.parse(log.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(line).toMatchObject({
      level: "warn",
      msg: "pg_pool_idle_client_error",
      code: "57P01",
      message: "Connection terminated unexpectedly",
    });
    expect(JSON.stringify(line)).not.toContain("postgres://");
  });
});

describe("POSTGRES_POOL_OPTIONS", () => {
  it("bounds connects, statements and idle clients so a stalled database cannot hold requests open", () => {
    expect(POSTGRES_POOL_OPTIONS.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(POSTGRES_POOL_OPTIONS.connectionTimeoutMillis).toBeLessThanOrEqual(10_000);
    expect(POSTGRES_POOL_OPTIONS.statement_timeout).toBeGreaterThan(0);
    expect(POSTGRES_POOL_OPTIONS.statement_timeout).toBeLessThanOrEqual(60_000);
    expect(POSTGRES_POOL_OPTIONS.idleTimeoutMillis).toBeGreaterThan(0);
  });
});
