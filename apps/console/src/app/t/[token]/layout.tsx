import type { Metadata } from "next";

import { Toaster } from "@ros/ui/ui/sonner";

export const metadata: Metadata = {
  title: "Order at your table",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Customer QR layout: no dashboard chrome, mobile-first, its own toast host. */
export default function CustomerLayout({ children }: LayoutProps<"/t/[token]">) {
  return (
    <>
      {children}
      <Toaster position="top-center" />
    </>
  );
}
