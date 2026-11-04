import type { Metadata } from "next";

import { DevMailbox } from "@/features/site/dev-mailbox/dev-mailbox";

export const metadata: Metadata = {
  title: "Dev mailbox",
  robots: { index: false, follow: false },
};

export default function DevMailboxPage() {
  return <DevMailbox />;
}
