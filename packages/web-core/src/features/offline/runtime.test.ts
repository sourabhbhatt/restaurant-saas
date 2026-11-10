import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getOfflineDb } from "./db";
import {
  clearDeviceUserData,
  DEVICE_USER_WAIT_MS,
  enqueueMutation,
  PING_PATH,
  probeConnectivity,
  REPROBE_DELAYS_MS,
  resetSessionBackoff,
  setCurrentUser,
  startOfflineRuntime,
  stopOfflineRuntime,
  SYNC_INTERVAL_MS,
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

describe("reconnecting", () => {
  /** Ping answers in order: `false` is a network failure (the `online` event can fire before the network carries traffic). */
  function stubPing(answers: boolean[]) {
    const pings: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === PING_PATH) {
          pings.push(Date.now());
          if (!(answers.shift() ?? true)) throw new TypeError("Failed to fetch");
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify({ error: { code: "X", message: "x" } }), {
          status: 500,
        });
      }),
    );
    return pings;
  }
  const fastWindow = REPROBE_DELAYS_MS.reduce((a, b) => a + b, 0);

  it("probes again within seconds after a failed probe, not only on the 30 s interval", async () => {
    const pings = stubPing([false, false, true]);
    startOfflineRuntime(new QueryClient());
    await settle();
    expect(pings).toHaveLength(1);
    expect(useSyncStore.getState().online).toBe(false);

    await advance(REPROBE_DELAYS_MS[0]!);
    expect(pings).toHaveLength(2);
    expect(useSyncStore.getState().online).toBe(false);

    await advance(REPROBE_DELAYS_MS[1]!);
    expect(pings).toHaveLength(3);
    expect(useSyncStore.getState().online).toBe(true);

    await advance(SYNC_INTERVAL_MS - 1);
    expect(pings).toHaveLength(3); // reachable: no further fast probes
  });

  it("stops fast probing after a few attempts and leaves it to the interval", async () => {
    const pings = stubPing(Array<boolean>(20).fill(false));
    startOfflineRuntime(new QueryClient());
    await settle();
    await advance(fastWindow);
    expect(pings).toHaveLength(1 + REPROBE_DELAYS_MS.length);
    // setInterval is not faked here, so only the fast probes could add pings.
    await advance(SYNC_INTERVAL_MS);
    expect(pings).toHaveLength(1 + REPROBE_DELAYS_MS.length);
  });

  it("a new `online` event starts fast probing again", async () => {
    const pings = stubPing(Array<boolean>(20).fill(false));
    startOfflineRuntime(new QueryClient());
    await settle();
    await advance(fastWindow);
    const before = pings.length;
    window.dispatchEvent(new Event("online"));
    await settle();
    expect(pings).toHaveLength(before + 1);
    await advance(REPROBE_DELAYS_MS[0]!);
    expect(pings).toHaveLength(before + 2);
  });
});

describe("connectivity probe", () => {
  it("releases the ping response instead of holding the request open until its timeout", async () => {
    const cancel = vi.fn(async () => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = new ReadableStream({ cancel });
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    await expect(probeConnectivity()).resolves.toBe(true);
    await settle();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(useSyncStore.getState().online).toBe(true);
  });
});

describe("a change made before the runtime knows who is signed in", () => {
  // A fresh page: the kitchen screen can be tappable before /auth/me has answered.
  async function freshStart() {
    await clearDeviceUserData();
    startOfflineRuntime(new QueryClient());
    await settle();
  }

  it("waits for the signed-in user instead of dropping the change", async () => {
    await freshStart();
    const pending = enqueueMutation(change("Mark ready #1"));
    await advance(1_000);
    await setCurrentUser("user-2", true);
    const item = await pending;
    expect(item.userId).toBe("user-2");
    expect(await getOfflineDb()!.outbox.count()).toBe(1);
  });

  it("gives up after a few seconds with the sign-in message", async () => {
    await freshStart();
    const pending = enqueueMutation(change("Mark ready #1"));
    const outcome = expect(pending).rejects.toThrow("Sign in to save changes on this device.");
    await advance(DEVICE_USER_WAIT_MS);
    await outcome;
  });
});
