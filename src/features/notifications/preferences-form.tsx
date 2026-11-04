"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { ErrorState, PageSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  NOTIFICATION_TYPE_LABELS,
  updateNotificationPreferencesSchema,
  type NotificationPreferenceDto,
} from "@/contracts/notifications-api";
import { applyFieldErrors, errorMessage } from "@/lib/api-client";

import { PushOptIn } from "./push-opt-in";
import {
  useNotificationPreferences,
  usePushConfig,
  useUpdateNotificationPreferences,
} from "./queries";

type FormInput = z.input<typeof updateNotificationPreferencesSchema>;
type FormOutput = z.output<typeof updateNotificationPreferencesSchema>;
type Channel = "inApp" | "email" | "push";

const CHANNEL_LABELS: Record<Channel, string> = {
  inApp: "In app",
  email: "Email",
  push: "Browser push",
};

export function NotificationPreferences() {
  const prefs = useNotificationPreferences();
  if (prefs.isPending) return <PageSkeleton variant="list" count={6} />;
  if (prefs.isError) {
    return (
      <ErrorState
        title="Couldn't load your preferences"
        message={errorMessage(prefs.error)}
        onRetry={() => void prefs.refetch()}
        retrying={prefs.isFetching}
      />
    );
  }
  // Remount with fresh defaults whenever the saved preferences change.
  return <PreferencesForm key={JSON.stringify(prefs.data)} initial={prefs.data} />;
}

function PreferencesForm({ initial }: { initial: NotificationPreferenceDto[] }) {
  const update = useUpdateNotificationPreferences();
  const push = usePushConfig();
  // Push is shown only when a provider is configured; otherwise it would be a fake setting.
  const channels: Channel[] = push.data?.enabled ? ["inApp", "email", "push"] : ["inApp", "email"];

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(updateNotificationPreferencesSchema),
    defaultValues: { preferences: initial },
  });
  const {
    control,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await update.mutateAsync(values.preferences);
      toast.success("Notification preferences saved");
    } catch (error) {
      if (applyFieldErrors(error, setError, ["preferences"])) return;
      toast.error(errorMessage(error));
    }
  });

  const rootError = errors.preferences?.message ?? errors.preferences?.root?.message;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[22rem] text-sm">
          <caption className="sr-only">Notification channels per type</caption>
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">
                Notification
              </th>
              {channels.map((channel) => (
                <th key={channel} scope="col" className="w-24 px-2 py-3 text-center font-medium">
                  {CHANNEL_LABELS[channel]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {initial.map((pref, index) => (
              <tr key={pref.type}>
                <th scope="row" className="px-4 py-3 text-left font-medium">
                  {NOTIFICATION_TYPE_LABELS[pref.type]}
                </th>
                {channels.map((channel) => (
                  <td key={channel} className="px-2 py-3 text-center">
                    <Controller
                      control={control}
                      name={`preferences.${index}.${channel}`}
                      render={({ field, fieldState }) => (
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          aria-invalid={fieldState.invalid || undefined}
                          aria-label={`${CHANNEL_LABELS[channel]}: ${NOTIFICATION_TYPE_LABELS[pref.type]}`}
                        />
                      )}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rootError && (
        <p role="alert" className="text-sm text-destructive">
          {rootError}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Turning off “In app” stops new notifications of that type from appearing here. Orders and
        bill requests still show on the waiter and cashier screens.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={update.isPending || !isDirty}>
          {update.isPending && <Spinner decorative />}
          {update.isPending ? "Saving…" : "Save preferences"}
        </Button>
        {isDirty && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => reset({ preferences: initial })}
            disabled={update.isPending}
          >
            Reset
          </Button>
        )}
        <PushOptIn className="sm:ml-auto" />
      </div>
    </form>
  );
}
