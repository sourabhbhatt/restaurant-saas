import { describe, expect, it } from "vitest";

import { runObjectStorageContract } from "../object-storage.contract";
import { createS3Storage } from "./s3-storage";

const endpoint = process.env.S3_TEST_ENDPOINT;

if (endpoint) {
  describe("s3 storage", () => {
    runObjectStorageContract(async () =>
      createS3Storage({
        endpoint,
        region: "us-east-1",
        bucket: process.env.S3_TEST_BUCKET ?? "ros-test",
        accessKeyId: process.env.S3_TEST_ACCESS_KEY ?? "minio",
        secretAccessKey: process.env.S3_TEST_SECRET_KEY ?? "minio-dev-secret",
        forcePathStyle: true,
      }),
    );
  });
} else {
  describe("s3 storage", () => {
    it.skip("contract skipped: set S3_TEST_ENDPOINT (e.g. local MinIO) to run", () => {});
  });
}

describe("s3 storage url", () => {
  it("serves through the private file route", () => {
    const s = createS3Storage({
      region: "r",
      bucket: "b",
      accessKeyId: "a",
      secretAccessKey: "s",
      forcePathStyle: false,
    });
    expect(s.name).toBe("s3");
    expect(s.url("x/y.png")).toBe("/api/v1/files/x/y.png");
  });
});
