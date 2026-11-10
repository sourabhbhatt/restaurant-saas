import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The Recharts chunk cannot be fetched (deploy in progress, flaky network).
vi.mock("./charts-recharts", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("charts when the Recharts chunk fails to load", () => {
  it("shows a note in the chart's place instead of failing the page", async () => {
    // React logs caught render errors; keep the test output readable.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { TrendChart, DonutChart } = await import("./charts");
    render(
      <div>
        <p>Rest of the report</p>
        <TrendChart
          data={[{ d: "2026-11-01", v: 1 }]}
          xKey="d"
          series={[{ key: "v", label: "Orders", color: "red" }]}
          formatValue={String}
        />
        <DonutChart data={[{ name: "Cash", value: 3 }]} formatValue={String} />
      </div>,
    );
    expect(await screen.findAllByText("Chart unavailable")).toHaveLength(2);
    expect(screen.getByText("Rest of the report")).toBeVisible();
    // The donut's legend does not depend on the chunk.
    expect(screen.getByText("Cash")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Reload" })).toHaveLength(2);
  });
});
