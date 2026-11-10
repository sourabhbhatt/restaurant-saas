import { describe, expect, it } from "vitest";

import { notificationHref, notificationUrl } from "./deep-links";

const ws = "11111111-1111-4111-8111-111111111111";
const br = "22222222-2222-4222-8222-222222222222";

describe("notificationHref", () => {
  it("links orders to the waiter screen of the branch", () => {
    expect(
      notificationHref({
        type: "order.created",
        data: { orderId: "x" },
        branchId: br,
        workspaceId: ws,
      }),
    ).toBe(`/waiter/${br}`);
    expect(
      notificationHref({
        type: "order.ready",
        data: { branchId: br },
        branchId: null,
        workspaceId: ws,
      }),
    ).toBe(`/waiter/${br}`);
  });

  it("links billing to the cashier screen", () => {
    expect(
      notificationHref({ type: "bill.requested", data: {}, branchId: br, workspaceId: ws }),
    ).toBe(`/cashier/${br}`);
  });

  it("links subscription and trial notices to the workspace subscription page", () => {
    expect(
      notificationHref({ type: "trial.reminder", data: {}, branchId: null, workspaceId: ws }),
    ).toBe(`/app/w/${ws}/subscription`);
  });

  it("never builds links from non-uuid data", () => {
    expect(
      notificationHref({
        type: "order.created",
        data: { branchId: "//evil.example" },
        branchId: null,
        workspaceId: null,
      }),
    ).toBeNull();
    expect(
      notificationHref({
        type: "platform.announcement",
        data: {},
        branchId: null,
        workspaceId: null,
      }),
    ).toBeNull();
  });
});

describe("notificationUrl", () => {
  const links = {
    console: "https://console.example.in",
    ops: "https://ops.example.in/",
    admin: "https://admin.example.in",
  };

  it("sends waiter and cashier links to the ops app (they are not console pages)", () => {
    expect(
      notificationUrl(
        { type: "order.created", data: { orderId: "x" }, branchId: br, workspaceId: ws },
        links,
      ),
    ).toBe(`https://ops.example.in/waiter/${br}`);
    expect(
      notificationUrl({ type: "bill.requested", data: {}, branchId: br, workspaceId: ws }, links),
    ).toBe(`https://ops.example.in/cashier/${br}`);
  });

  it("keeps dashboard links on the console", () => {
    expect(
      notificationUrl({ type: "trial.reminder", data: {}, branchId: null, workspaceId: ws }, links),
    ).toBe(`https://console.example.in/app/w/${ws}/subscription`);
    expect(
      notificationUrl(
        { type: "platform.announcement", data: {}, branchId: null, workspaceId: null },
        links,
      ),
    ).toBeNull();
  });
});
