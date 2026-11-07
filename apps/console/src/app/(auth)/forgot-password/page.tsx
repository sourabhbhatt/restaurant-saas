import type { Metadata } from "next";

import { ForgotPasswordForm } from "@ros/web-core/features/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password",
};

export default function Page() {
  return <ForgotPasswordForm />;
}
