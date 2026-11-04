"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

const FALLBACK_ERROR = "Something went wrong. Please try again.";

function defaultGetErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : FALLBACK_ERROR;
}

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Extra content between the description and the buttons. */
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Label for the confirm button while `onConfirm` is running. */
  pendingLabel?: string;
  destructive?: boolean;
  /**
   * Runs on confirm. If it returns a promise the dialog shows a pending state and
   * closes only when it resolves; a rejection is shown inside the dialog.
   */
  onConfirm: () => void | Promise<void>;
  /** Turn a thrown value into a user-facing message. Defaults to `Error.message`. */
  getErrorMessage?: (error: unknown) => string;
};

/** Controlled confirmation dialog with async confirm, pending and error states. */
function ConfirmDialog({ open, onOpenChange, ...props }: ConfirmDialogProps) {
  // Remount the body on every open so pending/error state never leaks between uses,
  // while keeping it mounted during the close animation.
  const [session, setSession] = React.useState(0);
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setSession((s) => s + 1);
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <ConfirmDialogBody key={session} onOpenChange={onOpenChange} {...props} />
    </AlertDialog>
  );
}

function ConfirmDialogBody({
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  pendingLabel,
  destructive = false,
  onConfirm,
  getErrorMessage = defaultGetErrorMessage,
}: Omit<ConfirmDialogProps, "open">) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleConfirm = async (event: React.MouseEvent) => {
    // Keep the dialog open until the action settles.
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await onConfirm();
      if (mounted.current) {
        setPending(false);
        onOpenChange(false);
      }
    } catch (caught) {
      if (mounted.current) {
        setPending(false);
        setError(getErrorMessage(caught));
      }
    }
  };

  return (
    <AlertDialogContent
      aria-busy={pending || undefined}
      onEscapeKeyDown={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {description ? (
          <AlertDialogDescription>{description}</AlertDialogDescription>
        ) : (
          <AlertDialogDescription className="sr-only">{title}</AlertDialogDescription>
        )}
      </AlertDialogHeader>
      {children}
      {error && (
        <Alert variant="destructive" data-slot="confirm-dialog-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
        <AlertDialogAction
          onClick={handleConfirm}
          disabled={pending}
          className={cn(destructive && buttonVariants({ variant: "destructive" }))}
        >
          {pending && <Spinner decorative />}
          {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

export { ConfirmDialog };
export type { ConfirmDialogProps };
