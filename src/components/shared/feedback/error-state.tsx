"use client";

import type * as React from "react";
import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type ErrorStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  title?: React.ReactNode;
  /** User-facing explanation. Never pass raw error messages or stack traces here. */
  message?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  /**
   * The caught error (e.g. from an `error.tsx` boundary). Only its `digest` is shown, as a
   * support reference; its message and stack are never rendered.
   */
  error?: unknown;
  size?: "default" | "compact";
};

function getDigest(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const digest = (error as { digest?: unknown }).digest;
    return typeof digest === "string" && digest !== "" ? digest : undefined;
  }
  return undefined;
}

function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this right now. Please try again in a moment.",
  onRetry,
  retryLabel = "Try again",
  retrying = false,
  error,
  size = "default",
  className,
  ...props
}: ErrorStateProps) {
  const digest = getDigest(error);

  return (
    <div
      data-slot="error-state"
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center text-balance",
        size === "default"
          ? "rounded-xl border border-destructive/20 bg-destructive/[0.03] px-6 py-12"
          : "px-4 py-8",
        className,
      )}
      {...props}
    >
      <div
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
      >
        <TriangleAlertIcon className="size-6" />
      </div>
      <div className="flex max-w-sm flex-col gap-1">
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{message}</p>
        {digest && (
          <p className="mt-1 font-mono text-xs text-muted-foreground">Reference: {digest}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="outline" onClick={onRetry} disabled={retrying} className="mt-2">
          {retrying ? <Spinner decorative /> : <RefreshCwIcon aria-hidden="true" />}
          {retryLabel}
        </Button>
      )}
    </div>
  );
}

export { ErrorState };
export type { ErrorStateProps };
