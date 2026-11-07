import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@ros/api-client";

import { LimitNotice, LimitNoticeView, PlanErrorNotice } from "./limit-notice";
import { makeEntitlements, makeUsage } from "./limits.fixtures";

const ws = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LimitNoticeView", () => {
  it("shows the usage meter below the limit, without a warning", () => {
    render(
      <LimitNoticeView
        workspaceId={ws}
        limitKey="maxRestaurants"
        entitlements={makeEntitlements()}
        usage={makeUsage({ restaurants: 2 })}
      />,
    );
    expect(screen.getByText("2 of 3 restaurants used on Pro")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "67");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("explains the limit and links to the subscription page at the limit", () => {
    render(
      <LimitNoticeView
        workspaceId={ws}
        limitKey="maxRestaurants"
        entitlements={makeEntitlements()}
        usage={makeUsage({ restaurants: 3 })}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Restaurants limit reached");
    expect(alert).toHaveTextContent(
      "You've reached the 3-restaurant limit of your plan. Upgrade to add more.",
    );
    expect(alert).toHaveTextContent("3 of 3 restaurants used on Pro");
    expect(screen.getByRole("link", { name: "Compare plans and upgrade" })).toHaveAttribute(
      "href",
      `/app/w/${ws}/subscription`,
    );
  });

  it("explains a grace-period block and offers renewal", () => {
    render(
      <LimitNoticeView
        workspaceId={ws}
        limitKey="maxBranches"
        entitlements={makeEntitlements({ phase: "GRACE", accessLevel: "LIMITED" })}
        usage={makeUsage({ branches: 1 })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your subscription is in its grace period. Renew your plan to add new branches.",
    );
    expect(screen.getByRole("link", { name: "Renew your plan" })).toBeInTheDocument();
  });

  it("has no progress bar for unlimited plans", () => {
    render(
      <LimitNoticeView
        workspaceId={ws}
        limitKey="maxTables"
        entitlements={makeEntitlements({
          planName: "Enterprise",
          limits: { ...makeEntitlements().limits, maxTables: null },
        })}
        usage={makeUsage({ tables: 12 })}
      />,
    );
    expect(screen.getByText("12 tables in use · unlimited on Enterprise")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
});

describe("LimitNotice (connected)", () => {
  it("loads entitlements for the workspace", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(new URL(url, "http://localhost").pathname).toBe(
        `/api/v1/workspaces/${ws}/entitlements`,
      );
      return new Response(
        JSON.stringify({
          data: { entitlements: makeEntitlements(), usage: makeUsage({ staff: 75 }) },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LimitNotice workspaceId={ws} limitKey="maxStaff" />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You've reached the 75-staff-member limit of your plan. Upgrade to add more.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("PlanErrorNotice", () => {
  it("shows the server's limit message inline with a link to plans", () => {
    const error = new ApiError({
      status: 402,
      code: "LIMIT_REACHED",
      message: "Your plan allows up to 3 restaurants",
    });
    render(<PlanErrorNotice error={error} workspaceId={ws} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your plan allows up to 3 restaurants. Upgrade to add more.",
    );
    expect(screen.getByRole("link", { name: "View plans" })).toHaveAttribute(
      "href",
      `/app/w/${ws}/subscription`,
    );
  });

  it("renders nothing for other errors", () => {
    const { container } = render(
      <PlanErrorNotice
        error={new ApiError({ status: 400, code: "VALIDATION_FAILED", message: "Bad" })}
        workspaceId={ws}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
