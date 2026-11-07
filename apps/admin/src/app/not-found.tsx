import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@ros/ui/ui/button";
import { StatusPage } from "@ros/web-core/features/site/status-page";

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
        <Link href="/admin">Go to the admin overview</Link>
      </Button>
    </StatusPage>
  );
}
