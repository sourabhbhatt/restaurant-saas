"use client";

import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { LinkIcon } from "lucide-react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { resetPasswordSchema } from "@ros/contracts/auth";
import { sessionKeys } from "@/features/session/queries";
import { api, ApiError, applyFieldErrors, errorMessage } from "@/lib/api-client";

import { AuthCard } from "./auth-card";
import { PasswordInput } from "./password-input";
import { PasswordStrength } from "./password-strength";

const resetFormSchema = resetPasswordSchema
  .pick({ password: true })
  .extend({ confirmPassword: z.string().min(1, "Confirm your new password") })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords don't match",
  });
type Values = z.input<typeof resetFormSchema>;
type Output = z.output<typeof resetFormSchema>;

const tokenSchema = resetPasswordSchema.shape.token;

export function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const tokenLooksValid = tokenSchema.safeParse(token).success;
  const [invalidLink, setInvalidLink] = useState(false);
  const router = useRouter();
  const qc = useQueryClient();

  const form = useForm<Values, unknown, Output>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const password = useWatch({ control: form.control, name: "password" }) ?? "";
  const mutation = useMutation({
    mutationFn: (password: string) => api.post("/auth/reset-password", { token, password }),
  });

  if (!tokenLooksValid || invalidLink) return <InvalidResetLink />;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync(values.password);
      // A reset signs out every session, including this browser's.
      qc.removeQueries({ queryKey: sessionKeys.me });
      toast.success("Password updated", { description: "Sign in with your new password." });
      router.replace("/sign-in");
    } catch (error) {
      if (error instanceof ApiError && error.fieldErrors.token) {
        setInvalidLink(true);
        return;
      }
      if (applyFieldErrors(error, form.setError, ["password"])) return;
      toast.error(errorMessage(error));
    }
  });

  const pending = mutation.isPending || mutation.isSuccess;
  return (
    <AuthCard
      title="Set a new password"
      description="Choose a strong password you don't use anywhere else. You'll be signed out on all devices."
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={pending}>
        <div className="flex flex-col gap-2.5">
          <FormField label="New password" error={form.formState.errors.password?.message} required>
            <PasswordInput autoComplete="new-password" {...form.register("password")} />
          </FormField>
          <PasswordStrength value={password} />
        </div>
        <FormField
          label="Confirm new password"
          error={form.formState.errors.confirmPassword?.message}
          required
        >
          <PasswordInput autoComplete="new-password" {...form.register("confirmPassword")} />
        </FormField>
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Spinner decorative />}
          {pending ? "Updating password…" : "Update password"}
        </Button>
      </form>
    </AuthCard>
  );
}

function InvalidResetLink() {
  return (
    <AuthCard
      icon={<LinkIcon />}
      title="This reset link isn't valid"
      description="The link is invalid, has already been used or has expired. Request a new one — it only takes a moment."
    >
      <div role="alert" className="flex flex-col gap-2">
        <Button asChild size="lg">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/sign-in">Back to sign in</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
