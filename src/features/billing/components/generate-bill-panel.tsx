"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText, Percent } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { billDiscountSchema, type BillDto } from "@ros/contracts/billing";
import type { BillPreviewDto } from "@ros/contracts/billing-extra";
import type { BillDiscount } from "@ros/domain/billing/bill-calculator";
import { ErrorState, LoadingState } from "@/components/shared/feedback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, ApiError, errorMessage, newIdempotencyKey } from "@/lib/api-client";

import { parseMajor } from "../format";
import { billingKeys, useGenerateBill } from "../queries";
import { BillBreakdown, discountLabelFor } from "./bill-breakdown";
import { NeedsConnectionNote, useIsOffline } from "@/features/offline";

const discountFormSchema = z
  .object({
    type: z.enum(["NONE", "PERCENT", "FLAT"]),
    value: z.string().trim(),
    reason: billDiscountSchema.shape.reason,
  })
  .superRefine((v, ctx) => {
    if (v.type === "NONE") return;
    const minor = parseMajor(v.value);
    if (minor === null || minor <= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Enter a discount greater than zero",
      });
      return;
    }
    const parsed = billDiscountSchema.safeParse({ type: v.type, value: minor });
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: parsed.error.issues[0]?.message ?? "Invalid discount",
      });
    }
  });
type DiscountForm = z.input<typeof discountFormSchema>;

/** Percent text "10" → 1000 bps; flat "50.00" → 5000 minor units (both via ×100). */
function toDiscount(values: DiscountForm): BillDiscount | null {
  if (values.type === "NONE") return null;
  const value = parseMajor(values.value) ?? 0;
  return { type: values.type, value, reason: values.reason?.trim() || undefined };
}

interface Props {
  branchId: string;
  sessionId: string;
  tableName: string;
  canDiscount: boolean;
  onGenerated: (bill: BillDto) => void;
}

/** Preview → optional discount → generate, for a session without a bill. */
export function GenerateBillPanel({
  branchId,
  sessionId,
  tableName,
  canDiscount,
  onGenerated,
}: Props) {
  const [discount, setDiscountState] = useState<BillDiscount | null>(null);
  // One key per (session, discount) attempt; reused on retry so a lost response can't double-issue.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const setDiscount = (next: BillDiscount | null) => {
    setDiscountState(next);
    setIdempotencyKey(newIdempotencyKey());
  };
  const [networkError, setNetworkError] = useState(false);

  const preview = useQuery({
    queryKey: [...billingKeys.all(branchId), "preview", sessionId, discount] as const,
    queryFn: () =>
      api.post<BillPreviewDto>(`/branches/${branchId}/bills/preview`, { sessionId, discount }),
    retry: false,
  });
  const generate = useGenerateBill(branchId);
  const offline = useIsOffline();

  const form = useForm<DiscountForm>({
    resolver: zodResolver(discountFormSchema),
    defaultValues: { type: "NONE", value: "", reason: "" },
  });
  const type = useWatch({ control: form.control, name: "type" });

  const applyDiscount = form.handleSubmit((values) => setDiscount(toDiscount(values)));

  const onGenerate = async () => {
    setNetworkError(false);
    try {
      const bill = await generate.mutateAsync({ sessionId, discount, idempotencyKey });
      toast.success(`Bill #${bill.billNumber} issued for ${tableName}`);
      onGenerated(bill);
    } catch (error) {
      if (error instanceof ApiError && error.isNetworkError) setNetworkError(true);
      else toast.error(errorMessage(error));
    }
  };

  if (preview.isPending) return <LoadingState label="Calculating bill…" />;
  if (preview.isError) {
    return (
      <ErrorState
        size="compact"
        title="Couldn't calculate the bill"
        message={errorMessage(preview.error)}
        onRetry={() => void preview.refetch()}
        retrying={preview.isFetching}
      />
    );
  }
  const p = preview.data;
  const nothingToBill = p.items.length === 0;

  return (
    <div className="flex flex-col gap-5">
      {p.warnings.length > 0 && (
        <Alert variant={p.existingBillId ? "destructive" : "default"}>
          <AlertTriangle aria-hidden />
          <AlertTitle>Before you bill</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {p.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <BillBreakdown
        totals={p}
        items={p.items}
        currency={p.currency}
        discountLabel={discountLabelFor(discount, p.currency)}
        size="large"
      />

      {canDiscount && !nothingToBill && (
        <form
          onSubmit={applyDiscount}
          noValidate
          className="flex flex-col gap-3 rounded-lg border p-3"
        >
          <p className="flex items-center gap-2 text-sm font-medium">
            <Percent className="size-4 text-muted-foreground" aria-hidden /> Discount
          </p>
          <ToggleGroup
            type="single"
            variant="outline"
            value={type}
            onValueChange={(v) => {
              if (!v) return;
              form.setValue("type", v as DiscountForm["type"]);
              form.clearErrors("value");
              if (v === "NONE") setDiscount(null);
            }}
            aria-label="Discount type"
            className="w-full"
          >
            <ToggleGroupItem value="NONE">None</ToggleGroupItem>
            <ToggleGroupItem value="PERCENT">Percent</ToggleGroupItem>
            <ToggleGroupItem value="FLAT">Amount</ToggleGroupItem>
          </ToggleGroup>
          {type !== "NONE" && (
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-start">
              <FormField
                label={type === "PERCENT" ? "Percent" : `Amount (${p.currency})`}
                error={form.formState.errors.value?.message}
                required
              >
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={type === "PERCENT" ? "10" : "50.00"}
                  {...form.register("value")}
                />
              </FormField>
              <FormField label="Reason" error={form.formState.errors.reason?.message}>
                <Input
                  autoComplete="off"
                  placeholder="e.g. Regular guest"
                  {...form.register("reason")}
                />
              </FormField>
              <Button
                type="submit"
                variant="secondary"
                className="sm:mt-7"
                disabled={preview.isFetching}
              >
                {preview.isFetching && <Spinner decorative />} Apply
              </Button>
            </div>
          )}
        </form>
      )}

      {networkError && (
        <Alert variant="destructive">
          <AlertDescription>Bill not issued — check connection and retry.</AlertDescription>
        </Alert>
      )}
      <Button
        size="lg"
        onClick={onGenerate}
        disabled={
          generate.isPending ||
          preview.isFetching ||
          nothingToBill ||
          Boolean(p.existingBillId) ||
          offline
        }
      >
        {generate.isPending ? <Spinner decorative /> : <FileText aria-hidden />}
        {generate.isPending
          ? "Issuing bill…"
          : networkError
            ? "Retry issuing bill"
            : "Generate bill"}
      </Button>
      <NeedsConnectionNote>Generating a bill needs a connection.</NeedsConnectionNote>
    </div>
  );
}
