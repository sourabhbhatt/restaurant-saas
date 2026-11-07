"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";
import type { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { signInSchema, type SignInInput } from "@ros/contracts/auth";
import { useMe } from "@/features/session/queries";
import { api, ApiError, applyFieldErrors, errorMessage } from "@/lib/api-client";

import { AuthCard } from "./auth-card";
import { PasswordInput } from "./password-input";
import { SignedInNotice } from "./signed-in-notice";
import { useCompleteAuth, useNextTarget } from "./use-auth-redirect";

type SignInOutput = z.output<typeof signInSchema>;

export function SignInForm() {
  const target = useNextTarget("/app");
  const me = useMe();
  const completeAuth = useCompleteAuth();
  const [redirecting, setRedirecting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<SignInInput, unknown, SignInOutput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = form;

  const mutation = useMutation({
    mutationFn: (body: SignInOutput) => api.post<{ user: { name: string } }>("/auth/signin", body),
  });

  if (me.isSuccess && !redirecting) return <SignedInNotice me={me.data} continueTo={target} />;

  const pending = mutation.isPending || redirecting;
  const signUpHref = target === "/app" ? "/sign-up" : `/sign-up?next=${encodeURIComponent(target)}`;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const res = await mutation.mutateAsync(values);
      setRedirecting(true);
      toast.success(`Welcome back${res.user.name ? `, ${res.user.name.split(" ")[0]}` : ""}`);
      await completeAuth(target);
    } catch (error) {
      setRedirecting(false);
      if (applyFieldErrors(error, setError, ["email", "password"])) return;
      if (error instanceof ApiError && (error.status === 403 || error.status === 429)) {
        // Account disabled / too many attempts: keep the reason visible on the form.
        setFormError(error.message);
        return;
      }
      toast.error(errorMessage(error));
    }
  });

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Sign in to your workspace."
      footer={
        <>
          New here?{" "}
          <Link
            href={signUpHref}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Start a free trial
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={pending}>
        {formError && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}
        <FormField label="Email" error={errors.email?.message} required>
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@restaurant.com"
            {...register("email")}
          />
        </FormField>
        <FormField
          label="Password"
          error={errors.password?.message}
          required
          labelAction={
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          }
        >
          <PasswordInput autoComplete="current-password" {...register("password")} />
        </FormField>
        <Button type="submit" size="lg" disabled={pending} className="mt-1">
          {pending && <Spinner decorative />}
          {redirecting ? "Signing you in…" : mutation.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
