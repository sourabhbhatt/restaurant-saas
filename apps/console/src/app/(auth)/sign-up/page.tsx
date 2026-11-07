import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCardSkeleton } from "@ros/web-core/features/auth/auth-card";
import { SignUpForm } from "@ros/web-core/features/auth/sign-up-form";

export const metadata: Metadata = {
  title: "Start your free trial",
};

export default function Page() {
  // The form reads search params (?next, ?token), which requires a Suspense boundary.
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <SignUpForm />
    </Suspense>
  );
}
