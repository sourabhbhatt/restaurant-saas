import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order at your table",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Customer QR layout: no dashboard chrome, mobile-first; toasts at the top (global container). */
export default function CustomerLayout({ children }: LayoutProps<"/t/[token]">) {
  return children;
}
