import { describe, expect, it, vi } from "vitest";

import type { LogFields, Logger } from "@ros/application/ports/observability";
import type { ServerTrackingEvent } from "@ros/contracts/tracking-events";

import { createGa4MeasurementProtocolTracking } from "./ga4-measurement-protocol";
import { createMemoryServerTracking } from "./memory";

const SECRET = "mp-secret-for-tests";
const PAID: ServerTrackingEvent = {
  name: "payment_succeeded",
  params: {
    plan_key: "pro",
    billing_cycle: "monthly",
    value: 1499,
    currency: "INR",
    renewal: false,
  },
};
/** A browser that opted in, without a readable session (e.g. a webhook-confirmed payment). */
const CONSENTED = { analytics: { clientId: "1234567890.1700000000", sessionId: null } };

function recordingLogger() {
  const lines: { level: string; message: string; fields?: LogFields }[] = [];
  const at =
    (level: string) =>
    (message: string, fields?: LogFields): void => {
      lines.push({ level, message, fields });
    };
  const logger: Logger = {
    debug: at("debug"),
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    child: () => logger,
  };
  return { logger, lines };
}

function setup(fetchImpl: typeof fetch, over: { timeoutMs?: number } = {}) {
  const { logger, lines } = recordingLogger();
  const tracking = createGa4MeasurementProtocolTracking({
    measurementId: "G-TEST123456",
    apiSecret: SECRET,
    logger,
    fetch: fetchImpl,
    now: () => new Date("2026-11-10T10:00:00.000Z"),
    ...over,
  });
  return { tracking, lines };
}

describe("GA4 Measurement Protocol adapter", () => {
  it("posts one event with the consented browser's ids and no personal data", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const { tracking } = setup(fetchMock);

    tracking.track(PAID, {
      analytics: { clientId: "1234567890.1700000000", sessionId: "1700000500" },
    });
    await tracking.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    const u = new URL(String(url));
    expect(`${u.origin}${u.pathname}`).toBe("https://www.google-analytics.com/mp/collect");
    expect(u.searchParams.get("measurement_id")).toBe("G-TEST123456");
    expect(u.searchParams.get("api_secret")).toBe(SECRET);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      client_id: "1234567890.1700000000",
      timestamp_micros: Date.parse("2026-11-10T10:00:00.000Z") * 1000,
      consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
      events: [
        {
          name: "payment_succeeded",
          params: {
            plan_key: "pro",
            billing_cycle: "monthly",
            value: 1499,
            currency: "INR",
            renewal: false,
            content_group: "product",
            session_id: "1700000500",
            // With session_id, GA4 needs an engagement time to place the event in the session.
            engagement_time_msec: 1,
          },
        },
      ],
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("user_id");
    expect(body).not.toHaveProperty("user_data");
    expect(body).not.toHaveProperty("ip_override");
  });

  it("sends nothing without a consented browser's ids: no anonymous server events", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const { tracking, lines } = setup(fetchMock);

    tracking.track(PAID, { analytics: null } as never);
    tracking.track(PAID, {} as never);
    await tracking.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(lines.map((l) => l.fields)).toEqual([
      { event: "payment_succeeded", reason: "no_consent" },
      { event: "payment_succeeded", reason: "no_consent" },
    ]);
  });

  it("omits session_id and engagement time when the session is unknown", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const { tracking } = setup(fetchMock);
    tracking.track(PAID, CONSENTED);
    await tracking.flush();
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)) as {
      client_id: string;
      events: { params: object }[];
    };
    expect(body.client_id).toBe("1234567890.1700000000");
    expect(body.events[0]!.params).not.toHaveProperty("session_id");
    expect(body.events[0]!.params).not.toHaveProperty("engagement_time_msec");
  });

  it("refuses an event outside the catalog or carrying personal data, without sending", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const { tracking, lines } = setup(fetchMock);

    tracking.track(
      {
        name: "payment_succeeded",
        // Simulates a caller bypassing the types.
        params: { ...PAID.params, email: "owner@demo.local" } as never,
      },
      CONSENTED,
    );
    tracking.track({ name: "purchase", params: {} } as never, CONSENTED);
    await tracking.flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(lines.filter((l) => l.message === "server_tracking_event_rejected")).toEqual([
      {
        level: "warn",
        message: "server_tracking_event_rejected",
        fields: { event: "payment_succeeded", reason: "invalid_params" },
      },
      {
        level: "warn",
        message: "server_tracking_event_rejected",
        fields: { event: "purchase", reason: "unknown_event" },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain("owner@demo.local");
  });

  it("returns at once and gives up after the timeout, logging without the secret", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const { tracking, lines } = setup(fetchMock, { timeoutMs: 25 });

    const started = performance.now();
    tracking.track(PAID, CONSENTED);
    expect(performance.now() - started).toBeLessThan(25);
    await tracking.flush();

    expect(lines).toEqual([
      {
        level: "warn",
        message: "server_tracking_send_failed",
        fields: { event: "payment_succeeded", reason: "timeout" },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain(SECRET);
  });

  it("never throws into the caller when the network fails or GA answers an error", async () => {
    const failing = vi.fn<typeof fetch>(async () => {
      throw new TypeError(
        `fetch failed for https://www.google-analytics.com/?api_secret=${SECRET}`,
      );
    });
    const first = setup(failing);
    expect(() => first.tracking.track(PAID, CONSENTED)).not.toThrow();
    await first.tracking.flush();
    expect(first.lines).toEqual([
      {
        level: "warn",
        message: "server_tracking_send_failed",
        fields: { event: "payment_succeeded", reason: "network" },
      },
    ]);
    expect(JSON.stringify(first.lines)).not.toContain(SECRET);

    const erroring = setup(vi.fn<typeof fetch>(async () => new Response("no", { status: 500 })));
    erroring.tracking.track(PAID, CONSENTED);
    await erroring.tracking.flush();
    expect(erroring.lines[0]?.fields).toEqual({ event: "payment_succeeded", status: 500 });
  });
});

describe("memory adapter", () => {
  it("records valid events and the reason for refused ones", () => {
    const memory = createMemoryServerTracking();
    memory.track(PAID, { analytics: { clientId: "1.1700000000", sessionId: null } });
    memory.track({ name: "payment_succeeded", params: { plan_key: "x@y.co" } as never }, CONSENTED);
    memory.track(PAID, { analytics: null } as never);

    expect(memory.events).toEqual([
      { event: PAID, context: { analytics: { clientId: "1.1700000000", sessionId: null } } },
    ]);
    expect(memory.rejected).toEqual([
      { name: "payment_succeeded", reason: "invalid_params" },
      { name: "payment_succeeded", reason: "no_consent" },
    ]);
    memory.clear();
    expect(memory.events).toHaveLength(0);
  });
});
