"use client";

import { Ban, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { BillDto, PaymentDto } from "@/contracts/billing";
import { StatusBadge } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { formatDateTime, METHOD_LABEL, money } from "../format";
import { useVoidPayment } from "../queries";
import { ReasonConfirmDialog } from "./reason-confirm-dialog";

interface Props {
  bill: BillDto;
  branchId: string;
  timezone?: string;
  canVoid: boolean;
}

/** Payment ledger of a bill, with void (reason required) for permitted users. */
export function PaymentHistory({ bill, branchId, timezone, canVoid }: Props) {
  const [target, setTarget] = useState<PaymentDto | null>(null);
  const voidPayment = useVoidPayment(branchId);
  const editable = bill.status !== "VOID";

  if (bill.payments.length === 0) {
    return <p className="text-sm text-muted-foreground">No payments recorded yet.</p>;
  }

  return (
    <>
      <ul className="flex flex-col divide-y rounded-lg border" aria-label="Payments">
        {bill.payments.map((p) => {
          const voided = p.status === "VOIDED";
          return (
            <li key={p.id} className="flex items-start gap-3 px-3 py-2.5">
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  p.kind === "REFUND" ? "bg-warning/20 text-warning-foreground" : "bg-primary/10 text-primary",
                )}
              >
                {p.kind === "REFUND" ? <Undo2 className="size-4" /> : METHOD_LABEL[p.method].slice(0, 2)}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn("text-sm font-medium", voided && "text-muted-foreground line-through")}>
                  {p.kind === "REFUND" ? "Refund" : "Payment"} · {METHOD_LABEL[p.method]}
                  {p.reference && (
                    <span className="font-normal text-muted-foreground"> · Ref {p.reference}</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(p.createdAt, timezone)}
                  {p.recordedByName ? ` · ${p.recordedByName}` : ""}
                  {p.tendered ? ` · Tendered ${money(p.tendered, bill.currency)}` : ""}
                </p>
                {p.note && <p className="text-xs text-muted-foreground">“{p.note}”</p>}
                {voided && (
                  <p className="text-xs text-destructive">Voided{p.voidReason ? `: ${p.voidReason}` : ""}</p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span
                  data-numeric
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    voided && "text-muted-foreground line-through",
                  )}
                >
                  {p.kind === "REFUND" ? "− " : ""}
                  {money(p.amount, bill.currency)}
                </span>
                {voided ? (
                  <StatusBadge tone="neutral">Voided</StatusBadge>
                ) : (
                  canVoid &&
                  editable && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setTarget(p)}
                      aria-label={`Void ${p.kind === "REFUND" ? "refund" : "payment"} of ${money(p.amount, bill.currency)}`}
                    >
                      <Ban aria-hidden /> Void
                    </Button>
                  )
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <ReasonConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={target?.kind === "REFUND" ? "Void this refund?" : "Void this payment?"}
        description={
          target
            ? `${money(target.amount, bill.currency)} by ${METHOD_LABEL[target.method]} will no longer count toward the bill. This is recorded in the audit log.`
            : undefined
        }
        confirmLabel="Void"
        pendingLabel="Voiding…"
        placeholder="e.g. Recorded on the wrong table"
        onConfirm={async (reason) => {
          if (!target) return;
          await voidPayment.mutateAsync({ paymentId: target.id, reason });
          toast.success(target.kind === "REFUND" ? "Refund voided" : "Payment voided");
        }}
      />
    </>
  );
}
