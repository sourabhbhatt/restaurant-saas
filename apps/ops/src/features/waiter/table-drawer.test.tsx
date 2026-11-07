import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { BranchTableDto, SessionDetailDto } from "@ros/contracts/staff-ops";
import type { OutboxItem } from "@ros/web-core/features/offline";
import { staffOpsKeys } from "@ros/web-core/features/orders/keys";
import {
  countItems,
  initialSyncState,
  setSyncState,
  useSyncStore,
} from "@ros/web-core/features/offline/sync-store";

import { DEFAULT_APP_LINKS } from "@ros/web-core/app-links";

import { TableDrawer } from "./table-drawer";

const BRANCH = "b1";
const TABLE: BranchTableDto = {
  tableId: "t5",
  tableName: "T5",
  section: null,
  capacity: 4,
  isActive: true,
  status: "OCCUPIED",
  session: {
    id: "s1",
    status: "OPEN",
    openedAt: new Date().toISOString(),
    billRequestedAt: null,
    orderCounts: {},
    pendingCount: 0,
    activeCount: 1,
    billableSubtotal: 15800,
  },
  bill: null,
};

const unsent = (status: OutboxItem["status"], id: string): OutboxItem => ({
  id,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  userId: "u",
  scopeKey: "table:t5",
  kind: "orders.staff-create",
  label: "New order for T5 (1 item)",
  method: "POST",
  path: `/branches/${BRANCH}/orders`,
  idempotencyKey: `key_${id}_000000`,
  status,
  attempts: 1,
  nextAttemptAt: 0,
  lastError: status === "failed" ? "Item unavailable" : null,
  meta: { tableId: "t5", tableName: "T5", summary: "1× Masala Chai" },
});

function renderDrawer(items: OutboxItem[], table: BranchTableDto = TABLE) {
  setSyncState({ userId: "u", online: true, items, counts: countItems(items) });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const detail = {
    table: { id: "t5", name: "T5", section: null, capacity: 4 },
    session: TABLE.session,
    status: "OCCUPIED",
    orders: [],
    bill: null,
  } as unknown as SessionDetailDto;
  client.setQueryData(staffOpsKeys.session(BRANCH, "s1"), detail);
  return render(
    <QueryClientProvider client={client}>
      <TableDrawer
        branchId={BRANCH}
        table={table}
        currency="INR"
        can={() => true}
        now={Date.now()}
        pollInterval={0}
        onOpenChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  useSyncStore.setState(initialSyncState, true);
});

describe("TableDrawer bill generation", () => {
  it("is enabled online when every order reached the server", () => {
    renderDrawer([]);
    expect(screen.getByRole("button", { name: /Generate bill/ })).toBeEnabled();
  });

  it.each([["pending"], ["failed"], ["conflict"]] as const)(
    "is disabled with the reason while an unsent order is %s",
    (status) => {
      renderDrawer([unsent(status, "a"), unsent("pending", "b")]);
      expect(screen.getByRole("button", { name: /Generate bill/ })).toBeDisabled();
      expect(screen.getByText("2 orders not sent yet — resolve them first.")).toBeInTheDocument();
    },
  );
});

describe("TableDrawer links", () => {
  it("opens the bill on the console origin (the ops app has no /app/b routes)", () => {
    renderDrawer([], {
      ...TABLE,
      status: "BILL_GENERATED",
      bill: {
        billId: "bill1",
        billNumber: 7,
        status: "ISSUED",
        paymentStatus: "UNPAID",
        currency: "INR",
        grandTotal: 15800,
        balanceDue: 15800,
      },
    });
    expect(screen.getByRole("link", { name: /View bill/ })).toHaveAttribute(
      "href",
      `${DEFAULT_APP_LINKS.console}/app/b/${BRANCH}/bills`,
    );
  });
});
