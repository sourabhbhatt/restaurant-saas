import type { Metadata } from "next";

import { OpsHome } from "@/features/home/ops-home";

export const metadata: Metadata = { title: "My consoles" };

export default function HomePage() {
  return <OpsHome />;
}
