import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KitchenOrderDto } from "@ros/contracts/staff-ops";
import type * as OfflineModule from "@ros/web-core/features/offline";
import type { EnqueueInput, OutboxItem } from "@ros/web-core/features/offline";
import {
  countItems,
  initialSyncState,
  setSyncState,
  useSyncStore,
} from "@ros/web-core/features/offline/sync-store";

import { TicketCard } from "./ticket-card";

const { enqueued } = vi.hoisted(() => ({ enqueued: [] as EnqueueInput[] }));

function outboxItem(
  input: EnqueueInput,
  status: OutboxItem["status"],
  extra: Partial<OutboxItem> = {},
): OutboxItem {
  const now = Date.now();
  return {
    id: `item-${enqueued.length}-${status}`,
    createdAt: now,
    updatedAt: now,
    userId: "u",
    scopeKey: input.scopeKey,
    kind: input.kind,
    label: input.label,
    method: input.method,
    path: input.path,
    body: input.body,
    idempotencyKey: `key_${now}_${enqueued.length}`,
    status,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    meta: input.meta,
    expectedVersion: input.expectedVersion,
    versionField: input.versionField,
    chainVersion: input.chainVersion,
    ...extra,
  };
}

// The outbox (IndexedDB + engine) is replaced by the sync store it feeds.
vi.mock("@ros/web-core/features/offline", async (importOriginal) => {
  const actual = await importOriginal<typeof OfflineModule>();
  return {
    ...actual,
    enqueueMutation: vi.fn(async (input: EnqueueInput) => {
      enqueued.push(input);
      const item = outboxItem(input, "pending");
      const items = [...useSyncStore.getState().items, item];
      setSyncState({ items, counts: countItems(items) });
      return item;
    }),
  };
});

const ORDER = {
  id: "o1",
  orderNumber: 7,
  tableName: "T3",
  status: "PREPARING",
  priority: "NORMAL",
  version: 4,
  acceptedAt: new Date().toISOString(),
  readyAt: null,
  expectedPrepMinutes: 15,
  specialInstructions: null,
  items: [
    {
      id: "i1",
      itemName: "Masala Chai",
      quantity: 1,
      status: "PENDING",
      variantName: null,
      addons: [],
      notes: null,
    },
  ],
} as unknown as KitchenOrderDto;

function renderTicket(order: KitchenOrderDto = ORDER) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TicketCard
        branchId="b1"
        order={order}
        now={Date.now()}
        kitchenDelayMinutes={30}
        canUpdate
        fresh={false}
      />
    </QueryClientProvider>,
  );
}

const line = (name: RegExp) => screen.getByRole("button", { name });

beforeEach(() => {
  enqueued.length = 0;
  setSyncState({ userId: "u", online: true, items: [], counts: countItems([]) });
  // A direct request would bypass the per-order queue: none may happen.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("the kitchen ticket must not call the API directly");
    }),
  );
});

afterEach(() => {
  useSyncStore.setState(initialSyncState, true);
  vi.unstubAllGlobals();
});

describe("TicketCard (online)", () => {
  it("two quick taps queue both steps, in order, and never show the line as done", async () => {
    const user = userEvent.setup();
    renderTicket();
    await user.click(line(/^1 Masala Chai: pending\. Tap to mark preparing$/));
    // The first step is waiting: the next tap targets "ready", not "preparing" again.
    await user.click(line(/^1 Masala Chai: waiting to sync\. Tap to mark ready$/));
    expect(enqueued.map((e) => [(e.body as { status: string }).status, e.expectedVersion])).toEqual(
      [
        ["PREPARING", 4],
        ["READY", 4], // the engine rebases it on the version the first one returns
      ],
    );
    expect(enqueued.every((e) => e.chainVersion && e.scopeKey === "order:o1")).toBe(true);
    // Still waiting, not drawn as ready.
    expect(line(/^1 Masala Chai: waiting to sync\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /: ready\./ })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows what the server confirmed before the feed is refetched, and builds the next tap on it", async () => {
    const user = userEvent.setup();
    const confirmed = outboxItem(
      {
        kind: "kitchen.item-status",
        label: "#7 · 1× Masala Chai: mark ready",
        method: "PATCH",
        path: "/orders/o1/items/i1",
        body: { status: "READY" },
        scopeKey: "order:o1",
        expectedVersion: 5,
        versionField: "expectedVersion",
        chainVersion: true,
        meta: { orderId: "o1", itemId: "i1", status: "READY" },
      },
      "synced",
      {
        serverResponse: {
          id: "o1",
          version: 6,
          status: "PREPARING",
          items: [{ id: "i1", status: "READY" }],
        },
      },
    );
    act(() => setSyncState({ items: [confirmed], counts: countItems([confirmed]) }));
    renderTicket(); // the feed still says PENDING, version 4
    // Server-confirmed: ready. Toggling it back is built on version 6, not the feed's 4.
    await user.click(line(/^1 Masala Chai: ready\. Tap to mark preparing$/));
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({ body: { status: "PREPARING" }, expectedVersion: 6 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
