"use client";

import { ArrowLeft, BellRing, Clock, Receipt, RefreshCw, Utensils } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { BillListItemDto, SessionAwaitingBillDto } from "@/contracts/billing-extra";
import type { PaymentMethod } from "@/domain/billing/payments";
import { EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { BillDetail } from "@/features/billing/components/bill-detail";
import { GenerateBillPanel } from "@/features/billing/components/generate-bill-panel";
import {
  ageLabel,
  money,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
} from "@/features/billing/format";
import { useBill, useCashierQueue } from "@/features/billing/queries";
import { permissionChecker, useBranchContext } from "@/features/session/queries";

import { PaymentPanel } from "./payment-panel";

type Selection = { kind: "bill"; id: string } | { kind: "session"; id: string } | null;

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function CashierConsole() {
  const { branchId } = useParams<{ branchId: string }>();
  const ctx = useBranchContext(branchId);
  const queue = useCashierQueue(branchId);
  const [selection, setSelection] = useState<Selection>(null);
  const now = useNow();
  const can = permissionChecker(ctx.data?.permissions);
  const timezone = ctx.data?.timezone;

  const sessions = useMemo(() => queue.data?.sessions ?? [], [queue.data]);
  const bills = useMemo(
    () => [...(queue.data?.openBills ?? [])].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt)),
    [queue.data],
  );

  if (queue.isPending) return <LoadingState label="Loading cashier queue…" className="py-16" />;
  if (queue.isError) {
    return (
      <ErrorState
        title="Couldn't load the cashier queue"
        message={errorMessage(queue.error)}
        onRetry={() => void queue.refetch()}
        retrying={queue.isFetching}
      />
    );
  }

  const q = queue.data;
  const hasSelection = selection !== null;

  return (
    <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
      <aside
        className={cn("flex flex-col gap-4", hasSelection && "max-lg:hidden")}
        aria-label="Cashier queue"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Queue</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void queue.refetch()}
            disabled={queue.isFetching}
            aria-label="Refresh queue"
          >
            <RefreshCw className={cn(queue.isFetching && "motion-safe:animate-spin")} aria-hidden />
            Refresh
          </Button>
        </div>

        <QueueSection
          title="Awaiting bill"
          icon={<BellRing className="size-4" aria-hidden />}
          empty="No tables waiting for a bill."
          count={sessions.length}
        >
          {sessions.map((s) => (
            <SessionCard
              key={s.sessionId}
              session={s}
              currency={q.currency}
              now={now}
              selected={selection?.kind === "session" && selection.id === s.sessionId}
              onSelect={() => setSelection({ kind: "session", id: s.sessionId })}
            />
          ))}
        </QueueSection>

        <QueueSection
          title="Open bills"
          icon={<Receipt className="size-4" aria-hidden />}
          empty="No open bills. Issued bills appear here until the table is closed."
          count={bills.length}
        >
          {bills.map((b) => (
            <BillCard
              key={b.id}
              bill={b}
              now={now}
              selected={selection?.kind === "bill" && selection.id === b.id}
              onSelect={() => setSelection({ kind: "bill", id: b.id })}
            />
          ))}
        </QueueSection>
      </aside>

      <section
        className={cn("min-w-0", !hasSelection && "max-lg:hidden")}
        aria-label="Selected bill"
        aria-live="polite"
      >
        {hasSelection && (
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 lg:hidden"
            onClick={() => setSelection(null)}
          >
            <ArrowLeft aria-hidden /> Back to queue
          </Button>
        )}
        {selection === null && (
          <Card className="h-full justify-center p-6">
            <EmptyState
              icon={<Utensils />}
              title="Select a table or bill"
              description="Pick a table awaiting its bill to generate one, or an open bill to take payment."
            />
          </Card>
        )}
        {selection?.kind === "session" && (
          <SessionPane
            key={selection.id}
            branchId={branchId}
            session={sessions.find((s) => s.sessionId === selection.id) ?? null}
            canGenerate={can("bills.generate")}
            canDiscount={can("bills.discount")}
            onGenerated={(billId) => setSelection({ kind: "bill", id: billId })}
            onGone={() => setSelection(null)}
          />
        )}
        {selection?.kind === "bill" && (
          <BillPane
            key={selection.id}
            branchId={branchId}
            billId={selection.id}
            timezone={timezone}
            can={can}
            methods={q.config.paymentMethods}
            requireFullPayment={q.config.requireFullPaymentToClose}
            onClosed={() => setSelection(null)}
          />
        )}
      </section>
    </div>
  );
}

function QueueSection({
  title,
  icon,
  count,
  empty,
  children,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon} {title}
        <span className="rounded-full bg-muted px-2 text-xs tabular-nums">{count}</span>
      </h3>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
    </section>
  );
}

