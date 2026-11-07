"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ArrowLeftIcon, MailCheckIcon } from "lucide-react";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { forgotPasswordSchema } from "@ros/contracts/auth";
import { api, applyFieldErrors, errorMessage } from "@/lib/api-client";

import { AuthCard } from "./auth-card";

type Values = z.input<typeof forgotPasswordSchema>;
type Output = z.output<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<Values, unknown, Output>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });
  const mutation = useMutation({
    mutationFn: (body: Output) => api.post("/auth/forgot-password", body),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync(values);
      // Same message whether or not an account exists (no account enumeration).
      setSentTo(values.email);
    } catch (error) {
      if (applyFieldErrors(error, form.setError, ["email"])) return;
      toast.error(errorMessage(error));
    }
  });

  if (sentTo) {
    return (
      <AuthCard
        icon={<MailCheckIcon />}
        title="Check your email"
        description={
          <>
            If an account exists for <span className="font-medium text-foreground">{sentTo}</span>,
            we&apos;ve sent a link to reset your password. The link expires soon, so use it
            promptly. Don&apos;t forget to check your spam folder.
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <Button asChild size="lg">
            <Link href="/sign-in">Back to sign in</Link>
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSentTo(null);
              mutation.reset();
            }}
          >
            Use a different email
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      description="Enter the email you sign in with and we'll send you a link to set a new password."
      footer={
        <Link
          href="/sign-in"
          className="inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
          Back to sign in
        </Link>
      }
    >
      <form
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-5"
        aria-busy={mutation.isPending}
      >
        <FormField label="Email" error={form.formState.errors.email?.message} required>
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@restaurant.com"
            {...form.register("email")}
          />
        </FormField>
        <Button type="submit" size="lg" disabled={mutation.isPending}>
          {mutation.isPending && <Spinner decorative />}
          {mutation.isPending ? "Sending link…" : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  );
}
