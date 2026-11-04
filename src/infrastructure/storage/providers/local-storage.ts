import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ObjectStorage } from "../interfaces/object-storage";

const SAFE_KEY = /^[a-zA-Z0-9/_.-]+$/;

/**
 * Local filesystem storage for development and single-server deployments.
 * Files are served through /api/v1/files/<key>. Keys are validated so a key
 * can never escape the storage directory.
 */
export function createLocalStorage(rootDir: string): ObjectStorage {
  const root = path.resolve(rootDir);
  const resolve = (key: string) => {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("Invalid object key");
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid object key");
    return full;
  };
  return {
    name: "local",
    async put({ key, body, contentType }) {
      const file = resolve(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      await writeFile(`${file}.meta.json`, JSON.stringify({ contentType }));
    },
    async get(key) {
      try {
        const file = resolve(key);
        const [body, meta] = await Promise.all([
          readFile(file),
          readFile(`${file}.meta.json`, "utf8"),
        ]);
        return {
          body: new Uint8Array(body),
          contentType: (JSON.parse(meta) as { contentType: string }).contentType,
        };
      } catch {
        return null;
      }
    },
    async delete(key) {
      const file = resolve(key);
      await rm(file, { force: true });
      await rm(`${file}.meta.json`, { force: true });
    },
    url(key) {
      return `/api/v1/files/${key}`;
    },
  };
}
