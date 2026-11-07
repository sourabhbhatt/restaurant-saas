import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCardSkeleton } from "@ros/web-core/features/auth/auth-card";
import { SignInForm } from "@ros/web-core/features/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

/** Each app has its own session cookie, so staff sign in here, not on the console. */
export default function Page() {
  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <SignInForm fallback="/" />
    </Suspense>
  );
}
