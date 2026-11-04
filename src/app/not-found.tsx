import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/features/site/status-page";

export const metadata: Metadata = {
  title: "Page not found",
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
    </StatusPage>
  );
}
