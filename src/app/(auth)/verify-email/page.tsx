import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCardSkeleton } from "@/features/auth/auth-card";
import { VerifyEmail } from "@/features/auth/verify-email";

export const metadata: Metadata = {
  title: "Verify email",
  robots: { index: false },
};

export default function Page() {
  // The form reads search params (?next, ?token), which requires a Suspense boundary.
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <VerifyEmail />
    </Suspense>
  );
}
