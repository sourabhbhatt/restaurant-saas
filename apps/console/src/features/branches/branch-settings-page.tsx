"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState, FormError, PageHeader, PageSkeleton } from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ros/ui/ui/card";
import { FormField } from "@ros/ui/ui/form-field";
import { Input } from "@ros/ui/ui/input";
import { Switch } from "@ros/ui/ui/switch";
import {
  branchSettingsSchema,
  type BranchDto,
  type BranchSettingsDto,
} from "@ros/contracts/tenancy";
import { useBranchContext, permissionChecker } from "@ros/web-core/features/session/queries";
import { api, errorMessage } from "@ros/api-client";
import { useAction } from "@ros/web-core/use-action";

import { BusinessHoursEditor } from "./business-hours-editor";

const METHODS = ["CASH", "UPI", "CARD", "OTHER"] as const;
const METHOD_LABELS: Record<(typeof METHODS)[number], string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  OTHER: "Other",
};
const bpsToPct = (bps: number) => String(bps / 100);
const pctToBps = (v: string) => (v.trim() === "" ? Number.NaN : Math.round(Number(v) * 100));

function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={label} />
    </label>
  );
}

function SettingsForm({
  branchId,
  s,
  canEdit,
}: {
  branchId: string;
  s: BranchSettingsDto;
  canEdit: boolean;
}) {
  const [taxes, setTaxes] = useState(
    s.taxes.map((t) => ({ name: t.name, pct: bpsToPct(t.rateBps) })),
  );
  const [service, setService] = useState(bpsToPct(s.serviceChargeBps));
  const [flags, setFlags] = useState({
    pricesIncludeTax: s.pricesIncludeTax,
    requireFullPaymentToClose: s.requireFullPaymentToClose,
    autoCompleteOnPayment: s.autoCompleteOnPayment,
    allowCustomerBillRequest: s.allowCustomerBillRequest,
    acceptingOrders: s.acceptingOrders,
    kitchenSoundEnabled: s.kitchenSoundEnabled,
    waiterSoundEnabled: s.waiterSoundEnabled,
  });
  const [methods, setMethods] = useState<string[]>(s.paymentMethods);
  const [delay, setDelay] = useState(String(s.kitchenDelayMinutes));
  const [header, setHeader] = useState(s.receiptHeader ?? "");
  const [footer, setFooter] = useState(s.receiptFooter ?? "");
  const [version, setVersion] = useState(s.version);
  const { pending, run, err, errFor, formError, setFieldErrors } = useAction();
  const flag = (k: keyof typeof flags) => (v: boolean) => setFlags((f) => ({ ...f, [k]: v }));
  const taxRowError = (i: number) =>
    errFor(`taxes.${i}.`)
      .map(([, m]) => m)
      .find(Boolean);

  return (
    <form
      className="flex flex-col gap-6"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const body = {
          taxes: taxes.map((t) => ({ name: t.name, rateBps: pctToBps(t.pct) })),
          serviceChargeBps: pctToBps(service),
          paymentMethods: methods,
          kitchenDelayMinutes: delay.trim() === "" ? Number.NaN : Number(delay),
          receiptHeader: header,
          receiptFooter: footer,
          version,
          ...flags,
        };
        // Same rules as the server, shown under each field before sending.
        const parsed = branchSettingsSchema.safeParse(body);
        if (!parsed.success) {
          const local: Record<string, string[]> = {};
          for (const issue of parsed.error.issues) {
            const key = issue.path.join(".");
            (local[key] ??= []).push(issue.message);
          }
          setFieldErrors(local);
          return;
        }
        const saved = await run(() =>
          api.put<BranchSettingsDto>(`/branches/${branchId}/settings`, body),
        );
        if (saved) {
          setVersion(saved.version);
          toast.success("Settings saved");
        }
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>Taxes &amp; charges</CardTitle>
          <CardDescription>
            Applied when a bill is generated. Past bills never change. Enter rates as percentages,
            e.g. 2.5 for 2.5%.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {taxes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No taxes. Bills show item totals plus any service charge.
            </p>
          ) : null}
          {taxes.map((t, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <FormField label="Tax name" className="flex-1">
                <Input
                  value={t.name}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setTaxes((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                  }
                />
              </FormField>
              <FormField label="Rate %" className="w-28">
                <Input
                  inputMode="decimal"
                  value={t.pct}
                  disabled={!canEdit}
                  onChange={(e) =>
                    setTaxes((l) => l.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))
                  }
                />
              </FormField>
              {canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${t.name || "tax"}`}
                  onClick={() => setTaxes((l) => l.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
              {taxRowError(i) ? (
                <p className="w-full text-sm font-medium text-destructive" role="alert">
                  {taxRowError(i)}
                </p>
              ) : null}
            </div>
          ))}
          {err("taxes") && (
            <p className="text-sm text-destructive" role="alert">
              {err("taxes")}
            </p>
          )}
          {canEdit && taxes.length < 6 && (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => setTaxes((l) => [...l, { name: "", pct: "0" }])}
            >
              <Plus className="size-4" aria-hidden /> Add tax
            </Button>
          )}
          {canEdit && taxes.length >= 6 ? (
            <p className="text-xs text-muted-foreground">Up to 6 taxes per branch.</p>
          ) : null}
          <FormField
            label="Service charge %"
            description="Added to the bill's item total before tax, e.g. 5 for 5% (up to 50%). Use 0 for none."
            error={err("serviceChargeBps")}
            className="max-w-xs"
          >
            <Input
              inputMode="decimal"
              value={service}
              disabled={!canEdit}
              onChange={(e) => setService(e.target.value)}
            />
          </FormField>
          <Toggle
            label="Menu prices include tax"
            hint="On: taxes are shown as part of the price. Off: taxes are added on top at billing."
            checked={flags.pricesIncludeTax}
            onChange={flag("pricesIncludeTax")}
            disabled={!canEdit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments &amp; table closing</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-1">
            <p className="text-sm font-medium" id="payment-methods-label">
              Payment methods accepted
            </p>
            <p className="text-xs text-muted-foreground">
              Staff can record payments only with the selected methods.
            </p>
          </div>
          <div
            role="group"
            aria-labelledby="payment-methods-label"
            className="flex flex-wrap gap-2"
          >
            {METHODS.map((m) => (
              <Button
                key={m}
                type="button"
                size="sm"
                disabled={!canEdit}
                variant={methods.includes(m) ? "default" : "outline"}
                aria-pressed={methods.includes(m)}
                onClick={() =>
                  setMethods((l) => (l.includes(m) ? l.filter((x) => x !== m) : [...l, m]))
                }
              >
                {METHOD_LABELS[m]}
              </Button>
            ))}
          </div>
          {err("paymentMethods") && (
            <p className="text-sm text-destructive" role="alert">
              {err("paymentMethods")}
            </p>
          )}
          <Toggle
            label="Require full payment to close a table"
            hint="Staff can't free the table until the bill is fully paid."
            checked={flags.requireFullPaymentToClose}
            onChange={flag("requireFullPaymentToClose")}
            disabled={!canEdit}
          />
          <Toggle
            label="Complete served orders when the bill is paid"
            hint="Saves staff marking each order as completed by hand."
            checked={flags.autoCompleteOnPayment}
            onChange={flag("autoCompleteOnPayment")}
            disabled={!canEdit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ordering &amp; kitchen</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Toggle
            label="Accepting orders"
            hint="Turn off to stop customers ordering from QR codes."
            checked={flags.acceptingOrders}
            onChange={flag("acceptingOrders")}
            disabled={!canEdit}
          />
          <Toggle
            label="Customers can request the bill"
            hint="Shows a “Request bill” button on the QR menu; waiters get an alert."
            checked={flags.allowCustomerBillRequest}
            onChange={flag("allowCustomerBillRequest")}
            disabled={!canEdit}
          />
          <Toggle
            label="Kitchen alert sound"
            hint="Kitchen display plays a sound for new orders."
            checked={flags.kitchenSoundEnabled}
            onChange={flag("kitchenSoundEnabled")}
            disabled={!canEdit}
          />
          <Toggle
            label="Waiter alert sound"
            hint="Waiter app plays a sound for new orders and bill requests."
            checked={flags.waiterSoundEnabled}
            onChange={flag("waiterSoundEnabled")}
            disabled={!canEdit}
          />
          <FormField
            label="Kitchen delay alert (minutes)"
            description="Orders still being prepared after this many minutes (1 to 240) are highlighted as delayed on the kitchen display."
            error={err("kitchenDelayMinutes")}
            className="max-w-sm"
          >
            <Input
              inputMode="numeric"
              value={delay}
              disabled={!canEdit}
              onChange={(e) => setDelay(e.target.value)}
            />
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Receipts</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Header"
            description="Optional. Printed at the top of every bill, e.g. legal name and GSTIN."
            error={err("receiptHeader")}
          >
            <Input value={header} disabled={!canEdit} onChange={(e) => setHeader(e.target.value)} />
          </FormField>
          <FormField
            label="Footer"
            description="Optional. Printed at the bottom, e.g. “Thank you, visit again”."
            error={err("receiptFooter")}
          >
            <Input value={footer} disabled={!canEdit} onChange={(e) => setFooter(e.target.value)} />
          </FormField>
        </CardContent>
      </Card>
      {canEdit ? (
        <div className="flex flex-col gap-3">
          <FormError>{formError}</FormError>
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          You can view these settings. Ask a branch manager to change them.
        </p>
      )}
    </form>
  );
}

function HoursCard({ branchId, canEdit }: { branchId: string; canEdit: boolean }) {
  const q = useQuery({
    queryKey: ["branch", branchId, "detail"],
    queryFn: ({ signal }) => api.get<BranchDto>(`/branches/${branchId}`, undefined, signal),
  });
  const [hours, setHours] = useState<BranchDto["businessHours"] | null>(null);
  const { pending, run } = useAction();
  if (!q.data) return null;
  const value = hours ?? q.data.businessHours;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Business hours</CardTitle>
        <CardDescription>Local time of the branch ({q.data.timezone}).</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <BusinessHoursEditor value={value} onChange={setHours} disabled={!canEdit} />
        {canEdit && (
          <Button
            className="self-start"
            disabled={pending || hours === null}
            title={hours === null ? "Change the hours to save" : undefined}
            onClick={async () => {
              if (await run(() => api.patch(`/branches/${branchId}`, { businessHours: value })))
                toast.success("Hours saved");
            }}
          >
            {pending ? "Saving…" : "Save hours"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function BranchSettingsPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const ctx = useBranchContext(branchId);
  const q = useQuery({
    queryKey: ["branch", branchId, "settings"],
    queryFn: ({ signal }) =>
      api.get<BranchSettingsDto>(`/branches/${branchId}/settings`, undefined, signal),
  });
  if (q.isPending || ctx.isPending) return <PageSkeleton variant="detail" />;
  if (q.isError)
    return (
      <ErrorState
        title="Couldn't load settings"
        message={errorMessage(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  const canEdit = permissionChecker(ctx.data?.permissions)("branch.update");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Branch settings"
        description="Taxes, payments, ordering and receipts for this branch."
      />
      <SettingsForm key={q.data.version} branchId={branchId} s={q.data} canEdit={canEdit} />
      <HoursCard branchId={branchId} canEdit={canEdit} />
    </div>
  );
}
