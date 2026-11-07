"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Receipt, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorState, LoadingState } from "@ros/ui/shared/feedback";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import { Separator } from "@ros/ui/ui/separator";
import { Spinner } from "@ros/ui/ui/spinner";
import { Switch } from "@ros/ui/ui/switch";
import type { BillDto } from "@ros/contracts/billing";
import { billDiscountSchema } from "@ros/contracts/billing";
import { formatMoney, isCurrencyCode, toMinor } from "@ros/domain/shared/money";
import { applyFieldErrors, errorMessage, newIdempotencyKey } from "@ros/api-client";

import { useBillPreview, useGenerateBill, type DiscountInput } from "./queries";
import { NeedsConnectionNote, useIsOffline } from "@ros/web-core/features/offline";

/** Discount entered in display units: percent (e.g. 10) or amount in major units (e.g. 50). */
const discountFormSchema = z
  .object({
    enabled: z.boolean(),
    type: z.enum(["PERCENT", "FLAT"]),
    amount: z.string().trim(),
    reason: z.string().trim().max(200, "Keep the reason under 200 characters"),
  })
  .superRefine((v, ctx) => {
    if (!v.enabled) return;
    const n = Number(v.amount);
    if (v.amount === "" || !Number.isFinite(n) || n <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["amount"],
        message: "Enter a discount greater than zero",
      });
    } else if (v.type === "PERCENT" && n > 100) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Discount cannot exceed 100%" });
    }
  });
type DiscountForm = z.infer<typeof discountFormSchema>;

function toDiscount(v: DiscountForm, currency: string): DiscountInput | null {
  if (!v.enabled) return null;
  const n = Number(v.amount);
  const parsed = billDiscountSchema.safeParse({
    type: v.type,
    value:
      v.type === "PERCENT"
        ? Math.round(n * 100)
        : isCurrencyCode(currency)
          ? toMinor(n, currency)
          : Math.round(n * 100),
    reason: v.reason || undefined,
  });
  return parsed.success ? (parsed.data as DiscountInput) : null;
}

/**
 * Waiter bill generation: preview totals from the billing module, optional
 * discount (bills.discount), then issue the bill with an idempotency key.
 */
