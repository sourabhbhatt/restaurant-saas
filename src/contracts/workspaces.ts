import { z } from "zod";

import { SUPPORTED_CURRENCIES } from "@/domain/shared/money";

export const ONBOARDING_STEPS = [
  "business",
  "restaurant",
  "branch",
  "settings",
  "menu",
  "tables",
  "qr",
  "staff",
  "done",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Enter a workspace name").max(80, "Name is too long"),
  defaultCurrency: z.enum(SUPPORTED_CURRENCIES).default("INR"),
  country: z.string().trim().length(2, "Use a 2-letter country code").default("IN"),
});
export type CreateWorkspaceInput = z.input<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z.object({
  name: z.string().trim().min(2, "Enter a workspace name").max(80).optional(),
  legalName: optionalText(120),
  businessEmail: z
    .string()
    .trim()
    .max(254)
    .transform((v) => (v === "" ? null : v))
    .pipe(z.email("Enter a valid email").nullable())
    .nullable()
    .optional(),
  businessPhone: optionalText(30),
  country: z.string().trim().length(2).optional(),
  taxId: optionalText(40),
  defaultCurrency: z.enum(SUPPORTED_CURRENCIES).optional(),
  version: z.number().int().positive().optional(),
});
export type UpdateWorkspaceInput = z.input<typeof updateWorkspaceSchema>;

export const onboardingProgressSchema = z.object({
  completedStep: z.enum(ONBOARDING_STEPS).optional(),
  currentStep: z.enum(ONBOARDING_STEPS).nullable().optional(),
  restaurantId: z.uuid().nullable().optional(),
  branchId: z.uuid().nullable().optional(),
  dismiss: z.boolean().optional(),
});

export interface OnboardingProgress {
  completedSteps: string[];
  currentStep: string | null;
  restaurantId?: string | null;
  branchId?: string | null;
  dismissedAt?: string | null;
}

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  status: string;
  legalName: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  country: string;
  taxId: string | null;
  defaultCurrency: string;
  onboarding: OnboardingProgress;
  version: number;
  createdAt: string;
}
