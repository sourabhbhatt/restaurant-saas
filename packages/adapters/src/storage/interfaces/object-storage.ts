/**
 * Object storage port. The database stores object keys only; URLs are always
 * produced by the adapter, so moving buckets/providers never rewrites data.
 */
export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
}

export interface ObjectStorage {
  readonly name: string;
  put(input: PutObjectInput): Promise<void>;
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /** Public (or signed) URL for reading the object. */
  url(key: string): string;
}
