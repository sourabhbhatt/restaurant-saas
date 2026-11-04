import { describe, expect, it } from "vitest";

import { localDateString, localDayRange, startOfLocalDay, timezoneOffsetMs } from "./local-dates";

describe("local dates", () => {
  it("computes offsets and local calendar dates", () => {
    const at = new Date("2026-11-04T20:00:00Z");
    expect(timezoneOffsetMs(at, "Asia/Kolkata")).toBe(5.5 * 3_600_000);
    expect(localDateString(at, "Asia/Kolkata")).toBe("2026-11-05");
    expect(localDateString(at, "America/New_York")).toBe("2026-11-04");
  });

  it("finds local midnight in UTC, including across DST changes", () => {
    expect(startOfLocalDay("2026-11-05", "Asia/Kolkata").toISOString()).toBe(
      "2026-11-04T18:30:00.000Z",
    );
    // New York: EDT (UTC-4) until 2026-11-01 02:00 local, then EST (UTC-5).
    expect(startOfLocalDay("2026-11-01", "America/New_York").toISOString()).toBe(
      "2026-11-01T04:00:00.000Z",
    );
    expect(startOfLocalDay("2026-11-02", "America/New_York").toISOString()).toBe(
      "2026-11-02T05:00:00.000Z",
    );
    expect(startOfLocalDay("2026-03-08", "UTC").toISOString()).toBe("2026-03-08T00:00:00.000Z");
  });

  it("resolves inclusive ranges with defaults and swapped bounds", () => {
    const now = new Date("2026-11-04T20:00:00Z");
    const today = localDayRange("Asia/Kolkata", now);
    expect(today.from).toBe("2026-11-05");
    expect(today.to).toBe("2026-11-05");
    expect(today.start.toISOString()).toBe("2026-11-04T18:30:00.000Z");
    expect(today.end.toISOString()).toBe("2026-11-05T18:30:00.000Z");

    const swapped = localDayRange("UTC", now, "2026-11-03", "2026-11-01");
    expect(swapped).toMatchObject({ from: "2026-11-01", to: "2026-11-03" });
    expect(swapped.end.toISOString()).toBe("2026-11-04T00:00:00.000Z");

    const single = localDayRange("UTC", now, "2026-10-31");
    expect(single).toMatchObject({ from: "2026-10-31", to: "2026-10-31" });
    // Month rollover.
    expect(single.end.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});
