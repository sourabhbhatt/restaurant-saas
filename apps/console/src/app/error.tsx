"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RefreshCwIcon } from "lucide-react";

import { Button } from "@ros/ui/ui/button";
import { StatusPage } from "@ros/web-core/features/site/status-page";

function digestOf(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const d = (error as { digest?: unknown }).digest;
    return typeof d === "string" && d ? d : undefined;
  }
  return undefined;
}

/**
 * Route-level error boundary. Never renders the error message or stack — only
 * the digest, which support can match against server logs.
 */
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = digestOf(error);

  return (
    <StatusPage
      title="Something went wrong"
      description={
        <>
          <p>An unexpected error stopped this page from loading. Please try again.</p>
          {digest && <p className="mt-2 font-mono text-xs">Reference: {digest}</p>}
        </>
      }
    >
      <Button onClick={() => retry()}>
        <RefreshCwIcon aria-hidden="true" />
        Try again
      </Button>
      <Button asChild variant="outline">
        <Link href="/">Go to the homepage</Link>
      </Button>
    </StatusPage>
  );
}
