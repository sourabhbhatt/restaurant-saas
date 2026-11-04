import type { Metadata } from "next";

import { FaqPage } from "@/features/site/faq-page";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers about QR ordering, offline use, payments, trials and what is not supported yet.",
};

export default function Page() {
  return <FaqPage />;
}
