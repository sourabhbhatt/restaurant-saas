"use client";

import { Ban, Printer, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { BillDto } from "@/contracts/billing";
import { StatusBadge } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import {
  BILL_STATUS_LABEL,
  BILL_STATUS_TONE,
  formatDateTime,
  money,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
} from "../format";
import { useVoidBill } from "../queries";
import { BillBreakdown, discountLabelFor } from "./bill-breakdown";
import { CloseTable } from "./close-table";
import { PaymentHistory } from "./payment-history";
import { ReasonConfirmDialog } from "./reason-confirm-dialog";
import { RefundDialog } from "./refund-dialog";

interface Props {
  bill: BillDto;
  branchId: string;
  timezone?: string;
  can: (permission: string) => boolean;
  /** Branch closure rule when known (client hint only; the server decides). */
  requireFullPayment?: boolean;
  size?: "default" | "large";
  /** Extra content between the totals and the payment history (e.g. the cashier payment panel). */
  children?: ReactNode;
  onClosed?: () => void;
}

export function BillStatusBadges({ bill }: { bill: Pick<BillDto, "status" | "paymentStatus"> }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {bill.status !== "ISSUED" && (
        <StatusBadge tone={BILL_STATUS_TONE[bill.status]}>
          {BILL_STATUS_LABEL[bill.status]}
        </StatusBadge>
      )}
      <StatusBadge tone={PAYMENT_STATUS_TONE[bill.paymentStatus]} dot>
        {PAYMENT_STATUS_LABEL[bill.paymentStatus]}
      </StatusBadge>
    </span>
  );
}

/** Full bill view: totals, payments, refunds, void, close and print actions (permission-gated). */
export function BillDetail({
  bill,
  branchId,
  timezone,
  can,
  requireFullPayment,
  size = "default",
  children,
  onClosed,
}: Props) {
  const [refundOpen, setRefundOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const voidBill = useVoidBill(branchId);
  const netPaid = bill.amountPaid - bill.amountRefunded;
  const canRefund = can("payments.refund") && bill.status !== "VOID" && netPaid > 0;
  const canVoidBill = can("bills.void") && bill.status === "ISSUED" && netPaid <= 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Bill #{bill.billNumber} · {formatDateTime(bill.issuedAt, timezone)}
            {bill.issuedByName ? ` · ${bill.issuedByName}` : ""}
          </p>
          <BillStatusBadges bill={bill} />
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/print/bills/${bill.id}`} target="_blank" rel="noopener">
            <Printer aria-hidden /> Print receipt
          </Link>
        </Button>
      </div>

      <BillBreakdown
        totals={bill}
        items={bill.items}
        currency={bill.currency}
        discountLabel={discountLabelFor(bill.discount, bill.currency)}
        paid={bill}
        size={size}
      />
      {bill.discount?.reason && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Discount reason: {bill.discount.reason}
        </p>
      )}

      {children}

      {can("sessions.manage") && (
        <CloseTable
          branchId={branchId}
          bill={bill}
          requireFullPayment={requireFullPayment}
          onClosed={onClosed}
        />
      )}

      <Separator />
      <section aria-labelledby={`payments-${bill.id}`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`payments-${bill.id}`} className="font-semibold">
            Payments
          </h3>
          <div className="flex gap-2">
            {canRefund && (
              <Button variant="outline" size="sm" onClick={() => setRefundOpen(true)}>
                <Undo2 aria-hidden /> Refund
              </Button>
            )}
            {canVoidBill && (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                onClick={() => setVoidOpen(true)}
              >
                <Ban aria-hidden /> Void bill
              </Button>
            )}
          </div>
        </div>
        <PaymentHistory
          bill={bill}
          branchId={branchId}
          timezone={timezone}
          canVoid={can("payments.refund")}
        />
      </section>

      {canRefund && (
        <RefundDialog
          bill={bill}
          branchId={branchId}
          open={refundOpen}
          onOpenChange={setRefundOpen}
        />
      )}
      <ReasonConfirmDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title={`Void bill #${bill.billNumber}?`}
        description={`The ${money(bill.grandTotal, bill.currency)} bill for ${bill.tableName} will be cancelled and the table can be billed again. Use this when orders changed after billing.`}
        confirmLabel="Void bill"
        pendingLabel="Voiding…"
        placeholder="e.g. Guests added a dessert after billing"
        onConfirm={async (reason) => {
          await voidBill.mutateAsync({ billId: bill.id, reason });
          toast.success(`Bill #${bill.billNumber} voided`);
        }}
      />
    </div>
  );
}
