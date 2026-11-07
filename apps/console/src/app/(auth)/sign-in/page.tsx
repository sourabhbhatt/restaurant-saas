import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCardSkeleton } from "@ros/web-core/features/auth/auth-card";
import { SignInForm } from "@ros/web-core/features/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function Page() {
  // The form reads search params (?next, ?token), which requires a Suspense boundary.
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <SignInForm />
    </Suspense>
  );
}
