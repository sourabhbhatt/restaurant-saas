import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  attachPoolErrorHandler,
  MAINTENANCE_POOL_OPTIONS,
  poolConfigFor,
  POSTGRES_POOL_OPTIONS,
} from "./client";

describe("pool configuration per caller", () => {
  it("the API runtime gets the statement timeout, maintenance does not", () => {
    const runtime = poolConfigFor("postgres://x/y", 5, POSTGRES_POOL_OPTIONS);
    expect(runtime.statement_timeout).toBe(30_000);
    expect(runtime.connectionTimeoutMillis).toBe(5_000);
    const maintenance = poolConfigFor("postgres://x/y", 2, MAINTENANCE_POOL_OPTIONS);
    expect(maintenance.statement_timeout).toBeUndefined();
    expect(maintenance.connectionTimeoutMillis).toBe(5_000);
    expect(maintenance.max).toBe(2);
  });

  it("every script (migrate job, dump/restore/verify, seed, admin) uses the maintenance connector", () => {
    const scriptsDir = path.resolve(import.meta.dirname, "../../../scripts");
    const files = readdirSync(scriptsDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(scriptsDir, f));
    files.push(path.resolve(import.meta.dirname, "../../../../../apps/api/scripts/seed.ts"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const plain = source.match(/\bconnectPostgres\s*\(/g) ?? [];
      expect(plain, `${path.basename(file)} must use connectPostgresForMaintenance`).toEqual([]);
    }
    expect(files.length).toBeGreaterThanOrEqual(7);
  });
});

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
