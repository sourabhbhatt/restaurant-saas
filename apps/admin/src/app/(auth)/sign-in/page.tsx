import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCardSkeleton } from "@ros/web-core/features/auth/auth-card";
import { SignInForm } from "@ros/web-core/features/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

/** The admin origin has its own session cookie; platform admins sign in here. */
export default function Page() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <SignInForm fallback="/admin" />
    </Suspense>
  );
}
