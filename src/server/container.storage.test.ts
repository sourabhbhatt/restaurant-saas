import { describe, expect, it } from "vitest";

import { silentLogger } from "@/infrastructure/logging/console-logger";

import { selectStorage } from "./container";
import { getEnv, type ServerEnv } from "./config/env";

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
