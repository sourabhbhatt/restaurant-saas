"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "@ros/ui/ui/button";
import { FormField } from "@ros/ui/ui/form-field";
import { Input } from "@ros/ui/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import { Spinner } from "@ros/ui/ui/spinner";
import { createBranchSchema, type CreateBranchInput } from "@ros/contracts/tenancy";
import { SUPPORTED_CURRENCIES } from "@ros/domain/shared/money";
import { applyFieldErrors, errorMessage } from "@ros/api-client";

import { BusinessHoursEditor, normaliseHours } from "./business-hours-editor";

type Output = z.output<typeof createBranchSchema>;

const FIELDS = [
  "name",
  "code",
  "addressLine1",
  "addressLine2",
  "city",
  "state",
  "postalCode",
  "country",
  "phone",
  "email",
  "timezone",
  "currency",
  "businessHours",
] as const;

const FALLBACK_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "UTC",
];

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return FALLBACK_ZONES;
  }
}

export interface BranchFormProps {
  defaultValues?: Partial<CreateBranchInput>;
  submitLabel: string;
  onSubmit: (values: Output) => Promise<unknown>;
  onCancel?: () => void;
  /** Show the business hours editor (hidden in quick-create). */
  showHours?: boolean;
  showDetails?: boolean;
  requireDirty?: boolean;
  disabled?: boolean;
}

/** Branch details form, shared by the create dialog, branch settings and onboarding. */
export function BranchForm({
  defaultValues,
  submitLabel,
  onSubmit,
  onCancel,
  showHours = true,
  showDetails = true,
  requireDirty = false,
  disabled = false,
}: BranchFormProps) {
  const zones = useMemo(() => timeZones(), []);
  const form = useForm<CreateBranchInput, unknown, Output>({
    resolver: zodResolver(createBranchSchema),
    defaultValues: {
      name: "",
      code: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "IN",
      phone: "",
      email: "",
      timezone: "Asia/Kolkata",
      currency: "INR",
      ...defaultValues,
      businessHours: normaliseHours(defaultValues?.businessHours),
    },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = form;

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(values);
      form.reset(form.getValues());
    } catch (error) {
      if (!applyFieldErrors(error, setError, FIELDS)) toast.error(errorMessage(error));
    }
  });

  const hourErrors: Record<number, string | undefined> = {};
  if (Array.isArray(errors.businessHours)) {
    errors.businessHours.forEach((e, i) => {
      if (e) hourErrors[i] = e.close?.message ?? e.open?.message ?? e.message;
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <fieldset disabled={disabled} className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
          <FormField label="Branch name" error={errors.name?.message} required>
            <Input placeholder="e.g. Indiranagar" {...register("name")} />
          </FormField>
          <FormField
            label="Code"
            description="Auto-generated if empty."
            error={errors.code?.message}
          >
            <Input className="uppercase" maxLength={20} {...register("code")} />
          </FormField>
        </div>
        {showDetails && (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Address line 1" error={errors.addressLine1?.message}>
                <Input autoComplete="address-line1" {...register("addressLine1")} />
              </FormField>
              <FormField label="Address line 2" error={errors.addressLine2?.message}>
                <Input autoComplete="address-line2" {...register("addressLine2")} />
              </FormField>
              <FormField label="City" error={errors.city?.message}>
                <Input autoComplete="address-level2" {...register("city")} />
              </FormField>
              <FormField label="State / region" error={errors.state?.message}>
                <Input autoComplete="address-level1" {...register("state")} />
              </FormField>
              <FormField label="Postal code" error={errors.postalCode?.message}>
                <Input autoComplete="postal-code" {...register("postalCode")} />
              </FormField>
              <FormField
                label="Country"
                description="2-letter code, e.g. IN"
                error={errors.country?.message}
              >
                <Input className="uppercase" maxLength={2} {...register("country")} />
              </FormField>
              <FormField label="Phone" error={errors.phone?.message}>
                <Input type="tel" autoComplete="tel" {...register("phone")} />
              </FormField>
              <FormField label="Email" error={errors.email?.message}>
                <Input type="email" autoComplete="email" {...register("email")} />
              </FormField>
            </div>
          </>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Time zone" error={errors.timezone?.message} required>
            {(controlProps) => (
              <>
                <Input {...controlProps} list="branch-timezones" {...register("timezone")} />
                <datalist id="branch-timezones">
                  {zones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </>
            )}
          </FormField>
          <Controller
            control={control}
            name="currency"
            render={({ field, fieldState }) => (
              <FormField label="Currency" error={fieldState.error?.message} required>
                {(controlProps) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
                    <SelectTrigger {...controlProps} className="w-full">
                      <SelectValue placeholder="Choose currency" />
                    </SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((cur) => (
                        <SelectItem key={cur} value={cur}>
                          {cur}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            )}
          />
        </div>
        {showHours && (
          <Controller
            control={control}
            name="businessHours"
            render={({ field }) => (
              <BusinessHoursEditor
                value={field.value}
                onChange={field.onChange}
                errors={hourErrors}
                disabled={disabled}
              />
            )}
          />
        )}
      </fieldset>
      {!disabled && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" disabled={isSubmitting || (requireDirty && !isDirty)}>
            {isSubmitting && <Spinner decorative />}
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
