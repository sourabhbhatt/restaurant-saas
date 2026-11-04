import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCardSkeleton } from "@/features/auth/auth-card";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

export const metadata: Metadata = {
  title: "Reset password",
  robots: { index: false },
};

export default function Page() {
  // The form reads search params (?next, ?token), which requires a Suspense boundary.
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
