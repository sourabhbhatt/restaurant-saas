"use client";

import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@ros/ui/ui/button";
import { Spinner } from "@ros/ui/ui/spinner";

/** Checks real connectivity first so "Try again" doesn't just show this page again. */
export function RetryButton() {
  const [checking, setChecking] = useState(false);
  const [stillOffline, setStillOffline] = useState(false);

  const retry = async () => {
    setChecking(true);
    setStillOffline(false);
    try {
      const res = await fetch("/api/v1/sync/ping", { cache: "no-store" });
      if (res.ok) {
        window.location.reload();
        return;
      }
      setStillOffline(true);
    } catch {
      setStillOffline(true);
    }
    setChecking(false);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={() => void retry()} disabled={checking}>
        {checking ? <Spinner decorative /> : <RefreshCwIcon aria-hidden="true" />}
        Try again
      </Button>
      <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
        {stillOffline ? "Still no connection. We'll keep your changes safe." : ""}
      </p>
    </div>
  );
}
