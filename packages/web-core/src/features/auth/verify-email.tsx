"use client";

import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { BadgeCheckIcon, MailWarningIcon } from "lucide-react";

import { Button } from "@ros/ui/ui/button";
import { Spinner } from "@ros/ui/ui/spinner";
import { verifyEmailSchema } from "@ros/contracts/auth";
import { sessionKeys, useMe } from "../session/queries";
import { api, errorMessage } from "@ros/api-client";

import { AuthCard } from "./auth-card";

export function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const valid = verifyEmailSchema.safeParse({ token }).success;
  const qc = useQueryClient();
  const started = useRef(false);

  const verify = useMutation({
    mutationFn: () => api.post("/auth/verify-email", { token }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: sessionKeys.me }),
  });
  const { mutate } = verify;

  useEffect(() => {
    // Tokens are single-use: post exactly once, even under StrictMode's double effects.
    if (!valid || started.current) return;
    started.current = true;
    mutate();
  }, [valid, mutate]);

  if (verify.isSuccess) {
    return (
      <AuthCard
        icon={<BadgeCheckIcon />}
        title="Email verified"
        description="Thanks — your email address is confirmed."
      >
        <Button asChild size="lg">
          <Link href="/app">Continue to the app</Link>
        </Button>
      </AuthCard>
    );
  }

  if (!valid || verify.isError) {
    return <VerifyFailed message={verify.isError ? errorMessage(verify.error) : null} />;
  }

  return (
    <AuthCard title="Verifying your email…" description="This only takes a second.">
      <div
        role="status"
        className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
      >
        <Spinner decorative />
        Checking your link
      </div>
    </AuthCard>
  );
}

function VerifyFailed({ message }: { message: string | null }) {
  const me = useMe();
  const resend = useMutation({
    mutationFn: () => api.post("/auth/resend-verification"),
    onSuccess: () => toast.success("Verification email sent", { description: "Check your inbox." }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const canResend = me.isSuccess && !me.data.user.emailVerified;

  return (
    <AuthCard
      icon={<MailWarningIcon />}
      title="We couldn't verify your email"
      description={message ?? "This verification link is invalid or has expired."}
    >
      <div role="alert" className="flex flex-col gap-2">
        {canResend && (
          <Button
            size="lg"
            onClick={() => resend.mutate()}
            disabled={resend.isPending || resend.isSuccess}
          >
            {resend.isPending && <Spinner decorative />}
            {resend.isSuccess ? "Email sent" : "Send a new verification email"}
          </Button>
        )}
        {me.isSuccess && me.data.user.emailVerified && (
          <p className="text-center text-sm text-muted-foreground">
            Good news: your email is already verified.
          </p>
        )}
        <Button asChild size="lg" variant={canResend ? "outline" : "default"}>
          <Link href="/app">Go to the app</Link>
        </Button>
        {me.isError && (
          <p className="text-center text-sm text-muted-foreground">
            Sign in to request a new verification email.
          </p>
        )}
      </div>
    </AuthCard>
  );
}
