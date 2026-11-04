"use client";

import * as React from "react";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/** Props a form control needs so assistive tech can link it to its label, hint and error. */
type FormFieldControlProps = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
  "aria-required": true | undefined;
};

type FormFieldProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  /** Helper text shown under the control. */
  description?: React.ReactNode;
  /** Validation message (e.g. `errors.email?.message`). Presence marks the control invalid. */
  error?: React.ReactNode;
  required?: boolean;
  /** Control id; generated when omitted. */
  id?: string;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
  /** Extra element rendered next to the label (e.g. a "Forgot password?" link). */
  labelAction?: React.ReactNode;
  /**
   * The control. Either a single element (props are merged onto it, works with
   * `<Input {...register("email")} />`) or a render function that receives the
   * wiring props (handy for `Controller` and composite controls such as Select,
   * where the props belong on `SelectTrigger`).
   */
  children: React.ReactElement | ((controlProps: FormFieldControlProps) => React.ReactNode);
};

/**
 * Label + control + description + error, with `aria-invalid` and `aria-describedby` wired up.
 *
 * @example
 * <FormField label="Email" error={errors.email?.message} required>
 *   <Input type="email" {...register("email")} />
 * </FormField>
 *
 * @example
 * <Controller name="role" control={control} render={({ field, fieldState }) => (
 *   <FormField label="Role" error={fieldState.error?.message}>
 *     {(controlProps) => (
 *       <Select value={field.value} onValueChange={field.onChange}>
 *         <SelectTrigger {...controlProps}><SelectValue /></SelectTrigger>
 *         ...
 *       </Select>
 *     )}
 *   </FormField>
 * )} />
 */
function FormField({
  label,
  description,
  error,
  required,
  id,
  hideLabel,
  labelAction,
  className,
  children,
  ...props
}: FormFieldProps) {
  const generatedId = React.useId();
  const controlId = id ?? `field-${generatedId}`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const hasError = error != null && error !== false && error !== "";

  const describedBy =
    [description ? descriptionId : null, hasError ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  const controlProps: FormFieldControlProps = {
    id: controlId,
    "aria-invalid": hasError ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": required ? true : undefined,
  };

  return (
    <div
      data-slot="form-field"
      data-invalid={hasError || undefined}
      className={cn("group/field grid gap-2", className)}
      {...props}
    >
      <div className={cn("flex items-center justify-between gap-2", hideLabel && "sr-only")}>
        <Label htmlFor={controlId} className="group-data-[invalid=true]/field:text-destructive">
          {label}
          {required && (
            <span aria-hidden="true" className="text-destructive">
              *
            </span>
          )}
        </Label>
        {labelAction}
      </div>
      {typeof children === "function" ? (
        children(controlProps)
      ) : (
        <Slot.Root data-slot="form-field-control" {...controlProps}>
          {children}
        </Slot.Root>
      )}
      {description && (
        <p
          id={descriptionId}
          data-slot="form-field-description"
          className="text-sm text-muted-foreground"
        >
          {description}
        </p>
      )}
      {hasError && (
        <p
          id={errorId}
          data-slot="form-field-error"
          role="alert"
          className="text-sm font-medium text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export { FormField };
export type { FormFieldControlProps, FormFieldProps };
