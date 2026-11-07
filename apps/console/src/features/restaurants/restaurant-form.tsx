"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "@ros/ui/ui/button";
import { FormField } from "@ros/ui/ui/form-field";
import { Input } from "@ros/ui/ui/input";
import { Spinner } from "@ros/ui/ui/spinner";
import { Textarea } from "@ros/ui/ui/textarea";
import { createRestaurantSchema, type CreateRestaurantInput } from "@ros/contracts/tenancy";
import { applyFieldErrors, errorMessage } from "@ros/api-client";

import { ImageUploadField } from "./image-upload-field";

type Output = z.output<typeof createRestaurantSchema>;

const FIELDS = [
  "name",
  "description",
  "cuisineTypes",
  "logoKey",
  "coverKey",
  "contactEmail",
  "contactPhone",
  "website",
  "brandColor",
] as const;

function CuisineInput({
  value,
  onChange,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange"> & {
  value: string[] | undefined;
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState((value ?? []).join(", "));
  return (
    <Input
      {...props}
      value={text}
      placeholder="e.g. North Indian, Chinese, Cafe"
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

export interface RestaurantFormProps {
  workspaceId: string;
  defaultValues?: Partial<CreateRestaurantInput>;
  submitLabel: string;
  onSubmit: (values: Output) => Promise<unknown>;
  onCancel?: () => void;
  /** Hide branding and contact fields (quick create). */
  compact?: boolean;
  extraActions?: React.ReactNode;
  /** Disable submit until something changed (edit forms). */
  requireDirty?: boolean;
}

/** Restaurant details form, shared by the create dialog, detail page and onboarding. */
export function RestaurantForm({
  workspaceId,
  defaultValues,
  submitLabel,
  onSubmit,
  onCancel,
  compact = false,
  extraActions,
  requireDirty = false,
}: RestaurantFormProps) {
  const form = useForm<CreateRestaurantInput, unknown, Output>({
    resolver: zodResolver(createRestaurantSchema),
    defaultValues: {
      name: "",
      description: "",
      cuisineTypes: [],
      contactEmail: "",
      contactPhone: "",
      website: "",
      brandColor: "",
      logoKey: null,
      coverKey: null,
      ...defaultValues,
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

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <FormField label="Restaurant name" error={errors.name?.message} required>
        <Input autoComplete="organization" {...register("name")} />
      </FormField>
      <FormField label="Description" error={errors.description?.message}>
        <Textarea rows={3} {...register("description")} />
      </FormField>
      <Controller
        control={control}
        name="cuisineTypes"
        render={({ field, fieldState }) => (
          <FormField
            label="Cuisines"
            description="Separate with commas."
            error={fieldState.error?.message ?? errors.cuisineTypes?.root?.message}
          >
            <CuisineInput value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
          </FormField>
        )}
      />
      {!compact && (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Controller
              control={control}
              name="logoKey"
              render={({ field }) => (
                <ImageUploadField
                  workspaceId={workspaceId}
                  purpose="logo"
                  label="Logo"
                  value={field.value}
                  onChange={(key) => field.onChange(key)}
                />
              )}
            />
            <Controller
              control={control}
              name="coverKey"
              render={({ field }) => (
                <ImageUploadField
                  workspaceId={workspaceId}
                  purpose="cover"
                  label="Cover image"
                  value={field.value}
                  onChange={(key) => field.onChange(key)}
                />
              )}
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Contact email" error={errors.contactEmail?.message}>
              <Input type="email" autoComplete="email" {...register("contactEmail")} />
            </FormField>
            <FormField label="Contact phone" error={errors.contactPhone?.message}>
              <Input type="tel" autoComplete="tel" {...register("contactPhone")} />
            </FormField>
            <FormField label="Website" error={errors.website?.message}>
              <Input inputMode="url" placeholder="example.com" {...register("website")} />
            </FormField>
            <Controller
              control={control}
              name="brandColor"
              render={({ field, fieldState }) => (
                <FormField
                  label="Brand colour"
                  description="Used on the customer menu."
                  error={fieldState.error?.message}
                >
                  {(controlProps) => (
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label="Pick brand colour"
                        className="h-10 w-12 shrink-0 cursor-pointer rounded-md border bg-transparent p-1 sm:h-9"
                        value={
                          /^#[0-9a-fA-F]{6}$/.test(field.value ?? "") ? field.value! : "#e4572e"
                        }
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                      <Input
                        {...controlProps}
                        placeholder="#E4572E"
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value)}
                        onBlur={field.onBlur}
                      />
                    </div>
                  )}
                </FormField>
              )}
            />
          </div>
        </>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {extraActions}
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
    </form>
  );
}
