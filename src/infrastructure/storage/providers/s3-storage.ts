import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { ObjectStorage } from "../interfaces/object-storage";

const SAFE_KEY = /^[a-zA-Z0-9/_.-]+$/;

export interface S3StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/**
 * S3-compatible storage (AWS S3, GCS interop, R2, MinIO). The bucket stays
 * private: url() points at the app's file route, which applies the CSP sandbox.
 */
export function createS3Storage(cfg: S3StorageConfig): ObjectStorage {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  const check = (key: string) => {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("Invalid object key");
    return key;
  };
  return {
    name: "s3",
    async put({ key, body, contentType }) {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: check(key),
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async get(key) {
      try {
        const res = await client.send(
          new GetObjectCommand({ Bucket: cfg.bucket, Key: check(key) }),
        );
        if (!res.Body) return null;
        return {
          body: await res.Body.transformToByteArray(),
          contentType: res.ContentType ?? "application/octet-stream",
        };
      } catch (error) {
        if ((error as { name?: string }).name === "NoSuchKey") return null;
        throw error;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: check(key) }));
    },
    url(key) {
      return `/api/v1/files/${key}`;
    },
  };
}
