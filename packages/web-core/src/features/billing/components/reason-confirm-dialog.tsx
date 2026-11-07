"use client";

import { useState, type ReactNode } from "react";

import { voidSchema } from "@ros/contracts/billing";
import { ConfirmDialog } from "@ros/ui/shared/feedback";
import { FormField } from "@ros/ui/ui/form-field";
import { Textarea } from "@ros/ui/ui/textarea";
import { errorMessage } from "@ros/api-client";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  placeholder?: string;
  /** Receives the validated reason; a rejection is shown inside the dialog. */
  onConfirm: (reason: string) => Promise<void>;
}

/** Destructive confirmation that requires a reason (validated with the shared `voidSchema`). */
export function ReasonConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  placeholder,
  onConfirm,
}: Props) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setReason("");
      setError(null);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      destructive
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      pendingLabel={pendingLabel}
      getErrorMessage={errorMessage}
      onConfirm={async () => {
        const parsed = voidSchema.safeParse({ reason });
        if (!parsed.success) {
          const message = parsed.error.issues[0]?.message ?? "Give a reason";
          setError(message);
          throw new Error(message);
        }
        await onConfirm(parsed.data.reason);
      }}
    >
      <FormField label="Reason" required error={error ?? undefined}>
        <Textarea
          value={reason}
          maxLength={200}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError(null);
          }}
          placeholder={placeholder}
        />
      </FormField>
    </ConfirmDialog>
  );
}
