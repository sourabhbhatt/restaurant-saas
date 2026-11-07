"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, CreditCard, Delete, QrCode, Wallet, WifiOff } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { recordPaymentSchema, type BillDto } from "@ros/contracts/billing";
import type { PaymentMethod } from "@ros/domain/billing/payments";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ApiError, applyFieldErrors, errorMessage, newIdempotencyKey } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  METHOD_LABEL,
  money,
  PAYMENT_STATUS_LABEL,
  parseMajor,
  toMajorText,
} from "@/features/billing/format";
import { useRecordPayment } from "@/features/billing/queries";
import { NeedsConnectionNote, useIsOffline } from "@/features/offline";

const METHOD_ICON: Record<PaymentMethod, typeof Banknote> = {
  CASH: Banknote,
  UPI: QrCode,
  CARD: CreditCard,
  OTHER: Wallet,
};

const amountText = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || parseMajor(v) !== null, `Enter a valid ${label}`);

const paymentFormSchema = z
  .object({
    method: recordPaymentSchema.shape.method,
    amount: amountText("amount").refine(
      (v) => (parseMajor(v) ?? 0) > 0,
      "Enter an amount greater than zero",
    ),
    tendered: amountText("cash amount"),
    reference: recordPaymentSchema.shape.reference,
  })
  .superRefine((v, ctx) => {
    if (v.method !== "CASH" || v.tendered === "") return;
    const tendered = parseMajor(v.tendered) ?? 0;
    if (tendered < (parseMajor(v.amount) ?? 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["tendered"],
        message: "Cash tendered is less than the amount",
      });
    }
  });
type PaymentForm = z.input<typeof paymentFormSchema>;
type KeypadField = "amount" | "tendered";

interface Props {
  bill: BillDto;
  branchId: string;
  methods: PaymentMethod[];
}

/** Method buttons + keypad + record payment. Never shows PAID unless the server says so. */
export function PaymentPanel({ bill, branchId, methods }: Props) {
  // Remount when the bill changes (switching bills or the balance moved) so defaults are fresh.
  return (
    <PaymentPanelBody
      key={`${bill.id}:${bill.version}`}
      bill={bill}
      branchId={branchId}
      methods={methods}
    />
  );
}

