"use client";

import { useState } from "react";
import { toast } from "sonner";

import { ErrorState, PageHeader, PageSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { PlatformSettings } from "@/domain/platform/settings";
import { errorMessage } from "@/lib/api-client";
import { useAction } from "@/lib/use-action";

import { useAdminSettings, useSaveSettings } from "./queries";

const selectClass = "border-input bg-background h-10 w-full rounded-md border px-3 text-sm";

function Form({
  initial,
  plans,
}: {
  initial: PlatformSettings;
  plans: { key: string; name: string }[];
}) {
  const save = useSaveSettings();
  const [s, setS] = useState({ ...initial, reminders: initial.trialReminderDays.join(", ") });
  const { pending, run, err } = useAction();
  return (
    <Card>
      <CardContent className="pt-6">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const { reminders, ...rest } = s;
            const body: PlatformSettings = {
              ...rest,
              trialDays: Number(s.trialDays),
              graceDays: Number(s.graceDays),
              fairUseMaxWorkspaces: Number(s.fairUseMaxWorkspaces),
              workspaceCreatesPerDay: Number(s.workspaceCreatesPerDay),
              trialReminderDays: reminders
                .split(",")
                .map((x) => Number(x.trim()))
                .filter((n) => Number.isInteger(n) && n > 0),
            };
            if (await run(() => save.mutateAsync(body))) toast.success("Settings saved");
          }}
        >
          <FormField label="Trial length (days)" error={err("trialDays")}>
            <Input
              inputMode="numeric"
              value={s.trialDays}
              onChange={(e) => setS({ ...s, trialDays: e.target.value as unknown as number })}
            />
          </FormField>
          <FormField label="Grace period (days)" error={err("graceDays")}>
            <Input
              inputMode="numeric"
              value={s.graceDays}
              onChange={(e) => setS({ ...s, graceDays: e.target.value as unknown as number })}
            />
          </FormField>
          <FormField label="Fair-use workspace cap" error={err("fairUseMaxWorkspaces")}>
            <Input
              inputMode="numeric"
              value={s.fairUseMaxWorkspaces}
              onChange={(e) =>
                setS({ ...s, fairUseMaxWorkspaces: e.target.value as unknown as number })
              }
            />
          </FormField>
          <FormField
            label="New workspaces per day (per owner)"
            error={err("workspaceCreatesPerDay")}
          >
            <Input
              inputMode="numeric"
              value={s.workspaceCreatesPerDay}
              onChange={(e) =>
                setS({ ...s, workspaceCreatesPerDay: e.target.value as unknown as number })
              }
            />
          </FormField>
          <FormField label="Trial plan" error={err("trialPlanKey")}>
            <select
              className={selectClass}
              value={s.trialPlanKey}
              onChange={(e) => setS({ ...s, trialPlanKey: e.target.value })}
            >
              {plans.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="After grace period" error={err("restrictedMode")}>
            <select
              className={selectClass}
              value={s.restrictedMode}
              onChange={(e) =>
                setS({ ...s, restrictedMode: e.target.value as PlatformSettings["restrictedMode"] })
              }
            >
              <option value="READ_ONLY">Read-only</option>
              <option value="NONE">No access</option>
            </select>
          </FormField>
          <FormField label="Trial reminder days (comma separated)" error={err("trialReminderDays")}>
            <Input
              value={s.reminders}
              onChange={(e) => setS({ ...s, reminders: e.target.value })}
            />
          </FormField>
          <FormField label="Default currency" error={err("defaultCurrency")}>
            <Input
              value={s.defaultCurrency}
              maxLength={3}
              onChange={(e) => setS({ ...s, defaultCurrency: e.target.value.toUpperCase() })}
            />
          </FormField>
          <FormField label="Product name" error={err("productName")}>
            <Input
              value={s.productName}
              onChange={(e) => setS({ ...s, productName: e.target.value })}
            />
          </FormField>
          <FormField label="Support email" error={err("supportEmail")}>
            <Input
              type="email"
              value={s.supportEmail}
              onChange={(e) => setS({ ...s, supportEmail: e.target.value })}
            />
          </FormField>
          <label className="flex items-center justify-between gap-4 sm:col-span-2">
            <span className="text-sm font-medium">Allow new sign-ups</span>
            <Switch
              checked={s.signupsEnabled}
              onCheckedChange={(v) => setS({ ...s, signupsEnabled: v })}
              aria-label="Allow new sign-ups"
            />
          </label>
          <label className="flex items-center justify-between gap-4 sm:col-span-2">
            <span className="text-sm font-medium">Maintenance mode</span>
            <Switch
              checked={s.maintenanceMode}
              onCheckedChange={(v) => setS({ ...s, maintenanceMode: v })}
              aria-label="Maintenance mode"
            />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** /admin/settings */
export function AdminSettingsPage() {
  const q = useAdminSettings();
  if (q.isPending) return <PageSkeleton variant="detail" />;
  if (q.isError)
    return (
      <ErrorState
        title="Couldn't load settings"
        message={errorMessage(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Platform settings"
        description="Trial length, grace period and platform defaults. Applies to new trials immediately."
      />
      <Form initial={q.data.settings} plans={q.data.plans} />
    </div>
  );
}
