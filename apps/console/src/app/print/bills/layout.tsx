import type { Metadata } from "next";

import { AuthGate } from "@ros/web-core/features/session/auth-gate";

export const metadata: Metadata = { title: "Print receipt", robots: { index: false } };

// AuthGate renders a skeleton instead of {children} on the server, so the page segment cannot be prerendered for validation.
export const instant = false;

/** Minimal print layout: no dashboard chrome, signed-in only. */
export default function PrintBillsLayout({ children }: LayoutProps<"/print/bills">) {
  return <AuthGate>{children}</AuthGate>;
}
