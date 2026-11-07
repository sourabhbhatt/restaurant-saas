import type { Metadata } from "next";

import { RefundPolicy } from "@ros/web-core/features/site/legal/refunds";

export const metadata: Metadata = {
  title: "Cancellation & refund policy",
  description: "How subscription cancellation and refunds work.",
};

export default function Page() {
  return <RefundPolicy />;
}
