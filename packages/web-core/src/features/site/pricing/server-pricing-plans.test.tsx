import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parsePublicPlans } from "./plan-model";
import { PricingPlans } from "./pricing-plans";
import { loadPublicPlans } from "./server-plans";
import { PlansFromServer } from "./server-pricing-plans";

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("./server-plans", () => ({ loadPublicPlans: vi.fn() }));

const starter = {
  key: "starter",
  name: "Starter",
  description: "One restaurant",
  currency: "INR",
  monthlyPrice: 49900,
  annualPrice: 499000,
  isTrialEligible: true,
  limits: { maxRestaurants: 1, maxBranches: 1, storageMb: 2048, maxStaff: null },
  features: [{ key: "qr_ordering", label: "QR table ordering" }],
};

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(loadPublicPlans).mockReset();
});

describe("PlansFromServer (landing and pricing)", () => {
  it("renders the prices from the server when the API answers", async () => {
    vi.mocked(loadPublicPlans).mockResolvedValue({
      data: parsePublicPlans([starter]),
      fetchedAt: Date.now(),
    });
    const element = await PlansFromServer({ variant: "full" });
    expect(element.type).toBe(PricingPlans);
    renderWithQuery(element);
    expect(screen.getByRole("heading", { name: "Starter" })).toBeInTheDocument();
    expect(screen.getAllByText(/₹499/).length).toBeGreaterThan(0);
  });

  it("still renders, loading plans in the browser, when the API is unavailable", async () => {
    vi.mocked(loadPublicPlans).mockResolvedValue(null);
    // The browser request stays pending: the page shows the loading state, not an error.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const element = await PlansFromServer({ variant: "teaser" });
    expect(element.props).toMatchObject({ variant: "teaser", initial: undefined });
    renderWithQuery(element);
    expect(screen.getByRole("status", { name: "Loading plans" })).toBeInTheDocument();
  });
});
