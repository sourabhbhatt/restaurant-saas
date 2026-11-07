import Dexie, { type EntityTable } from "dexie";

import type { PublicQrDto } from "@ros/contracts/ordering";

/**
 * Customer-device storage (IndexedDB via Dexie), keyed per QR token so two
 * tables scanned on one phone never mix. Holds:
 * - the cart (survives reloads and offline periods; never "sent" offline),
 * - the last menu response (so a previously loaded menu browses offline),
 * - which table session this device joined from that QR.
 *
 * Every access is best-effort: private mode / blocked storage must never
 * break ordering, so failures resolve to null/no-op.
 */

export interface StoredCartLine {
  id: string;
  menuItemId: string;
  variantId: string | null;
  addonIds: string[];
  quantity: number;
  notes: string;
  /** Display snapshot from the menu at add time (the server reprices). */
  name: string;
  variantName: string | null;
  addonNames: string[];
  unitPrice: number;
  dietary: string | null;
  imageUrl: string | null;
}

export interface CartRecord {
  token: string;
  lines: StoredCartLine[];
  specialInstructions: string;
  /** Idempotency key of the in-flight/failed submission; cleared on success or cart edit. */
  pendingKey: string | null;
  updatedAt: number;
}

interface MenuRecord {
  token: string;
  data: PublicQrDto;
  savedAt: number;
}

interface JoinedRecord {
  token: string;
  sessionId: string;
  joinedAt: number;
}

type CustomerDb = Dexie & {
  carts: EntityTable<CartRecord, "token">;
  menus: EntityTable<MenuRecord, "token">;
  joined: EntityTable<JoinedRecord, "token">;
};

let instance: CustomerDb | null = null;

function db(): CustomerDb | null {
  if (typeof indexedDB === "undefined") return null;
  if (!instance) {
    const d = new Dexie("restaurantos-customer") as CustomerDb;
    d.version(1).stores({ carts: "token", menus: "token", joined: "token" });
    instance = d;
  }
  return instance;
}

async function safe<T>(work: (d: CustomerDb) => Promise<T>, fallback: T): Promise<T> {
  const d = db();
  if (!d) return fallback;
  try {
    return await work(d);
  } catch {
    return fallback;
  }
}

export const customerDb = {
  loadCart: (token: string) => safe((d) => d.carts.get(token).then((r) => r ?? null), null),
  saveCart: (record: CartRecord) =>
    safe((d) => d.carts.put(record).then(() => undefined), undefined),
  loadMenu: (token: string) => safe((d) => d.menus.get(token).then((r) => r ?? null), null),
  saveMenu: (token: string, data: PublicQrDto) =>
    safe((d) => d.menus.put({ token, data, savedAt: Date.now() }).then(() => undefined), undefined),
  deleteMenu: (token: string) => safe((d) => d.menus.delete(token), undefined),
  loadJoined: (token: string) => safe((d) => d.joined.get(token).then((r) => r ?? null), null),
  saveJoined: (token: string, sessionId: string) =>
    safe(
      (d) => d.joined.put({ token, sessionId, joinedAt: Date.now() }).then(() => undefined),
      undefined,
    ),
};
