"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Info, Sparkles } from "lucide-react";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog, ErrorState, LoadingState } from "@/components/shared/feedback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { PublicPlanDto } from "@ros/contracts/platform";
import { BILLING_CYCLES } from "@ros/domain/subscriptions/entitlements";
import { applyFieldErrors, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { useCancelUpgrade, useRequestUpgrade, useSubscriptionOverview } from "./queries";
import { PayWithRazorpayButton } from "./razorpay-checkout";
import { formatDate, formatPrice } from "./subscription-ui";

const upgradeFormSchema = z.object({
  planKey: z.string().min(1, "Choose a plan"),
  billingCycle: z.enum(BILLING_CYCLES),
  message: z.string().trim().max(500, "Keep the message under 500 characters"),
});
type UpgradeForm = z.infer<typeof upgradeFormSchema>;

function PlanOption({ plan, cycle }: { plan: PublicPlanDto; cycle: "MONTHLY" | "ANNUAL" }) {
  const price = cycle === "ANNUAL" ? plan.annualPrice : plan.monthlyPrice;
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium">{plan.name}</span>
        <span className="text-sm font-semibold tabular-nums">
          {formatPrice(price, plan.currency)}
          {price ? (
            <span className="font-normal text-muted-foreground">
              {cycle === "ANNUAL" ? " / year" : " / month"}
            </span>
          ) : null}
        </span>
      </span>
      {plan.description ? (
        <span className="text-xs text-muted-foreground">{plan.description}</span>
      ) : null}
    </span>
  );
}

