import type { Metadata } from "next";

import { ContactPage } from "@ros/web-core/features/site/contact-page";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch about plans, onboarding or custom pricing.",
};

export default function Page() {
  return <ContactPage />;
}
