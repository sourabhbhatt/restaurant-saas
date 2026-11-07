"use client";

import { create } from "zustand";

import { newIdempotencyKey } from "@ros/api-client";

import { customerDb, type StoredCartLine } from "./local-db";

/**
 * The guest's cart for one QR token. Persisted to IndexedDB (Dexie) on every
 * change so it survives reloads and offline periods. Prices here are display
 * estimates only — the server reprices every line when the order is placed.
 */

export type CartLine = StoredCartLine;

interface CartState {
  token: string | null;
  hydrated: boolean;
  lines: CartLine[];
  specialInstructions: string;
  pendingKey: string | null;
  hydrate(token: string): Promise<void>;
  add(line: Omit<CartLine, "id">): void;
  setQuantity(id: string, quantity: number): void;
  remove(id: string): void;
  setInstructions(value: string): void;
  /** Idempotency key for the current submission; stable across retries until success/edit. */
  submissionKey(): string;
  clear(): void;
}

const sameSelection = (a: Omit<CartLine, "id">, b: CartLine) =>
  a.menuItemId === b.menuItemId &&
  a.variantId === b.variantId &&
  a.notes.trim() === b.notes.trim() &&
  a.addonIds.length === b.addonIds.length &&
  [...a.addonIds].sort().join(",") === [...b.addonIds].sort().join(",");

export const useCartStore = create<CartState>()((set, get) => ({
  token: null,
  hydrated: false,
  lines: [],
  specialInstructions: "",
  pendingKey: null,

  async hydrate(token) {
    if (get().token === token && get().hydrated) return;
    set({ token, hydrated: false, lines: [], specialInstructions: "", pendingKey: null });
    const saved = await customerDb.loadCart(token);
    if (get().token !== token) return;
    set({
      hydrated: true,
      lines: saved?.lines ?? [],
      specialInstructions: saved?.specialInstructions ?? "",
      pendingKey: saved?.pendingKey ?? null,
    });
  },

  add(line) {
    set((s) => {
      const existing = s.lines.find((l) => sameSelection(line, l));
      const lines = existing
        ? s.lines.map((l) =>
            l === existing ? { ...l, quantity: Math.min(99, l.quantity + line.quantity) } : l,
          )
        : [...s.lines, { ...line, id: crypto.randomUUID() }];
      return { lines, pendingKey: null };
    });
  },

  setQuantity(id, quantity) {
    if (quantity < 1) return get().remove(id);
    set((s) => ({
      lines: s.lines.map((l) => (l.id === id ? { ...l, quantity: Math.min(99, quantity) } : l)),
      pendingKey: null,
    }));
  },

  remove(id) {
    set((s) => ({ lines: s.lines.filter((l) => l.id !== id), pendingKey: null }));
  },

  setInstructions(value) {
    set({ specialInstructions: value.slice(0, 500), pendingKey: null });
  },

  submissionKey() {
    const existing = get().pendingKey;
    if (existing) return existing;
    const key = newIdempotencyKey();
    set({ pendingKey: key });
    return key;
  },

  clear() {
    set({ lines: [], specialInstructions: "", pendingKey: null });
  },
}));

// Persist every change of the hydrated cart (fire-and-forget).
useCartStore.subscribe((s, prev) => {
  if (!s.token || !s.hydrated) return;
  if (
    s.lines === prev.lines &&
    s.specialInstructions === prev.specialInstructions &&
    s.pendingKey === prev.pendingKey
  ) {
    return;
  }
  void customerDb.saveCart({
    token: s.token,
    lines: s.lines,
    specialInstructions: s.specialInstructions,
    pendingKey: s.pendingKey,
    updatedAt: Date.now(),
  });
});

export function cartTotals(lines: readonly CartLine[]): { count: number; subtotal: number } {
  return lines.reduce(
    (acc, l) => ({
      count: acc.count + l.quantity,
      subtotal: acc.subtotal + l.unitPrice * l.quantity,
    }),
    { count: 0, subtotal: 0 },
  );
}
