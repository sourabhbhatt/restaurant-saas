import { z } from "zod";

/** Shared by the API (validation) and the forms (React Hook Form resolvers). */

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"))
  .transform((v) => v.toLowerCase());

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128, "Use at most 128 characters")
  .refine(
    (v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v),
    "Include at least one letter and one number",
  );

export const signUpSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80, "Name is too long"),
  email: emailSchema,
  password: passwordSchema,
  acceptTerms: z.literal(true, { error: "You must accept the terms to continue" }),
});
export type SignUpInput = z.input<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(128),
});
export type SignInInput = z.input<typeof signInSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(100),
  password: passwordSchema,
});

export const verifyEmailSchema = z.object({ token: z.string().min(20).max(100) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: passwordSchema,
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
});

export interface MeResponse {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    isPlatformAdmin: boolean;
  };
  activeWorkspaceId: string | null;
  workspaces: {
    id: string;
    name: string;
    slug: string;
    status: string;
    roleKey: string;
    roleName: string;
  }[];
}
