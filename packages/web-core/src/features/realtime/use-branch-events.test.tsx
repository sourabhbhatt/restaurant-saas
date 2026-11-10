import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { staffOpsKeys } from "../orders/keys";
import { INVALIDATE_COALESCE_MS, useBranchEvents } from "./use-branch-events";

/** Minimal EventSource double: tests dispatch named events by hand. */
class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>();
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data: unknown = {}) {
    const event = new MessageEvent(type, { data: JSON.stringify({ data }) });
    for (const fn of this.listeners.get(type) ?? []) fn(event);
  }
  close() {}
}

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", FakeEventSource);
  queryClient = new QueryClient();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeEventSource.last = null;
});

describe("useBranchEvents", () => {
  it("refetches the branch queries once for a burst of events", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const onEvent = vi.fn();
    renderHook(() => useBranchEvents("b1", { onEvent }), { wrapper });
    const source = FakeEventSource.last!;

    for (const type of ["order.created", "order.accepted", "order.ready", "order.served"])
      source.emit(type, { orderId: "o1" });

    // Every event still reaches the screen's handler (sounds, alerts) immediately.
    expect(onEvent).toHaveBeenCalledTimes(4);
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: staffOpsKeys.branch("b1") });

    // A later event starts a new window.
    source.emit("order.cancelled");
    vi.advanceTimersByTime(INVALIDATE_COALESCE_MS);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("drops a pending refetch when the screen unmounts", () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const { unmount } = renderHook(() => useBranchEvents("b1"), { wrapper });
    FakeEventSource.last!.emit("order.created");
    unmount();
    vi.advanceTimersByTime(INVALIDATE_COALESCE_MS * 2);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
