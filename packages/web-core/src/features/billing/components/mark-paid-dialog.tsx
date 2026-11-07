"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { BillDto } from "@ros/contracts/billing";
import { PAYMENT_METHODS, type PaymentMethod } from "@ros/domain/billing/payments";
import { Button } from "@ros/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ros/ui/ui/dialog";
import { FormField } from "@ros/ui/ui/form-field";
import { Input } from "@ros/ui/ui/input";
import { ApiError, errorMessage, newIdempotencyKey } from "@ros/api-client";

import { METHOD_LABEL, money } from "../format";
import { useRecordPayment } from "../queries";
import { NeedsConnectionNote, useIsOffline } from "../../offline";

/**
 * "Mark as paid": records one confirmed payment for the whole outstanding
 * balance. The server validates, writes the payment ledger and audit trail, and
 * decides the resulting status, so this is a shortcut for a full payment, not a
 * status flag. The idempotency key is kept per dialog opening so a retry after a
 * lost response cannot record the payment twice.
 */
export function MarkPaidDialog({
  bill,
  branchId,
  open,
  onOpenChange,
}: {
  bill: BillDto;
  branchId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const record = useRecordPayment(branchId);
  const offline = useIsOffline();
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);

  const close = (next: boolean) => {
    if (record.isPending) return;
    if (!next) {
      setError(null);
      setKey(newIdempotencyKey());
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark bill #{bill.billNumber} as paid</DialogTitle>
          <DialogDescription>
            Records a {money(bill.balanceDue, bill.currency)} payment for {bill.tableName}. Only
            confirm once the money has actually been received.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div role="radiogroup" aria-label="Payment method" className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((m) => (
              <Button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                variant={method === m ? "default" : "outline"}
                onClick={() => setMethod(m)}
                disabled={record.isPending}
              >
                {METHOD_LABEL[m]}
              </Button>
            ))}
          </div>
          {method !== "CASH" && (
            <FormField
              label="Reference (optional)"
              description="UPI transaction id, card slip number…"
            >
              <Input value={reference} onChange={(e) => setReference(e.target.value)} />
            </FormField>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <NeedsConnectionNote>Recording a payment needs a connection.</NeedsConnectionNote>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={record.isPending}>
            Cancel
          </Button>
          <Button
            disabled={record.isPending || offline}
            onClick={async () => {
              setError(null);
              try {
                const result = await record.mutateAsync({
                  billId: bill.id,
                  method,
                  amount: bill.balanceDue,
                  reference: reference.trim() || undefined,
                  idempotencyKey: key,
                });
                toast.success(
                  result.bill.paymentStatus === "PAID"
                    ? `Bill #${bill.billNumber} marked as paid`
                    : "Payment recorded",
                );
                setKey(newIdempotencyKey());
                onOpenChange(false);
              } catch (e) {
                // Keep the key: if the request actually reached the server, a retry replays it.
                setError(
                  e instanceof ApiError && e.isNetworkError
                    ? "Not recorded — check the connection and try again."
                    : errorMessage(e),
                );
              }
            }}
          >
            <CheckCircle2 aria-hidden />
            {record.isPending
              ? "Recording…"
              : `Confirm ${money(bill.balanceDue, bill.currency)} received`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