function PaymentPanelBody({ bill, branchId, methods }: Props) {
  const record = useRecordPayment(branchId);
  const offline = useIsOffline();
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [networkError, setNetworkError] = useState(false);
  const [active, setActive] = useState<KeypadField>("amount");
  const balance = bill.balanceDue;

  const form = useForm<PaymentForm>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: {
      method: methods[0] ?? "CASH",
      amount: toMajorText(balance),
      tendered: "",
      reference: "",
    },
  });
  const { control, setValue, setError, register, formState } = form;
  const method = useWatch({ control, name: "method" });
  const amountMinor = parseMajor(useWatch({ control, name: "amount" })) ?? 0;
  const tenderedMinor = parseMajor(useWatch({ control, name: "tendered" }));
  const change =
    method === "CASH" && tenderedMinor !== null ? Math.max(tenderedMinor - amountMinor, 0) : null;
  const pending = record.isPending || formState.isSubmitting;

  /** Any edit starts a new attempt; a retry of the same values reuses the key. */
  const edit = (field: keyof PaymentForm, value: string) => {
    setValue(field, value as never, { shouldValidate: formState.isSubmitted });
    setIdempotencyKey(newIdempotencyKey());
    setNetworkError(false);
  };

  const press = (key: string) => {
    const current = form.getValues(active) ?? "";
    let next = current;
    if (key === "back") next = current.slice(0, -1);
    else if (key === "clear") next = "";
    else if (key === ".") next = current.includes(".") ? current : `${current || "0"}.`;
    else {
      const [, frac] = current.split(".");
      if (frac !== undefined && frac.length + key.length > 2) return;
      next = current === "0" ? key : current + key;
    }
    edit(active, next);
  };

  const submit = form.handleSubmit(async (values) => {
    if (offline) return;
    setNetworkError(false);
    const amount = parseMajor(values.amount) ?? 0;
    if (amount > balance) {
      setError("amount", {
        message: `Amount exceeds the balance of ${money(balance, bill.currency)}`,
      });
      return;
    }
    const tendered =
      values.method === "CASH" && values.tendered
        ? (parseMajor(values.tendered) ?? undefined)
        : undefined;
    try {
      const result = await record.mutateAsync({
        billId: bill.id,
        method: values.method,
        amount,
        tendered,
        reference: values.method !== "CASH" && values.reference ? values.reference : undefined,
        idempotencyKey,
      });
      const status = PAYMENT_STATUS_LABEL[result.bill.paymentStatus];
      toast.success(
        `${money(result.payment.amount, bill.currency)} recorded · ${status}` +
          (result.change ? ` · Change ${money(result.change, bill.currency)}` : ""),
      );
    } catch (error) {
      if (error instanceof ApiError && error.isNetworkError) {
        // Keep the form and the key: retrying is safe and never double-counts.
        setNetworkError(true);
        return;
      }
      if (!applyFieldErrors(error, setError, ["method", "amount", "tendered", "reference"])) {
        toast.error(errorMessage(error));
      }
    }
  });

  if (bill.status === "VOID") return null;
  if (balance === 0) {
    return (
      <Alert>
        <AlertTitle>Nothing left to collect</AlertTitle>
        <AlertDescription>
          The server reports this bill as {PAYMENT_STATUS_LABEL[bill.paymentStatus].toLowerCase()}.
        </AlertDescription>
      </Alert>
    );
  }
  if (methods.length === 0) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          No payment methods are enabled for this branch. Ask a manager to enable one in branch
          settings.
        </AlertDescription>
      </Alert>
    );
  }

  const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"];
  const quickTender = [
    ...new Set([
      balance,
      Math.ceil(balance / 10_000) * 10_000,
      Math.ceil(balance / 50_000) * 50_000,
      Math.ceil(balance / 200_000) * 200_000,
    ]),
  ]
    .filter((v) => v >= amountMinor && v > 0)
    .slice(0, 4);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" aria-label="Record payment">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Method</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {methods.map((m) => {
            const Icon = METHOD_ICON[m];
            const selected = method === m;
            return (
              <Button
                key={m}
                type="button"
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
                className="h-14 flex-col gap-1 sm:h-14"
                onClick={() => {
                  edit("method", m);
                  if (m !== "CASH" && active === "tendered") setActive("amount");
                }}
              >
                <Icon aria-hidden className="size-5" />
                {METHOD_LABEL[m]}
              </Button>
            );
          })}
        </div>
      </fieldset>

      <div className={cn("grid gap-3", method === "CASH" && "sm:grid-cols-2")}>
        <FormField
          label={`Amount (${bill.currency})`}
          error={formState.errors.amount?.message}
          required
        >
          <Input
            {...register("amount", { onChange: () => setIdempotencyKey(newIdempotencyKey()) })}
            inputMode="decimal"
            autoComplete="off"
            onFocus={() => setActive("amount")}
            className={cn(
              "h-12 text-right text-xl font-semibold tabular-nums",
              active === "amount" && "ring-2 ring-ring/40",
            )}
          />
        </FormField>
        {method === "CASH" && (
          <FormField
            label="Cash tendered"
            description="Optional, to work out change"
            error={formState.errors.tendered?.message}
          >
            <Input
              {...register("tendered", { onChange: () => setIdempotencyKey(newIdempotencyKey()) })}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              onFocus={() => setActive("tendered")}
              className={cn(
                "h-12 text-right text-xl font-semibold tabular-nums",
                active === "tendered" && "ring-2 ring-ring/40",
              )}
            />
          </FormField>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => edit("amount", toMajorText(balance))}
        >
          Full balance {money(balance, bill.currency)}
        </Button>
        {balance >= 200 && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => edit("amount", toMajorText(Math.round(balance / 2)))}
          >
            Half
          </Button>
        )}
        {method === "CASH" &&
          quickTender.map((v) => (
            <Button
              key={v}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => edit("tendered", toMajorText(v))}
            >
              Tendered {money(v, bill.currency)}
            </Button>
          ))}
      </div>

      <div
        className="grid grid-cols-3 gap-2"
        role="group"
        aria-label={`Keypad for ${active === "amount" ? "amount" : "cash tendered"}`}
      >
        {keypad.map((k) => (
          <Button
            key={k}
            type="button"
            variant="outline"
            className="h-12 text-lg font-semibold sm:h-12"
            onClick={() => press(k)}
            aria-label={k === "back" ? "Delete last digit" : k === "." ? "Decimal point" : k}
          >
            {k === "back" ? <Delete aria-hidden className="size-5" /> : k}
          </Button>
        ))}
      </div>

      {method === "CASH" && change !== null && (
        <div className="flex items-baseline justify-between rounded-lg bg-success/10 px-4 py-3 text-success">
          <span className="text-sm font-medium">Change to return</span>
          <span data-numeric className="text-2xl font-semibold tabular-nums">
            {money(change, bill.currency)}
          </span>
        </div>
      )}

      {method !== "CASH" && (
        <FormField
          label={
            method === "UPI"
              ? "UPI transaction reference"
              : method === "CARD"
                ? "Card approval / reference"
                : "Reference"
          }
          description="Optional"
          error={formState.errors.reference?.message}
        >
          <Input
            autoComplete="off"
            maxLength={100}
            {...register("reference", { onChange: () => setIdempotencyKey(newIdempotencyKey()) })}
          />
        </FormField>
      )}

      {networkError && (
        <Alert variant="destructive">
          <WifiOff aria-hidden />
          <AlertTitle>Not recorded — check connection and retry</AlertTitle>
          <AlertDescription>
            Retrying is safe: the same payment will never be counted twice.
          </AlertDescription>
        </Alert>
      )}

      <NeedsConnectionNote>
        Recording a payment needs a connection. Nothing is recorded on this device.
      </NeedsConnectionNote>
      <Button type="submit" size="lg" className="h-14 text-base" disabled={pending || offline}>
        {pending && <Spinner decorative />}
        {pending
          ? "Recording…"
          : networkError
            ? "Retry payment"
            : `Record ${money(amountMinor, bill.currency)} · ${METHOD_LABEL[method]}`}
      </Button>
    </form>
  );
}
