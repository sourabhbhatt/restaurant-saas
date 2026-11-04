import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/sonner";

/** Full-screen kitchen display layout (not the dashboard shell). */
export default function KitchenLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="bottom-center" richColors />
    </>
  );
}
