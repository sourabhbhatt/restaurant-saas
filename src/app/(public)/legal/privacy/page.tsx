import type { Metadata } from "next";

import { PrivacyPolicy } from "@/features/site/legal/privacy";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "How personal data is collected, used, retained and deleted.",
};

export default function Page() {
  return <PrivacyPolicy />;
}
