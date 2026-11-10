"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { Toaster } from "@ros/ui/ui/sonner";

export type ToastPosition =
  "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right";

/** Phone-first screens (guest menu, sign-in, waiter, cashier) show toasts at the top centre. */
const TOP_CENTER = [
  "/t",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/invite",
  "/waiter",
  "/cashier",
];

const under = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

/** Where toasts appear for a route; one container serves every page of an app. */
export function toastPosition(pathname: string, fallback: ToastPosition): ToastPosition {
  // The kitchen display keeps its header and ticket rail clear.
  if (under(pathname, "/kitchen")) return "bottom-center";
  if (TOP_CENTER.some((p) => under(pathname, p))) return "top-center";
  return fallback;
}

function PositionedToaster({ fallback }: { fallback: ToastPosition }) {
  const pathname = usePathname() ?? "/";
  return <Toaster position={toastPosition(pathname, fallback)} />;
}

/**
 * The app's only toast container, rendered by AppProviders. Pages call
 * `toast()` from `sonner` and never mount their own (a second container would
 * show every toast twice).
 */
export function GlobalToaster({
  defaultPosition = "top-right",
}: {
  defaultPosition?: ToastPosition;
}) {
  // usePathname() needs a Suspense boundary under cacheComponents.
  return (
    <Suspense fallback={null}>
      <PositionedToaster fallback={defaultPosition} />
    </Suspense>
  );
}