const cardClass = (selected: boolean) =>
  cn(
    "flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left shadow-xs outline-none hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:transition-colors",
    selected && "border-primary ring-2 ring-primary/30",
  );

function SessionCard({
  session,
  currency,
  now,
  selected,
  onSelect,
}: {
  session: SessionAwaitingBillDto;
  currency: string;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const since = session.billRequestedAt ?? session.openedAt;
  return (
    <li>
      <button
        type="button"
        className={cardClass(selected)}
        onClick={onSelect}
        aria-pressed={selected}
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold">
            {session.tableName}
            {session.status === "BILL_REQUESTED" && (
              <StatusBadge tone="warning" dot pulse>
                Bill requested
              </StatusBadge>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {session.billableOrderCount} order{session.billableOrderCount === 1 ? "" : "s"}
            {session.pendingOrderCount > 0 && ` · ${session.pendingOrderCount} pending approval`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span data-numeric className="font-semibold tabular-nums">
            {money(session.runningSubtotal, currency)}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" aria-hidden /> {ageLabel(since, now)}
          </span>
        </div>
      </button>
    </li>
  );
}

function BillCard({
  bill,
  now,
  selected,
  onSelect,
}: {
  bill: BillListItemDto;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={cardClass(selected)}
        onClick={onSelect}
        aria-pressed={selected}
      >
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {bill.tableName}{" "}
            <span className="font-normal text-muted-foreground">· #{bill.billNumber}</span>
          </p>
          <StatusBadge tone={PAYMENT_STATUS_TONE[bill.paymentStatus]} dot>
            {bill.paymentStatus === "PAID"
              ? "Paid · ready to close"
              : PAYMENT_STATUS_LABEL[bill.paymentStatus]}
          </StatusBadge>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span data-numeric className="font-semibold tabular-nums">
            {money(bill.balanceDue > 0 ? bill.balanceDue : bill.grandTotal, bill.currency)}
          </span>
          <span className="text-xs text-muted-foreground">
            {bill.balanceDue > 0 ? "due" : "total"} · {ageLabel(bill.issuedAt, now)}
          </span>
        </div>
      </button>
    </li>
  );
}

function SessionPane({
  branchId,
  session,
  canGenerate,
  canDiscount,
  onGenerated,
  onGone,
}: {
  branchId: string;
  session: SessionAwaitingBillDto | null;
  canGenerate: boolean;
  canDiscount: boolean;
  onGenerated: (billId: string) => void;
  onGone: () => void;
}) {
  if (!session) {
    return (
      <Card className="p-6">
        <EmptyState
          size="compact"
          title="This table is no longer waiting"
          description="It may have been billed or closed from another device."
          action={
            <Button variant="outline" onClick={onGone}>
              Back to queue
            </Button>
          }
        />
      </Card>
    );
  }
  return (
    <Card className="gap-4 p-4 sm:p-6">
      <div>
        <h2 className="text-xl font-semibold">{session.tableName}</h2>
        <p className="text-sm text-muted-foreground">
          Preview the bill, apply a discount, then generate it.
        </p>
      </div>
      {canGenerate ? (
        <GenerateBillPanel
          branchId={branchId}
          sessionId={session.sessionId}
          tableName={session.tableName}
          canDiscount={canDiscount}
          onGenerated={(bill) => onGenerated(bill.id)}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to generate bills.
        </p>
      )}
    </Card>
  );
}

function BillPane({
  branchId,
  billId,
  timezone,
  can,
  methods,
  requireFullPayment,
  onClosed,
}: {
  branchId: string;
  billId: string;
  timezone?: string;
  can: (permission: string) => boolean;
  methods: PaymentMethod[];
  requireFullPayment: boolean;
  onClosed: () => void;
}) {
  const bill = useBill(billId);
  if (bill.isPending) return <LoadingState label="Loading bill…" className="py-16" />;
  if (bill.isError) {
    return (
      <ErrorState
        title="Couldn't load this bill"
        message={errorMessage(bill.error)}
        onRetry={() => void bill.refetch()}
        retrying={bill.isFetching}
      />
    );
  }
  const b = bill.data;
  return (
    <Card className="gap-0 p-0">
      <div className="border-b px-4 py-4 sm:px-6">
        <h2 className="text-xl font-semibold">{b.tableName}</h2>
      </div>
      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[1fr_minmax(340px,440px)]">
        <BillDetail
          bill={b}
          branchId={branchId}
          timezone={timezone}
          can={can}
          requireFullPayment={requireFullPayment}
          size="large"
          onClosed={onClosed}
        />
        {can("payments.record") && b.status !== "VOID" && b.balanceDue > 0 && (
          <div className="flex flex-col gap-3 xl:sticky xl:top-24 xl:self-start">
            <h3 className="font-semibold">Take payment</h3>
            <PaymentPanel bill={b} branchId={branchId} methods={methods} />
          </div>
        )}
      </div>
    </Card>
  );
}
