"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import {
  branchOverrideSchema,
  type BranchOverrideDto,
  type MenuItemDto,
} from "@/contracts/menu";
import { effectiveItemPrice } from "@/domain/menu/pricing";
import { formatMoney } from "@/domain/shared/money";
import { applyFieldErrors, errorMessage } from "@/lib/api-client";

import { MoneyInput } from "./menu-ui";
import { usePutOverride } from "./queries";

type Values = z.input<typeof branchOverrideSchema>;
type AvailabilityChoice = "inherit" | "on" | "off";

/**
 * Branch override editor: price / sale price / availability at one branch.
 * Empty price fields inherit the restaurant value.
 */
export function BranchPricingPanel({
  branchId,
  branchName,
  item,
  override,
  currency,
}: {
  branchId: string;
  branchName: string;
  item: MenuItemDto;
  override: BranchOverrideDto | null;
  currency: string;
}) {
  const put = usePutOverride(branchId);
  const form = useForm<Values>({
    resolver: zodResolver(branchOverrideSchema),
    defaultValues: {
      price: override?.price ?? null,
      discountedPrice: override?.discountedPrice ?? null,
      isAvailable: override?.isAvailable ?? null,
    },
  });
  const {
    control,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = form;

  const price = watch("price");
  const discounted = watch("discountedPrice");
  const isAvailable = watch("isAvailable");
  const effective = {
    price: typeof price === "number" ? price : item.price,
    discountedPrice: typeof discounted === "number" ? discounted : item.discountedPrice,
  };
  const effAvailable = isAvailable ?? item.isAvailable;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await put.mutateAsync({
        itemId: item.id,
        price: values.price ?? null,
        discountedPrice: values.discountedPrice ?? null,
        isAvailable: values.isAvailable ?? null,
      });
      form.reset({
        price: saved.price,
        discountedPrice: saved.discountedPrice,
        isAvailable: saved.isAvailable,
      });
      toast.success(`Saved ${branchName} pricing for ${item.name}`);
    } catch (error) {
      if (!applyFieldErrors(error, setError, ["price", "discountedPrice", "isAvailable"])) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    // Not a <form>: this panel renders inside the item editor's form.
    <div
      role="group"
      aria-label="Branch pricing"
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          void onSubmit();
        }
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-muted-foreground">
        Changes here apply only to <span className="font-medium text-foreground">{branchName}</span>.
        Leave a price empty to use the restaurant price.
      </p>
      {item.variants.length > 0 && (
        <Alert>
          <AlertDescription>
            This item has variants, which keep their own prices at every branch. The base price
            override applies only when a variant isn&apos;t used.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="price"
          render={({ field, fieldState }) => (
            <FormField
              label="Branch price"
              error={fieldState.error?.message}
              description={`Restaurant price: ${formatMoney(item.price, currency)}`}
            >
              <MoneyInput
                currency={currency}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                placeholder="Inherit"
              />
            </FormField>
          )}
        />
        <Controller
          control={control}
          name="discountedPrice"
          render={({ field, fieldState }) => (
            <FormField
              label="Branch sale price"
              error={fieldState.error?.message}
              description={
                item.discountedPrice !== null
                  ? `Restaurant sale price: ${formatMoney(item.discountedPrice, currency)}`
                  : "No restaurant sale price"
              }
            >
              <MoneyInput
                currency={currency}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                placeholder="Inherit"
              />
            </FormField>
          )}
        />
      </div>
      <Controller
        control={control}
        name="isAvailable"
        render={({ field }) => {
          const value: AvailabilityChoice =
            field.value === null || field.value === undefined ? "inherit" : field.value ? "on" : "off";
          return (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Availability at {branchName}</legend>
              <RadioGroup
                value={value}
                onValueChange={(v) =>
                  field.onChange(v === "inherit" ? null : v === "on")
                }
                className="gap-2"
              >
                {(
                  [
                    ["inherit", `Same as restaurant (${item.isAvailable ? "available" : "unavailable"})`],
                    ["on", "Available here"],
                    ["off", "Unavailable here"],
                  ] as const
                ).map(([v, label]) => (
                  <div key={v} className="flex items-center gap-2">
                    <RadioGroupItem value={v} id={`avail-${v}`} />
                    <Label htmlFor={`avail-${v}`} className="font-normal">
                      {label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              {errors.isAvailable?.message && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {errors.isAvailable.message}
                </p>
              )}
            </fieldset>
          );
        }}
      />
      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
        Guests at {branchName} see{" "}
        <span className="font-semibold tabular-nums">
          {formatMoney(effectiveItemPrice(effective), currency)}
        </span>{" "}
        · {effAvailable ? "available" : "unavailable"}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={() => form.reset({ price: null, discountedPrice: null, isAvailable: null }, { keepDefaultValues: true })}
        >
          Reset to restaurant values
        </Button>
        <Button type="button" disabled={isSubmitting || !isDirty} onClick={() => void onSubmit()}>
          {isSubmitting && <Spinner decorative />}
          Save branch pricing
        </Button>
      </div>
    </div>
  );
}
