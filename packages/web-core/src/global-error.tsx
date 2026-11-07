"use client";

import Link from "next/link";

/**
 * Last-resort boundary that replaces the root layout when it fails. Kept
 * dependency-free (no providers, no app components) so it can always render.
 * Shows no error details.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest?: unknown }).digest ?? "")
      : "";

  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-background px-4 font-sans text-foreground antialiased">
        <title>Something went wrong · RestaurantOS</title>
        <main className="flex max-w-md flex-col items-center gap-5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="text-muted-foreground">
            The app hit an unexpected problem. Please try again — if it keeps happening, reload the
            page.
          </p>
          {digest && <p className="font-mono text-xs text-muted-foreground">Reference: {digest}</p>}
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => retry()}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Try again
            </button>
            <Link
              href="/"
              className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent"
            >
              Go to the homepage
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
