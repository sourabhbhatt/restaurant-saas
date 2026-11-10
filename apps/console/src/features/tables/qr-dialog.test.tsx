import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TableDto, TableQrDto } from "@ros/contracts/tables";

import { QrDialog } from "./qr-dialog";

const table = {
  id: "t1",
  name: "T1",
  isActive: true,
  qr: { active: true, createdAt: "2026-11-10T08:00:00.000Z" },
} as unknown as TableDto;

const qr: TableQrDto = {
  tableId: "t1",
  tableName: "T1",
  url: "http://localhost:3000/t/abc",
  svg: "<svg xmlns='http://www.w3.org/2000/svg'/>",
  createdAt: "2026-11-10T08:00:00.000Z",
} as TableQrDto;

describe("QrDialog", () => {
  it("lets the owner open the table's guest menu in a new tab for a test order", async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    // Same key as useTableQr (["tables", "qr", tableId]).
    qc.setQueryData(["tables", "qr", "t1"], qr);
    render(
      <QueryClientProvider client={qc}>
        <QrDialog table={table} onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    const link = await screen.findByRole("link", { name: /Open guest menu/ });
    expect(link).toHaveAttribute("href", qr.url);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      screen.getByText(/place a test order exactly as a guest at T1 would/),
    ).toBeInTheDocument();
  });
});
