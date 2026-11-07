"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { Button } from "@ros/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ros/ui/ui/dialog";
import { FormField } from "@ros/ui/ui/form-field";
import { Spinner } from "@ros/ui/ui/spinner";
import { Textarea } from "@ros/ui/ui/textarea";
import { orderTransitionSchema } from "@ros/contracts/orders";
import { PRESET_REJECTION_REASONS } from "@ros/contracts/staff-ops";
import { cn } from "@ros/ui/utils";

const reasonSchema = z.object({
  reason: orderTransitionSchema.shape.reason.unwrap().min(3, "Give a short reason (3+ characters)"),
});
type ReasonForm = z.infer<typeof reasonSchema>;

/**
 * Reason dialog for reject / cancel: preset chips plus free text. The parent
 * runs the mutation; the dialog stays open (and disabled) while it is pending.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  presets = PRESET_REJECTION_REASONS,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  presets?: readonly string[];
  pending: boolean;
  onSubmit: (reason: string) => void;
}) {
  const form = useForm<ReasonForm>({
    resolver: zodResolver(reasonSchema),
    defaultValues: { reason: "" },
  });
  const value = useWatch({ control: form.control, name: "reason" });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) form.reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={form.handleSubmit((v) => onSubmit(v.reason.trim()))}
          noValidate
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Common reasons">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => form.setValue("reason", p, { shouldValidate: true })}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  value === p && "border-primary bg-primary/10 text-primary",
                )}
                aria-pressed={value === p}
              >
                {p}
              </button>
            ))}
          </div>
          <FormField label="Reason" error={form.formState.errors.reason?.message} required>
            <Textarea
              rows={3}
              maxLength={300}
              placeholder="Tell the guest why"
              {...form.register("reason")}
            />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Back
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Spinner decorative />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
