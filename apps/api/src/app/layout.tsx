import type { ReactNode } from "react";

/** Next.js requires a root layout; the API serves no pages. */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
