import type { Metadata } from "next";

import { AuthGate } from "@ros/web-core/features/session/auth-gate";

export const metadata: Metadata = { title: "Print QR codes", robots: { index: false } };

/** Minimal print layout: no dashboard chrome, signed-in only. */
export default function PrintTablesLayout({ children }: LayoutProps<"/print/tables">) {
  return <AuthGate>{children}</AuthGate>;
}
