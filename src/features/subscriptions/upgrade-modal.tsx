"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Info, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ErrorState, LoadingState } from "@/components/shared/feedback";
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
import { createSupportRequestSchema, type PublicPlanDto } from "@/contracts/platform";
import { BILLING_CYCLES } from "@/domain/subscriptions/entitlements";
import { applyFieldErrors, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { useRequestUpgrade, useSubscriptionOverview } from "./queries";
import { formatDate, formatPrice } from "./subscription-ui";

const upgradeFormSchema = createSupportRequestSchema.pick({ message: true }).extend({
  planKey: z.string().min(1, "Choose a plan"),
  billingCycle: z.enum(BILLING_CYCLES),
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
      message: "We'd like to upgrade our workspace. Please get in touch to activate the plan.",
    },
    resetOptions: { keepDirtyValues: true },
  });

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
          <AlertTitle>Upgrade request sent</AlertTitle>
          <AlertDescription>
            You asked on {formatDate(d.pendingUpgrade.createdAt)}. Our team will contact you to
            confirm payment and activate the plan.
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button variant="outline" asChild>
            <Link href={`/app/w/${workspaceId}/support`} onClick={onDone}>
              View request
            </Link>
          </Button>
          <Button onClick={onDone}>Done</Button>
        </DialogFooter>
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

  const cycle = form.watch("billingCycle");
  const onSubmit = form.handleSubmit(async (values) => {
    const plan = plans.find((p) => p.key === values.planKey);
    try {
      await request.mutateAsync({
        category: "UPGRADE",
        priority: "NORMAL",
        subject: `Upgrade request: ${plan?.name ?? values.planKey} (${values.billingCycle === "ANNUAL" ? "annual" : "monthly"})`,
        message: values.message,
        planKey: values.planKey,
        billingCycle: values.billingCycle,
      });
      toast.success("Upgrade request sent. We'll be in touch shortly.");
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
          Online payment isn&apos;t available yet. Sending this request notifies our team, who will
          contact you at your account email to arrange payment and activate the plan. Nothing is
          charged now.
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
        label="Message to our team"
        error={form.formState.errors.message?.message}
        description="Add anything we should know, e.g. GST details or a preferred contact time."
        required
      >
        <Textarea rows={3} maxLength={5000} {...form.register("message")} />
      </FormField>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={request.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={request.isPending}>
          {request.isPending ? <Spinner decorative /> : <Sparkles aria-hidden />}
          Send upgrade request
        </Button>
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
