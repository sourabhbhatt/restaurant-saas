import type { ObjectStorage } from "../interfaces/object-storage";

const SAFE_KEY = /^[a-zA-Z0-9/_.-]+$/;
const API = "https://storage.googleapis.com";
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

export interface GcsStorageConfig {
  bucket: string;
  /** Overridable for tests and local runs; default: the metadata server, then GCS_ACCESS_TOKEN. */
  accessToken?: () => Promise<string>;
  fetch?: typeof fetch;
}

/**
 * Google Cloud Storage through its JSON API, authenticated as the runtime's
 * own service account (Cloud Run metadata server). No key files or HMAC keys:
 * projects that forbid service-account keys can still use it. The bucket stays
 * private; url() points at the app's file route like every other adapter.
 */
export function createGcsStorage(cfg: GcsStorageConfig): ObjectStorage {
  const doFetch = cfg.fetch ?? fetch;
  const token = cfg.accessToken ?? metadataToken(doFetch);
  const check = (key: string) => {
    if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("Invalid object key");
    return key;
  };
  const bucket = encodeURIComponent(cfg.bucket);
  const object = (key: string) => `${API}/storage/v1/b/${bucket}/o/${encodeURIComponent(key)}`;

  async function request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${await token()}`);
    return doFetch(url, { ...init, headers, cache: "no-store" });
  }

  async function fail(res: Response, what: string): Promise<never> {
    const text = await res.text().catch(() => "");
    throw new Error(`GCS ${what} failed: ${res.status} ${text.slice(0, 200)}`);
  }

  return {
    name: "gcs",
    async put({ key, body, contentType }) {
      const url = `${API}/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(check(key))}`;
      const res = await request(url, {
        method: "POST",
        headers: { "content-type": contentType },
        body: body as BodyInit,
      });
      if (!res.ok) await fail(res, "upload");
    },
    async get(key) {
      const res = await request(`${object(check(key))}?alt=media`);
      if (res.status === 404) return null;
      if (!res.ok) await fail(res, "download");
      return {
        body: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
      };
    },
    async delete(key) {
      const res = await request(object(check(key)), { method: "DELETE" });
      if (!res.ok && res.status !== 404) await fail(res, "delete");
    },
    url(key) {
      return `/api/v1/files/${key}`;
    },
  };
}

/** Caches the metadata-server token until shortly before it expires. */
function metadataToken(doFetch: typeof fetch): () => Promise<string> {
  let cached: { value: string; expiresAt: number } | null = null;
  return async () => {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
    try {
      const res = await doFetch(METADATA_TOKEN_URL, { headers: { "metadata-flavor": "Google" } });
      if (res.ok) {
        const body = (await res.json()) as { access_token: string; expires_in: number };
        cached = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
        return cached.value;
      }
    } catch {
      // Not on Google Cloud; fall through to the local override.
    }
    const local = process.env.GCS_ACCESS_TOKEN;
    if (local) return local;
    throw new Error("GCS storage: no metadata server and GCS_ACCESS_TOKEN is not set");
  };
}
