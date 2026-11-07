import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { OutboxItem } from "../db";
import { countItems, initialSyncState, setSyncState, useSyncStore } from "../sync-store";
import { OfflineBanner } from "./offline-banner";
import { SyncStatusIndicator } from "./sync-status-indicator";

const base: OutboxItem = {
  id: "1",
  createdAt: Date.now() - 120_000,
  updatedAt: Date.now(),
  userId: "u",
  scopeKey: "branch:b",
  kind: "menu.availability",
  label: "Mark Paneer Tikka unavailable",
  method: "PATCH",
  path: "/x",
  idempotencyKey: "k".repeat(16),
  status: "pending",
  attempts: 0,
  nextAttemptAt: 0,
  lastError: null,
};

function seed(items: OutboxItem[], online: boolean) {
  setSyncState({ userId: "u", online, items, counts: countItems(items) });
}

afterEach(() => {
  useSyncStore.setState(initialSyncState, true);
});

describe("SyncStatusIndicator", () => {
  it("shows Online when nothing is queued", () => {
    seed([], true);
    render(<SyncStatusIndicator />);
    expect(screen.getByRole("button", { name: /Sync status: Online/ })).toHaveTextContent("Online");
  });

  it("shows offline + waiting count and lists every item with actions", async () => {
    seed(
      [
        base,
        {
          ...base,
          id: "2",
          label: "Rename Dal Makhani",
          status: "conflict",
          lastError: "Changed by someone else",
          attempts: 1,
        },
      ],
      false,
    );
    render(<SyncStatusIndicator />);
    const pill = screen.getByRole("button", { name: /Sync status/ });
    expect(pill).toHaveTextContent("1 need attention");
    await userEvent.click(pill);
    expect(await screen.findByText("Mark Paneer Tikka unavailable")).toBeInTheDocument();
    expect(screen.getByText("Changed by someone else")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry with latest/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Discard/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Sync now/ })).toBeEnabled();

    // Discard asks for confirmation first.
    await userEvent.click(screen.getAllByRole("button", { name: /Discard/ })[0]!);
    expect(await screen.findByText("Discard this change?")).toBeInTheDocument();
  });
});

describe("SyncStatusIndicator conflicts without a server version", () => {
  it("offers only Discard for a chained change the server could not version", async () => {
    seed(
      [
        {
          ...base,
          id: "3",
          scopeKey: "order:o1",
          kind: "kitchen.transition",
          label: "#12 · mark ready",
          status: "conflict",
          chainVersion: true,
          versionField: "expectedVersion",
          lastError: "Cannot mark a cancelled order ready",
          lastErrorCode: "INVALID_STATE_TRANSITION",
          serverResponse: { code: "INVALID_STATE_TRANSITION", message: "x" },
        },
      ],
      true,
    );
    render(<SyncStatusIndicator />);
    await userEvent.click(screen.getByRole("button", { name: /Sync status/ }));
    expect(await screen.findByText("#12 · mark ready")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry with latest/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Discard/ })).toBeInTheDocument();
    expect(screen.getByText(/can no longer be applied/)).toBeInTheDocument();
  });
});

describe("OfflineBanner", () => {
  it("renders only when offline", () => {
    seed([base], true);
    const { rerender } = render(<OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();
    seed([base], false);
    rerender(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(/You're offline/);
    expect(screen.getByRole("status")).toHaveTextContent(/1 waiting/);
  });
});
