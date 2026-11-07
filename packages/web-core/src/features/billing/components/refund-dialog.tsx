"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { refundSchema, type BillDto } from "@ros/contracts/billing";
import { PAYMENT_METHODS, type PaymentMethod } from "@ros/domain/billing/payments";
import { Alert, AlertDescription } from "@ros/ui/ui/alert";
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
import { Spinner } from "@ros/ui/ui/spinner";
import { Textarea } from "@ros/ui/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@ros/ui/ui/toggle-group";
import { ApiError, applyFieldErrors, errorMessage, newIdempotencyKey } from "@ros/api-client";

import { METHOD_LABEL, money, parseMajor, toMajorText } from "../format";
import { useRefund } from "../queries";
import { NeedsConnectionNote, useIsOffline } from "../../offline";

const refundFormSchema = z.object({
  method: refundSchema.shape.method,
  amount: z
    .string()
    .trim()
    .refine((v) => (parseMajor(v) ?? 0) > 0, "Enter an amount greater than zero"),
  reference: refundSchema.shape.reference,
  note: refundSchema.shape.note,
});
type RefundForm = z.input<typeof refundFormSchema>;

interface Props {
  bill: BillDto;
  branchId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RefundDialog({ bill, branchId, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Remount per open so the idempotency key and form reset each attempt. */}
        {open && <RefundBody bill={bill} branchId={branchId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RefundBody({
  bill,
  branchId,
  onDone,
}: {
  bill: BillDto;
  branchId: string;
  onDone: () => void;
}) {
  const netPaid = bill.amountPaid - bill.amountRefunded;
  const usedMethods = [
    ...new Set(
      bill.payments
        .filter((p) => p.kind === "PAYMENT" && p.status === "CONFIRMED")
        .map((p) => p.method),
    ),
  ];
  const methods: PaymentMethod[] = usedMethods.length ? usedMethods : [...PAYMENT_METHODS];
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [networkError, setNetworkError] = useState(false);
  const refund = useRefund(branchId);
  const offline = useIsOffline();

  const form = useForm<RefundForm>({
    resolver: zodResolver(refundFormSchema),
    defaultValues: {
      method: methods[0] ?? "CASH",
      amount: toMajorText(Math.max(netPaid, 0)),
      reference: "",
      note: "",
    },
  });
  const { register, handleSubmit, setError, control, formState } = form;

  const submit = handleSubmit(async (values) => {
    setNetworkError(false);
    const amount = parseMajor(values.amount) ?? 0;
    if (amount > netPaid) {
      setError("amount", { message: `You can refund at most ${money(netPaid, bill.currency)}` });
      return;
    }
    try {
      const result = await refund.mutateAsync({
        billId: bill.id,
        method: values.method,
        amount,
        reference: values.reference || undefined,
        note: values.note,
        idempotencyKey,
      });
      toast.success(`Refunded ${money(result.payment.amount, bill.currency)}`);
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.isNetworkError) {
        setNetworkError(true);
        return;
      }
      if (!applyFieldErrors(error, setError, ["method", "amount", "reference", "note"])) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Refund on bill #{bill.billNumber}</DialogTitle>
        <DialogDescription>
          Paid so far: {money(netPaid, bill.currency)}. Refunds are recorded in the ledger and audit
          log.
        </DialogDescription>
      </DialogHeader>
      {networkError && (
        <Alert variant="destructive">
          <AlertDescription>Not recorded — check connection and retry.</AlertDescription>
        </Alert>
      )}
      <Controller
        control={control}
        name="method"
        render={({ field, fieldState }) => (
          <FormField label="Refund method" error={fieldState.error?.message} required>
            {(controlProps) => (
              <ToggleGroup
                type="single"
                variant="outline"
                value={field.value}
                onValueChange={(v) => v && field.onChange(v)}
                id={controlProps.id}
                aria-label="Refund method"
                aria-invalid={controlProps["aria-invalid"]}
                aria-describedby={controlProps["aria-describedby"]}
                className="w-full"
              >
                {methods.map((m) => (
                  <ToggleGroupItem key={m} value={m}>
                    {METHOD_LABEL[m]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}
          </FormField>
        )}
      />
      <FormField
        label={`Amount (${bill.currency})`}
        error={formState.errors.amount?.message}
        required
      >
        <Input inputMode="decimal" autoComplete="off" {...register("amount")} />
      </FormField>
      <FormField
        label="Reference"
        description="Optional: UPI/card transaction id"
        error={formState.errors.reference?.message}
      >
        <Input autoComplete="off" {...register("reference")} />
      </FormField>
      <FormField label="Reason" error={formState.errors.note?.message} required>
        <Textarea maxLength={200} placeholder="e.g. Dish returned" {...register("note")} />
      </FormField>
      <NeedsConnectionNote>Recording a refund needs a connection.</NeedsConnectionNote>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={formState.isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={formState.isSubmitting || offline}>
          {formState.isSubmitting && <Spinner decorative />}
          {networkError ? "Retry refund" : "Record refund"}
        </Button>
      </DialogFooter>
    </form>
  );
}
