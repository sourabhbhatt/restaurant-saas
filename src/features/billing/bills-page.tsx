"use client";

import { AlertCircle, Banknote, FileText, Receipt, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import type { BillListItemDto } from "@ros/contracts/billing-extra";
import { PAYMENT_STATUSES, type PaymentStatus } from "@ros/domain/billing/payments";
import {
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  StatCard,
  type DataTableColumn,
} from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { errorMessage } from "@/lib/api-client";
import { permissionChecker, useBranchContext } from "@/features/session/queries";

import { BillDetail, BillStatusBadges } from "./components/bill-detail";
import { formatDateTime, money, PAYMENT_STATUS_LABEL } from "./format";
import { useBill, useBills, usePaymentSummary, type BillListFilters } from "./queries";

const PAGE_SIZE = 20;

export function BillsPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const ctx = useBranchContext(branchId);
  const can = permissionChecker(ctx.data?.permissions);
  const timezone = ctx.data?.timezone;
  const [filters, setFilters] = useState<BillListFilters>({
    paymentStatus: "ALL",
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const bills = useBills(branchId, filters);
  const canSummary = can("payments.summary.view");
  const summary = usePaymentSummary(branchId, { from: filters.from, to: filters.to }, canSummary);

  const applyRange = (next: { from: string; to: string }) => {
    setRange(next);
    if (next.from && next.to && next.from > next.to) {
      setRangeError("The start date must be before the end date");
      return;
    }
    setRangeError(null);
    setFilters((f) => ({ ...f, from: next.from || undefined, to: next.to || undefined, page: 1 }));
  };

  const columns: DataTableColumn<BillListItemDto>[] = [
    {
      id: "number",
      header: "Bill",
      cell: (b) => <span className="font-medium">#{b.billNumber}</span>,
    },
    { id: "table", header: "Table", cell: (b) => b.tableName },
    {
      id: "issued",
      header: "Issued",
      cell: (b) => (
        <span className="text-muted-foreground">{formatDateTime(b.issuedAt, timezone)}</span>
      ),
      className: "max-md:hidden",
      headerClassName: "max-md:hidden",
    },
    { id: "status", header: "Status", cell: (b) => <BillStatusBadges bill={b} /> },
    {
      id: "total",
      header: "Total",
      align: "right",
      cell: (b) => <span className="tabular-nums">{money(b.grandTotal, b.currency)}</span>,
    },
    {
      id: "due",
      header: "Balance",
      align: "right",
      className: "max-sm:hidden",
      headerClassName: "max-sm:hidden",
      cell: (b) => (
        <span
          className={
            b.balanceDue > 0 && b.status !== "VOID"
              ? "font-medium text-destructive tabular-nums"
              : "text-muted-foreground tabular-nums"
          }
        >
          {money(b.balanceDue, b.currency)}
        </span>
      ),
    },
  ];

  const data = bills.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = filters.paymentStatus !== "ALL" || Boolean(filters.from || filters.to);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bills"
        description="Issued bills, payments and balances for this branch."
        actions={
          can("payments.record") ? (
            <Button asChild>
              <Link href={`/cashier/${branchId}`}>
                <Wallet aria-hidden /> Open cashier
              </Link>
            </Button>
          ) : undefined
        }
      />

      {canSummary && (
        <section aria-label="Payment summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summary.isError ? (
            <div className="sm:col-span-2 xl:col-span-4">
              <ErrorState
                size="compact"
                title="Couldn't load the summary"
                message={errorMessage(summary.error)}
                onRetry={() => void summary.refetch()}
              />
            </div>
          ) : (
            <>
              <StatCard
                label={filters.from || filters.to ? "Collected (range)" : "Collected today"}
                value={
                  summary.data ? money(summary.data.totalCollected, summary.data.currency) : "—"
                }
                icon={<Banknote />}
                loading={summary.isPending}
              />
              <StatCard
                label="Outstanding (open bills)"
                value={summary.data ? money(summary.data.outstanding, summary.data.currency) : "—"}
                icon={<AlertCircle />}
                loading={summary.isPending}
              />
              <StatCard
                label="Partially paid bills"
                value={summary.data?.partiallyPaidBills ?? "—"}
                icon={<Receipt />}
                loading={summary.isPending}
              />
              <StatCard
                label="Bills issued"
                value={summary.data?.billsIssued ?? "—"}
                icon={<FileText />}
                loading={summary.isPending}
              />
            </>
          )}
        </section>
      )}

      <FilterBar
        actions={
          filtered ? (
            <Button
              variant="ghost"
              onClick={() => {
                setRange({ from: "", to: "" });
                setRangeError(null);
                setFilters({ paymentStatus: "ALL", page: 1, pageSize: PAGE_SIZE });
              }}
            >
              Reset filters
            </Button>
          ) : undefined
        }
      >
        <Select
          value={filters.paymentStatus ?? "ALL"}
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, paymentStatus: v as PaymentStatus | "ALL", page: 1 }))
          }
        >
          <SelectTrigger aria-label="Payment status">
            <SelectValue placeholder="Payment status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All payment states</SelectItem>
            {PAYMENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {PAYMENT_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormField label="From" hideLabel error={rangeError ?? undefined} className="sm:w-44">
          <Input
            type="date"
            value={range.from}
            max={range.to || undefined}
            onChange={(e) => applyRange({ ...range, from: e.target.value })}
          />
        </FormField>
        <FormField label="To" hideLabel className="sm:w-44">
          <Input
            type="date"
            value={range.to}
            min={range.from || undefined}
            onChange={(e) => applyRange({ ...range, to: e.target.value })}
          />
        </FormField>
      </FilterBar>

      {bills.isError ? (
        <ErrorState
          title="Couldn't load bills"
          message={errorMessage(bills.error)}
          onRetry={() => void bills.refetch()}
          retrying={bills.isFetching}
        />
      ) : (
        <DataTable
          aria-label="Bills"
          columns={columns}
          rows={data?.items ?? []}
          rowKey="id"
          loading={bills.isPending}
          onRowClick={(b) => setSelectedId(b.id)}
          rowLabel={(b) => `Open bill ${b.billNumber} for ${b.tableName}`}
          empty={
            <EmptyState
              size="compact"
              icon={<Receipt />}
              title={filtered ? "No bills match these filters" : "No bills yet"}
              description={
                filtered
                  ? "Try another payment state or date range."
                  : "Bills appear here once a table is billed from the waiter or cashier console."
              }
            />
          }
        />
      )}
      {data && data.total > data.pageSize && (
        <Pagination
          page={filters.page}
          pageCount={pageCount}
          onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
          disabled={bills.isFetching}
        />
      )}
      <p className="sr-only" aria-live="polite">
        {data ? `${data.total} bills` : ""}
      </p>

      <Sheet open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-[min(100%-1rem,34rem)] sm:max-w-none">
          {selectedId && (
            <BillSheetBody billId={selectedId} branchId={branchId} timezone={timezone} can={can} />
          )}
        </SheetContent>
      </Sheet>
      <Toaster position="top-right" />
    </div>
  );
}

function BillSheetBody({
  billId,
  branchId,
  timezone,
  can,
}: {
  billId: string;
  branchId: string;
  timezone?: string;
  can: (permission: string) => boolean;
}) {
  const bill = useBill(billId);
  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {bill.data ? `Bill #${bill.data.billNumber} · ${bill.data.tableName}` : "Bill"}
        </SheetTitle>
        <SheetDescription>Items, totals and the payment ledger.</SheetDescription>
      </SheetHeader>
      <SheetBody className="overflow-y-auto">
        {bill.isPending && <LoadingState label="Loading bill…" className="py-10" />}
        {bill.isError && (
          <ErrorState
            size="compact"
            title="Couldn't load this bill"
            message={errorMessage(bill.error)}
            onRetry={() => void bill.refetch()}
          />
        )}
        {bill.data && (
          <BillDetail bill={bill.data} branchId={branchId} timezone={timezone} can={can} />
        )}
      </SheetBody>
    </>
  );
}