function UpgradeBody({
  workspaceId,
  initialPlanKey,
  onDone,
}: {
  workspaceId: string;
  initialPlanKey?: string;
  onDone: () => void;
}) {
  const overview = useSubscriptionOverview(workspaceId);
  const request = useRequestUpgrade(workspaceId);
  const cancel = useCancelUpgrade(workspaceId);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const plans = overview.data?.availablePlans ?? [];
  const defaultPlan =
    initialPlanKey ??
    plans.find((p) => p.key !== overview.data?.currentPlan?.key && p.monthlyPrice !== null)?.key ??
    plans[0]?.key ??
    "";

  const form = useForm<UpgradeForm>({
    resolver: zodResolver(upgradeFormSchema),
    values: {
      planKey: defaultPlan,
      billingCycle: "ANNUAL",
      message: "",
    },
    resetOptions: { keepDirtyValues: true },
  });
  const cycle = useWatch({ control: form.control, name: "billingCycle" });
  const chosenKey = useWatch({ control: form.control, name: "planKey" });

  if (overview.isPending) return <LoadingState label="Loading plans…" />;
  if (overview.isError) {
    return (
      <ErrorState
        size="compact"
        message={errorMessage(overview.error)}
        onRetry={() => void overview.refetch()}
      />
    );
  }
  const d = overview.data;

  if (d.pendingUpgrade) {
    return (
      <div className="grid gap-4">
        <Alert variant="success">
          <CheckCircle2 aria-hidden />
          <AlertTitle>Upgrade request pending</AlertTitle>
          <AlertDescription>
            You asked for the {d.pendingUpgrade.requestedPlanName} plan on{" "}
            {formatDate(d.pendingUpgrade.createdAt)}. Our team will confirm payment and activate it;
            you&apos;ll get a notification either way. Your current plan stays active until then.
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmCancel(true)}>
            Cancel request
          </Button>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
        <ConfirmDialog
          open={confirmCancel}
          onOpenChange={setConfirmCancel}
          title="Cancel this upgrade request?"
          description="Nothing is charged. You can send a new request at any time."
          confirmLabel="Cancel request"
          destructive
          onConfirm={async () => {
            await cancel.mutateAsync(d.pendingUpgrade!.id);
            toast.success("Upgrade request cancelled");
            setConfirmCancel(false);
          }}
        />
      </div>
    );
  }

  if (!d.canRequestUpgrade) {
    return (
      <div className="grid gap-4">
        <Alert variant="info">
          <Info aria-hidden />
          <AlertDescription>
            Only workspace owners and admins can request a plan change. Ask your workspace owner, or
            write to{" "}
            <a className="font-medium underline" href={`mailto:${d.supportEmail}`}>
              {d.supportEmail}
            </a>
            .
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button onClick={onDone}>Close</Button>
        </DialogFooter>
      </div>
    );
  }

  const chosen = plans.find((p) => p.key === chosenKey);
  const chosenPrice = chosen
    ? cycle === "ANNUAL"
      ? chosen.annualPrice
      : chosen.monthlyPrice
    : null;
  const canPayOnline = d.paymentsEnabled && Boolean(d.organizationId) && Boolean(chosenPrice);

  const onSubmit = form.handleSubmit(async (values) => {
    const plan = plans.find((p) => p.key === values.planKey);
    try {
      await request.mutateAsync({
        planKey: values.planKey,
        billingCycle: values.billingCycle,
        message: values.message || undefined,
      });
      toast.success(
        `Request for the ${plan?.name ?? "new"} plan sent. You'll be notified when it's decided.`,
      );
      onDone();
    } catch (error) {
      if (applyFieldErrors(error, form.setError, ["planKey", "billingCycle", "message"])) return;
      toast.error(errorMessage(error));
    }
  });

  return (
    <form className="grid gap-5" onSubmit={onSubmit} noValidate>
      <Alert variant="info">
        <Info aria-hidden />
        <AlertDescription>
          {d.paymentsEnabled
            ? "Pay online with Razorpay and the plan activates right away. Prefer an invoice? Send a request instead and our team will contact you at your account email; nothing is charged then."
            : "Online payment isn't available yet. Sending this request notifies our team, who will contact you at your account email to arrange payment and activate the plan. Nothing is charged now."}
        </AlertDescription>
      </Alert>

      <Controller
        control={form.control}
        name="billingCycle"
        render={({ field }) => (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Billing</legend>
            <div className="inline-flex w-fit rounded-lg border p-1" role="radiogroup">
              {BILLING_CYCLES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={field.value === c}
                  onClick={() => field.onChange(c)}
                  className={cn(
                    "min-h-9 rounded-md px-4 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    field.value === c
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {c === "MONTHLY" ? "Monthly" : "Annual"}
                </button>
              ))}
            </div>
          </fieldset>
        )}
      />

      <Controller
        control={form.control}
        name="planKey"
        render={({ field, fieldState }) => (
          <FormField label="Plan" error={fieldState.error?.message} required>
            {(controlProps) => (
              <RadioGroup
                {...controlProps}
                value={field.value}
                onValueChange={field.onChange}
                className="gap-2"
              >
                {plans.map((p) => {
                  const current = p.key === d.currentPlan?.key && d.entitlements.phase === "ACTIVE";
                  return (
                    <label
                      key={p.key}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5",
                      )}
                    >
                      <RadioGroupItem value={p.key} className="mt-0.5" />
                      <PlanOption plan={p} cycle={cycle} />
                      {current ? (
                        <span className="text-xs text-muted-foreground">Current</span>
                      ) : null}
                    </label>
                  );
                })}
              </RadioGroup>
            )}
          </FormField>
        )}
      />

      <FormField
        label="Message to our team (optional)"
        error={form.formState.errors.message?.message}
        description="Add anything we should know, e.g. GST details or a preferred contact time."
      >
        <Textarea rows={3} maxLength={500} {...form.register("message")} />
      </FormField>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={request.isPending}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant={canPayOnline ? "outline" : "default"}
          disabled={request.isPending}
        >
          {request.isPending ? <Spinner decorative /> : <Sparkles aria-hidden />}
          Send upgrade request
        </Button>
        {canPayOnline && chosen ? (
          <PayWithRazorpayButton
            organizationId={d.organizationId}
            workspaceId={workspaceId}
            planKey={chosen.key}
            billingCycle={cycle}
            setFieldError={form.setError}
            disabled={request.isPending}
            onPaid={onDone}
          />
        ) : null}
      </DialogFooter>
    </form>
  );
}

/** Upgrade dialog. Without a payment gateway, the CTA files an UPGRADE support request. */
export function UpgradeModal({
  workspaceId,
  open,
  onOpenChange,
  initialPlanKey,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialPlanKey?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upgrade your plan</DialogTitle>
          <DialogDescription>
            Choose a plan and we&apos;ll activate it for your workspace.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <UpgradeBody
            workspaceId={workspaceId}
            initialPlanKey={initialPlanKey}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Button that opens the upgrade modal. */
export function UpgradeButton({
  workspaceId,
  initialPlanKey,
  children = "Upgrade",
  ...props
}: Omit<ButtonProps, "onClick"> & { workspaceId: string; initialPlanKey?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button {...props} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <UpgradeModal
        workspaceId={workspaceId}
        open={open}
        onOpenChange={setOpen}
        initialPlanKey={initialPlanKey}
      />
    </>
  );
}
