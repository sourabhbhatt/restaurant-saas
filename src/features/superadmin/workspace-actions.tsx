"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { ConfirmDialog } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  activateSubscriptionSchema,
  extendTrialSchema,
  organizationLimitOverrideSchema,
  subscriptionReasonSchema,
  type AdminOrganizationDto,
} from "@/contracts/platform";
import { BILLING_CYCLES } from "@/domain/subscriptions/entitlements";
import { api, applyFieldErrors, errorMessage } from "@/lib/api-client";

import { useWorkspaceAction } from "./queries";

type ReasonForm = z.infer<typeof subscriptionReasonSchema>;

/**
 * Confirm dialog that requires a reason. Validation errors show on the field;
 * server errors show inside the dialog (ConfirmDialog keeps it open).
 */
export function ReasonConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
  successMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<unknown>;
  successMessage: string;
}) {
  const form = useForm<ReasonForm>({
    resolver: zodResolver(subscriptionReasonSchema),
    defaultValues: { reason: "" },
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) form.reset();
        onOpenChange(next);
      }}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      pendingLabel="Working…"
      destructive={destructive}
      getErrorMessage={errorMessage}
      onConfirm={async () => {
        const valid = await form.trigger();
        if (!valid) throw new Error("Add a short reason before continuing.");
        await onConfirm(form.getValues("reason").trim());
        toast.success(successMessage);
        form.reset();
      }}
    >
      <FormField label="Reason" error={form.formState.errors.reason?.message} required>
        <Textarea
          rows={3}
          maxLength={500}
          placeholder="Recorded in the audit log and shared with the owner"
          {...form.register("reason")}
        />
      </FormField>
    </ConfirmDialog>
  );
}

type ActivateInput = z.input<typeof activateSubscriptionSchema>;
type ActivateOutput = z.output<typeof activateSubscriptionSchema>;