export function GenerateBillDialog({
  branchId,
  sessionId,
  tableName,
  currency,
  canDiscount,
  open,
  onOpenChange,
}: {
  branchId: string;
  sessionId: string;
  tableName: string;
  currency: string;
  canDiscount: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [applied, setApplied] = useState<DiscountInput | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [issued, setIssued] = useState<BillDto | null>(null);
  const preview = useBillPreview(branchId, sessionId, applied, open && !issued);
  const generate = useGenerateBill(branchId);
  const offline = useIsOffline();
  const form = useForm<DiscountForm>({
    resolver: zodResolver(discountFormSchema),
    defaultValues: { enabled: false, type: "PERCENT", amount: "", reason: "" },
  });
  const enabled = useWatch({ control: form.control, name: "enabled" });
  const discountType = useWatch({ control: form.control, name: "type" });
  const p = preview.data;

  const close = (o: boolean) => {
    if (generate.isPending) return;
    if (!o) {
      setApplied(null);
      setIssued(null);
      setIdempotencyKey(newIdempotencyKey());
      form.reset();
    }
    onOpenChange(o);
  };

  const applyDiscount = form.handleSubmit((v) => setApplied(toDiscount(v, currency)));

  const issue = async () => {
    try {
      const bill = await generate.mutateAsync({ sessionId, discount: applied, idempotencyKey });
      setIssued(bill);
      toast.success(`Bill #${bill.billNumber} issued for ${tableName}`);
    } catch (error) {
      if (!applyFieldErrors(error, form.setError, ["reason"])) toast.error(errorMessage(error));
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{issued ? "Bill issued" : `Generate bill · ${tableName}`}</DialogTitle>
          <DialogDescription>
            {issued
              ? "The guest can now see the bill on their phone."
              : "Review the totals. Pending orders are not included."}
          </DialogDescription>
        </DialogHeader>

        {issued ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <Receipt className="size-10 text-primary" aria-hidden />
            <p className="text-lg font-semibold">Bill #{issued.billNumber}</p>
            <p className="text-2xl font-bold tabular-nums">
              {formatMoney(issued.grandTotal, issued.currency)}
            </p>
          </div>
        ) : preview.isPending ? (
          <LoadingState label="Calculating totals…" />
        ) : preview.isError ? (
          <ErrorState
            size="compact"
            title="Couldn't prepare the bill"
            message={errorMessage(preview.error)}
            onRetry={() => void preview.refetch()}
          />
        ) : p ? (
          <div className="flex flex-col gap-3">
            {p.warnings?.length > 0 && (
              <Alert>
                <TriangleAlert aria-hidden />
                <AlertDescription>{p.warnings.join(" · ")}</AlertDescription>
              </Alert>
            )}
            <dl className="flex flex-col gap-1.5 text-sm">
              <Row
                label={`Subtotal (${p.items?.length ?? 0} lines)`}
                value={p.subtotal}
                currency={currency}
              />
              {p.discountAmount > 0 && (
                <Row label="Discount" value={-p.discountAmount} currency={currency} />
              )}
              {p.serviceChargeAmount > 0 && (
                <Row
                  label={`Service charge (${p.serviceChargeBps / 100}%)`}
                  value={p.serviceChargeAmount}
                  currency={currency}
                />
              )}
              {p.taxes.map((t) => (
                <Row
                  key={t.name}
                  label={`${t.name} (${t.rateBps / 100}%)`}
                  value={t.amount}
                  currency={currency}
                />
              ))}
              <Separator className="my-1" />
              <Row label="Grand total" value={p.grandTotal} currency={currency} strong />
            </dl>
            {canDiscount && (
              <form
                onSubmit={applyDiscount}
                noValidate
                className="flex flex-col gap-3 rounded-xl border p-3"
              >
                <Controller
                  control={form.control}
                  name="enabled"
                  render={({ field }) => (
                    <label className="flex items-center justify-between gap-3 text-sm font-medium">
                      Apply a discount
                      <Switch
                        checked={field.value}
                        onCheckedChange={(v) => {
                          field.onChange(v);
                          if (!v) setApplied(null);
                        }}
                      />
                    </label>
                  )}
                />
                {enabled && (
                  <>
                    <div className="grid grid-cols-[8rem_1fr] gap-2">
                      <Controller
                        control={form.control}
                        name="type"
                        render={({ field }) => (
                          <FormField label="Type">
                            {(controlProps) => (
                              <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger {...controlProps} className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="PERCENT">Percent</SelectItem>
                                  <SelectItem value="FLAT">Amount</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </FormField>
                        )}
                      />
                      <FormField label="Value" error={form.formState.errors.amount?.message}>
                        <Input
                          inputMode="decimal"
                          placeholder={discountType === "PERCENT" ? "10" : "50"}
                          {...form.register("amount")}
                        />
                      </FormField>
                    </div>
                    <FormField label="Reason" error={form.formState.errors.reason?.message}>
                      <Input placeholder="e.g. Regular guest" {...form.register("reason")} />
                    </FormField>
                    <Button type="submit" variant="outline" size="sm" disabled={preview.isFetching}>
                      {preview.isFetching && <Spinner decorative />}
                      Update totals
                    </Button>
                  </>
                )}
              </form>
            )}
          </div>
        ) : null}

        <DialogFooter>
          {issued ? (
            <>
              <Button variant="outline" asChild>
                <Link href={`/app/b/${branchId}/bills`}>Open bills</Link>
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </>
          ) : (
            <>
              <NeedsConnectionNote>Issuing a bill needs a connection.</NeedsConnectionNote>
              <Button variant="outline" onClick={() => close(false)} disabled={generate.isPending}>
                Cancel
              </Button>
              <Button
                onClick={() => void issue()}
                disabled={
                  generate.isPending ||
                  offline ||
                  !p ||
                  preview.isFetching ||
                  Boolean(p.existingBillId) ||
                  (p.items?.length ?? 0) === 0
                }
              >
                {generate.isPending && <Spinner decorative />}
                Issue bill
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  currency,
  strong,
}: {
  label: string;
  value: number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? "text-base font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums">{formatMoney(value, currency)}</dd>
    </div>
  );
}
