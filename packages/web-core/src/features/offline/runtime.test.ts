import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOfflineDb } from "./db";
import {
  clearDeviceUserData,
  enqueueMutation,
  resetSessionBackoff,
  setCurrentUser,
  stopOfflineRuntime,
} from "./runtime";
import { initialSyncState, setSyncState, useSyncStore } from "./sync-store";

/** Let IndexedDB (fake-indexeddb, scheduled with setImmediate) and promises settle. */
async function settle() {
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

let meStatus: number;
let meCalls: number;
let sent: string[];

const change = (label: string) => ({
  kind: "kitchen.transition",
  label,
  method: "POST" as const,
  path: "/orders/o1/transition",
  body: { action: "start" },
  scopeKey: "order:o1",
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.spyOn(Math, "random").mockReturnValue(0.5); // no jitter in backoffDelay
  meStatus = 500;
  meCalls = 0;
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/v1/auth/me") {
        meCalls += 1;
        return new Response(JSON.stringify({ error: { code: "X", message: "x" } }), {
          status: meStatus,
        });
      }
      sent.push(url);
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
    }),
  );
  setSyncState(initialSyncState);
  await clearDeviceUserData(); // module state from the previous test
  // Restored from cache (not confirmed): items are queued, the server is asked before sending.
  await setCurrentUser("user-1", false);
  await settle();
});

afterEach(async () => {
  stopOfflineRuntime();
  resetSessionBackoff();
  await getOfflineDb()!.outbox.clear();
  useSyncStore.setState(initialSyncState, true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

describe("offline runtime session check", () => {
  it("backs off after a failed session check: next wake after 1 s, then 2 s, then 4 s", async () => {
    await enqueueMutation(change("Start #1"));
    await settle();
    expect(meCalls).toBe(1);

    await advance(999);
    expect(meCalls).toBe(1); // not the old 250 ms loop
    await advance(1);
    expect(meCalls).toBe(2);

    await advance(1_999);
    expect(meCalls).toBe(2);
    await advance(1);
    expect(meCalls).toBe(3);

    await advance(3_999);
    expect(meCalls).toBe(3);
    await advance(1);
    expect(meCalls).toBe(4);
    expect(sent).toEqual([]);
  });

  it("schedules no wake-up while the session expired (401)", async () => {
    meStatus = 401;
    await enqueueMutation(change("Start #1"));
    await settle();
    expect(meCalls).toBe(1);
    expect(useSyncStore.getState().authRequired).toBe(true);

    await advance(10 * 60_000);
    expect(meCalls).toBe(1);
  });
});

describe("sign-out", () => {
  it("resets the device user so the next account sees and queues nothing under it", async () => {
    await enqueueMutation(change("Start #1"));
    await advance(50); // liveQuery notifies on a timer
    expect(useSyncStore.getState().items).toHaveLength(1);

    await clearDeviceUserData();
    await advance(50);
    const state = useSyncStore.getState();
    expect(state.userId).toBeNull();
    expect(state.items).toEqual([]);
    expect(state.counts.pending).toBe(0);
    // Kept on the device (hidden, counted), never discarded.
    expect(state.otherUserPending).toBe(1);
    expect(await getOfflineDb()!.outbox.count()).toBe(1);
    await expect(enqueueMutation(change("Start #2"))).rejects.toThrow(/Sign in/);
  });
});
