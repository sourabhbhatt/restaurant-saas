"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { signUpSchema } from "@ros/contracts/auth";
import { BRAND } from "@/features/site/brand";
import { useMe } from "@/features/session/queries";
import { api, ApiError, applyFieldErrors, errorMessage } from "@/lib/api-client";

import { AuthCard } from "./auth-card";
import { PasswordInput } from "./password-input";
import { PasswordStrength } from "./password-strength";
import { SignedInNotice } from "./signed-in-notice";
import { useCompleteAuth, useNextTarget } from "./use-auth-redirect";

/**
 * The shared contract requires `acceptTerms: true`. The checkbox starts
 * unchecked, so the form holds a boolean and pipes it into the contract's rule
 * (same validation and message as the API).
 */
const signUpFormSchema = signUpSchema.extend({
  acceptTerms: z.boolean().pipe(signUpSchema.shape.acceptTerms),
});
type SignUpValues = z.input<typeof signUpFormSchema>;
type SignUpOutput = z.output<typeof signUpFormSchema>;

export function SignUpForm() {
  const target = useNextTarget("/app/onboarding");
  const me = useMe();
  const completeAuth = useCompleteAuth();
  const [redirecting, setRedirecting] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  const form = useForm<SignUpValues, unknown, SignUpOutput>({
    resolver: zodResolver(signUpFormSchema),
    defaultValues: { name: "", email: "", password: "", acceptTerms: false },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = form;
  const password = useWatch({ control, name: "password" }) ?? "";

  const mutation = useMutation({
    mutationFn: (body: SignUpOutput) => api.post("/auth/signup", body),
  });

  if (me.isSuccess && !redirecting) return <SignedInNotice me={me.data} continueTo={target} />;

  const pending = mutation.isPending || redirecting;
  const signInHref =
    target === "/app/onboarding" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(target)}`;

  const onSubmit = handleSubmit(async (values) => {
    setBlocked(null);
    try {
      await mutation.mutateAsync(values);
      setRedirecting(true);
      toast.success("Account created", {
        description: "We've sent you an email to verify your address.",
      });
      await completeAuth(target);
    } catch (error) {
      setRedirecting(false);
      if (applyFieldErrors(error, setError, ["name", "email", "password", "acceptTerms"])) return;
      if (error instanceof ApiError && error.status === 403) {
        // e.g. "New sign-ups are temporarily disabled".
        setBlocked(error.message);
        return;
      }
      if (error instanceof ApiError && error.code === "CONFLICT") {
        setError("email", { type: "server", message: error.message });
        return;
      }
      toast.error(errorMessage(error));
    }
  });

  return (
    <AuthCard
      title="Start your free trial"
      description={`Create your ${BRAND.name} account. No card required.`}
      footer={
        <>
          Already have an account?{" "}
          <Link
            href={signInHref}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={pending}>
        {blocked && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Sign-up unavailable</AlertTitle>
            <AlertDescription>
              {blocked} Please try again later or contact{" "}
              <a href={`mailto:${BRAND.supportEmail}`} className="underline underline-offset-4">
                {BRAND.supportEmail}
              </a>
              .
            </AlertDescription>
          </Alert>
        )}
        <FormField label="Full name" error={errors.name?.message} required>
          <Input autoComplete="name" placeholder="Asha Rao" {...register("name")} />
        </FormField>
        <FormField label="Work email" error={errors.email?.message} required>
          <Input
            type="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@restaurant.com"
            {...register("email")}
          />
        </FormField>
        <div className="flex flex-col gap-2.5">
          <FormField label="Password" error={errors.password?.message} required>
            <PasswordInput autoComplete="new-password" {...register("password")} />
          </FormField>
          <PasswordStrength value={password} />
        </div>
        <Controller
          control={control}
          name="acceptTerms"
          render={({ field, fieldState }) => (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="accept-terms"
                  ref={field.ref}
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(v === true)}
                  onBlur={field.onBlur}
                  aria-invalid={fieldState.error ? true : undefined}
                  aria-describedby={fieldState.error ? "accept-terms-error" : undefined}
                  className="mt-0.5"
                />
                <label
                  htmlFor="accept-terms"
                  className="text-sm leading-snug text-muted-foreground"
                >
                  I agree to the{" "}
                  <Link
                    href="/legal/terms"
                    target="_blank"
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    terms of service
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/legal/privacy"
                    target="_blank"
                    className="font-medium text-foreground underline underline-offset-4"
                  >
                    privacy policy
                  </Link>
                  .
                </label>
              </div>
              {fieldState.error && (
                <p
                  id="accept-terms-error"
                  role="alert"
                  className="text-sm font-medium text-destructive"
                >
                  {fieldState.error.message}
                </p>
              )}
            </div>
          )}
        />
        <Button type="submit" size="lg" disabled={pending} className="mt-1">
          {pending && <Spinner decorative />}
          {redirecting
            ? "Setting things up…"
            : mutation.isPending
              ? "Creating account…"
              : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
