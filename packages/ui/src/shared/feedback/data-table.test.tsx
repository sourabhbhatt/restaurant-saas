import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataTable, type DataTableColumn } from "./data-table";
import { EmptyState } from "./empty-state";

type Order = { id: string; table: number; total: string };

const columns: DataTableColumn<Order>[] = [
  { id: "id", header: "Order", cell: (row) => row.id },
  { id: "table", header: "Table", cell: (row) => `T${row.table}` },
  { id: "total", header: "Total", cell: (row) => row.total, align: "right" },
];

const rows: Order[] = [
  { id: "A-101", table: 4, total: "$32.00" },
  { id: "A-102", table: 7, total: "$18.50" },
];

describe("DataTable", () => {
  it("renders headers and one row per item", () => {
    render(<DataTable aria-label="Orders" columns={columns} rows={rows} rowKey="id" />);

    const table = screen.getByRole("table", { name: "Orders" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Order", "Table", "Total"]);
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(2);
    expect(bodyRows[0]).toHaveTextContent("A-101T4$32.00");
  });

  it("shows skeleton rows and marks the table busy while loading", () => {
    const { container } = render(
      <DataTable columns={columns} rows={rows} rowKey="id" loading loadingRows={3} />,
    );

    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    expect(container.querySelectorAll("[data-slot='data-table-skeleton-row']")).toHaveLength(3);
    expect(screen.queryByText("A-101")).not.toBeInTheDocument();
  });

  it("shows the default empty state when there are no rows", () => {
    render(<DataTable columns={columns} rows={[]} rowKey="id" />);

    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("shows a custom empty state spanning all columns", () => {
    render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(row) => row.id}
        empty={<EmptyState title="No orders yet" />}
      />,
    );

    const cell = screen.getByText("No orders yet").closest("td");
    expect(cell).toHaveAttribute("colspan", "3");
  });

  it("does not show the empty state while loading", () => {
    render(<DataTable columns={columns} rows={[]} rowKey="id" loading />);

    expect(screen.queryByText("No results")).not.toBeInTheDocument();
  });

  it("calls onRowClick on click and on Enter for keyboard users", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        rowKey="id"
        onRowClick={onRowClick}
        rowLabel={(row) => `Open order ${row.id}`}
      />,
    );

    await user.click(screen.getByText("A-102"));
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1]);

    const firstRow = screen.getByRole("row", { name: "Open order A-101" });
    firstRow.focus();
    await user.keyboard("{Enter}");
    expect(onRowClick).toHaveBeenLastCalledWith(rows[0]);
    expect(onRowClick).toHaveBeenCalledTimes(2);
  });

  it("does not make rows focusable without onRowClick", () => {
    render(<DataTable columns={columns} rows={rows} rowKey="id" />);

    const bodyRows = screen.getAllByRole("row").slice(1);
    for (const row of bodyRows) expect(row).not.toHaveAttribute("tabindex");
  });
});
