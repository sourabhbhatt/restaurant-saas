import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@ros/ui/ui/button";
import { SITE_NAV } from "@ros/web-core/features/site/brand";
import { StatusPage } from "@ros/web-core/features/site/status-page";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <StatusPage
      code="404"
      title="We couldn't find that page"
      description="The link may be broken, or the page may have moved. If you followed a table QR code, ask your server for help."
    >
      <Button asChild>
        <Link href="/">Go to the homepage</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/app">Open the app</Link>
      </Button>
      <nav aria-label="Site pages" className="basis-full">
        <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 pt-2 text-sm">
          {SITE_NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </StatusPage>
  );
}