function defaultPeriodEnd(cycle: "MONTHLY" | "ANNUAL"): string {
  const d = new Date();
  if (cycle === "ANNUAL") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function ActivateSubscriptionDialog({
  workspaceId,
  plans,
  currentPlanKey,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  plans: { key: string; name: string; status: "ACTIVE" | "ARCHIVED" }[];
  currentPlanKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const action = useWorkspaceAction(workspaceId, (body: ActivateOutput) =>
    api.post(`/admin/workspaces/${workspaceId}/subscription/activate`, body),
  );
  const active = plans.filter((p) => p.status === "ACTIVE");
  const form = useForm<ActivateInput, unknown, ActivateOutput>({
    resolver: zodResolver(activateSubscriptionSchema),
    defaultValues: {
      planKey:
        currentPlanKey && active.some((p) => p.key === currentPlanKey)
          ? currentPlanKey
          : (active[0]?.key ?? ""),
      billingCycle: "MONTHLY",
      periodEnd: defaultPeriodEnd("MONTHLY"),
      notes: "",
    },
  });
  const errors = form.formState.errors;
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await action.mutateAsync(values);
      toast.success("Subscription activated. The owner has been notified.");
      onOpenChange(false);
    } catch (error) {
      if (applyFieldErrors(error, form.setError, ["planKey", "billingCycle", "periodEnd", "notes"]))
        return;
      toast.error(errorMessage(error));
    }
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !action.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-4" onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Activate subscription</DialogTitle>
            <DialogDescription>
              Use after payment is confirmed. The current subscription is replaced and the workspace
              gets full access until the period end.
            </DialogDescription>
          </DialogHeader>
          <Controller
            control={form.control}
            name="planKey"
            render={({ field, fieldState }) => (
              <FormField label="Plan" error={fieldState.error?.message} required>
                {(p) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger {...p} className="w-full">
                      <SelectValue placeholder="Choose a plan" />
                    </SelectTrigger>
                    <SelectContent>
                      {active.map((plan) => (
                        <SelectItem key={plan.key} value={plan.key}>
                          {plan.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}
          />
          <Controller
            control={form.control}
            name="billingCycle"
            render={({ field, fieldState }) => (
              <FormField label="Billing cycle" error={fieldState.error?.message} required>
                {(p) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      if (!form.formState.dirtyFields.periodEnd) {
                        form.setValue("periodEnd", defaultPeriodEnd(v as "MONTHLY" | "ANNUAL"));
                      }
                    }}
                  >
                    <SelectTrigger {...p} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BILLING_CYCLES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c === "MONTHLY" ? "Monthly" : "Annual"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}
          />
          <FormField
            label="Paid until (inclusive)"
            error={errors.periodEnd?.message}
            description="Access continues through the end of this day (UTC)."
            required
          >
            <Input type="date" {...form.register("periodEnd")} />
          </FormField>
          <FormField label="Internal notes" error={errors.notes?.message}>
            <Textarea
              rows={2}
              maxLength={500}
              placeholder="Invoice / UTR reference"
              {...form.register("notes")}
            />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={action.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={action.isPending}>
              {action.isPending && <Spinner decorative />}
              Activate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type ExtendForm = z.infer<typeof extendTrialSchema>;

export function ExtendTrialDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const action = useWorkspaceAction(workspaceId, (body: ExtendForm) =>
    api.post(`/admin/workspaces/${workspaceId}/subscription/extend-trial`, body),
  );
  const form = useForm<ExtendForm>({
    resolver: zodResolver(extendTrialSchema),
    defaultValues: { days: 7, reason: "" },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await action.mutateAsync(values);
      toast.success(`Trial extended by ${values.days} day${values.days === 1 ? "" : "s"}`);
      form.reset();
      onOpenChange(false);
    } catch (error) {
      if (applyFieldErrors(error, form.setError, ["days", "reason"])) return;
      toast.error(errorMessage(error));
    }
  });
  return (
    <Dialog open={open} onOpenChange={(o) => !action.isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <form className="grid gap-4" onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Extend trial</DialogTitle>
            <DialogDescription>
              Adds days to the current trial end (or from today if it already ended).
            </DialogDescription>
          </DialogHeader>
          <FormField label="Days" error={form.formState.errors.days?.message} required>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              {...form.register("days", { valueAsNumber: true })}
            />
          </FormField>
          <FormField label="Reason" error={form.formState.errors.reason?.message} required>
            <Textarea rows={2} maxLength={500} {...form.register("reason")} />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={action.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={action.isPending}>
              {action.isPending && <Spinner decorative />}
              Extend trial
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Hook bundling the reason-based workspace actions. */
export function useReasonActions(workspaceId: string) {
  const status = useWorkspaceAction(
    workspaceId,
    (body: { status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED"; reason: string }) =>
      api.post(`/admin/workspaces/${workspaceId}/status`, body),
  );
  const cancel = useWorkspaceAction(workspaceId, (body: { reason: string }) =>
    api.post(`/admin/workspaces/${workspaceId}/subscription/cancel`, body),
  );
  const expire = useWorkspaceAction(workspaceId, (body: { reason: string }) =>
    api.post(`/admin/workspaces/${workspaceId}/subscription/expire`, body),
  );
  return { status, cancel, expire };
}

export type ReasonActionKind = "SUSPENDED" | "DEACTIVATED" | "ACTIVE" | "cancel" | "expire";

export function useReasonActionState() {
  return useState<ReasonActionKind | null>(null);
}

type OrganizationLimitForm = z.infer<typeof organizationLimitOverrideSchema>;

/** Per-organization workspace limit override (blank = the plan's rules apply). */
export function OrganizationLimitForm({
  workspaceId,
  organization,
}: {
  workspaceId: string;
  organization: AdminOrganizationDto;
}) {
  const action = useWorkspaceAction(workspaceId, (body: OrganizationLimitForm) =>
    api.patch<AdminOrganizationDto>(`/admin/organizations/${organization.id}`, body),
  );
  const form = useForm<OrganizationLimitForm>({
    resolver: zodResolver(organizationLimitOverrideSchema),
    values: { maxWorkspacesOverride: organization.maxWorkspacesOverride },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await action.mutateAsync(values);
      toast.success(
        values.maxWorkspacesOverride === null
          ? "Workspace limit override removed"
          : `Workspace limit set to ${values.maxWorkspacesOverride}`,
      );
    } catch (error) {
      if (applyFieldErrors(error, form.setError, ["maxWorkspacesOverride"])) return;
      toast.error(errorMessage(error));
    }
  });
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit} noValidate>
      <FormField
        label="Max workspaces override"
        description="Blank: plan rules apply (trial, monthly and grace allow 1)."
        error={form.formState.errors.maxWorkspacesOverride?.message}
        className="min-w-56"
      >
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={1000}
          placeholder="Plan rules"
          {...form.register("maxWorkspacesOverride", {
            setValueAs: (v: unknown) => (v === "" || v === null ? null : Number(v)),
          })}
        />
      </FormField>
      <Button type="submit" variant="outline" disabled={action.isPending}>
        {action.isPending && <Spinner decorative />}
        Save limit
      </Button>
    </form>
  );
}
