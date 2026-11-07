import { describe, expect, it, vi } from "vitest";

import { silentLogger } from "@ros/adapters/logging/console-logger";

import { selectRealtime, selectStorage } from "./container";
import { getEnv, type ServerEnv } from "@ros/application/config/env";

const parseEnv = (over: Partial<ServerEnv>): ServerEnv => ({ ...getEnv(), ...over });

describe("selectStorage", () => {
  it("startup fails loudly when s3 is selected without credentials", () => {
    const env = parseEnv({ STORAGE_PROVIDER: "s3" });
    expect(() => selectStorage(env, silentLogger)).toThrow(
      "S3 storage selected but S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are required",
    );
  });

  it("builds the s3 adapter when configured", () => {
    const env = parseEnv({
      STORAGE_PROVIDER: "s3",
      S3_BUCKET: "b",
      S3_REGION: "r",
      S3_ACCESS_KEY_ID: "a",
      S3_SECRET_ACCESS_KEY: "s",
    });
    expect(selectStorage(env, silentLogger).name).toBe("s3");
  });
});

describe("selectRealtime", () => {
  it("rejects the postgres bus on pglite", () => {
    const env = parseEnv({ REALTIME_PROVIDER: "postgres", DATABASE_PROVIDER: "pglite" });
    expect(() => selectRealtime(env, silentLogger)).toThrow("requires DATABASE_PROVIDER=postgres");
  });
});

describe("buildContainer config validation", () => {
  it("creates no realtime bus when storage config is invalid", async () => {
    const { buildContainer } = await import("./container");
    const postgresBus = await import("@ros/adapters/realtime/providers/postgres-bus");
    const spy = vi.spyOn(postgresBus, "createPostgresBus");
    const close = vi.fn(async () => {});
    try {
      await expect(
        buildContainer({
          env: parseEnv({ REALTIME_PROVIDER: "postgres", STORAGE_PROVIDER: "s3" }),
          database: { db: {} as never, close },
          syncSystemData: false,
          quiet: true,
        }),
      ).rejects.toThrow("S3 storage selected");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
