import type { ReactNode } from "react";

import { Toaster } from "@ros/ui/ui/sonner";

/** Full-screen waiter console layout (not the dashboard shell). */
export default function WaiterLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster position="top-center" />
    </>
  );
}
