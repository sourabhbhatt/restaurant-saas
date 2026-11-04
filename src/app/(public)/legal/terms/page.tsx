import type { Metadata } from "next";

import { TermsOfService } from "@/features/site/legal/terms";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms for using the service.",
};

export default function Page() {
  return <TermsOfService />;
}
