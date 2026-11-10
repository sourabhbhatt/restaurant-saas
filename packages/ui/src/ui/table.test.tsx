import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Table, TableBody, TableCell, TableRow } from "./table";

function stubWidths(scrollWidth: number, clientWidth: number) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(clientWidth);
}

function renderTable() {
  return render(
    <Table aria-label="Orders">
      <TableBody>
        <TableRow>
          <TableCell>#1</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Table", () => {
  it("adds no tab stop when the table fits", () => {
    stubWidths(320, 320);
    const { container } = renderTable();
    const box = container.querySelector("[data-slot=table-container]")!;
    expect(box).not.toHaveAttribute("tabindex");
    expect(box).not.toHaveAttribute("role");
  });

  it("is a named, keyboard-scrollable region when it is wider than the screen", () => {
    stubWidths(640, 320);
    renderTable();
    const region = screen.getByRole("region", { name: "Orders (scrolls sideways)" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveAttribute("data-slot", "table-container");
  });
});
