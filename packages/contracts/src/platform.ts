import { z } from "zod";

import { platformSettingsSchema, type PlatformSettings } from "@ros/domain/platform/settings";
import { SUPPORTED_CURRENCIES } from "@ros/domain/shared/money";
import {
  BILLING_CYCLES,
  FEATURE_KEYS,
  LIMIT_KEYS,
  WORKSPACE_STATUSES,
  type BillingCycle,
  type Entitlements,
  type FeatureKey,
  type LimitKey,
  type PlanLimits,
  type SubscriptionPhase,
  type SubscriptionStatus,
  type WorkspaceStatus,
} from "@ros/domain/subscriptions/entitlements";

/**
 * Platform module contracts: plans, subscriptions, Super Admin, support,
 * announcements, audit viewers, jobs and the test clock. Shared by the API
 * handlers (validation) and the UI forms (zodResolver).
 */

// ------------------------------------------------------------------ shared

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

const page = z.coerce.number().int().min(1).max(10_000).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(25);
const optionalQueryText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((v) => (v ? v : undefined));
const optionalDate = z
  .union([z.iso.date(), z.literal("")])
  .optional()
  .transform((v) => (v ? v : undefined));

export const SUBSCRIPTION_PHASES = [
  "TRIAL",
  "ACTIVE",
  "GRACE",
  "RESTRICTED",
  "SUSPENDED",
  "DEACTIVATED",
  "NONE",
] as const satisfies readonly SubscriptionPhase[];

// ------------------------------------------------------------------ plans

const limitValue = z.number().int().min(0, "Use 0 or more").max(1_000_000).nullable();

export const planLimitsSchema = z.object(
  Object.fromEntries(LIMIT_KEYS.map((k) => [k, limitValue])) as Record<LimitKey, typeof limitValue>,
);

const planKeySchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters")
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "Lowercase letters, numbers, - and _ only");

const minorPrice = z.number().int().min(0).max(1_000_000_000).nullable();

/** API body for creating/updating a plan. Prices are integer minor units (null = custom). */
export const planInputSchema = z.object({
  key: planKeySchema,
  name: z.string().trim().min(2, "Enter a plan name").max(60),
  description: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  currency: z.enum(SUPPORTED_CURRENCIES),
  monthlyPrice: minorPrice,
  annualPrice: minorPrice,
  isTrialEligible: z.boolean(),
  isPublic: z.boolean(),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  limits: planLimitsSchema,
  /** Workspaces per organization on ANNUAL billing; null = unlimited within fair use. */
  maxWorkspaces: z.number().int().min(1, "Use 1 or more").max(1000).nullable().default(1),
  features: z.array(z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]])).max(50),
  sortOrder: z.number().int().min(0).max(1000),
});
export type PlanInput = z.infer<typeof planInputSchema>;

/** Plan form (UI): prices in major units, a per-limit "unlimited" flag. */
const majorPrice = z
  .number({ error: "Enter a price" })
  .min(0, "Use 0 or more")
  .max(10_000_000)
  .nullable();
export const planFormSchema = planInputSchema.extend({
  monthlyPrice: majorPrice,
  annualPrice: majorPrice,
  limits: z.object(
    Object.fromEntries(
      LIMIT_KEYS.map((k) => [
        k,
        z.object({
          unlimited: z.boolean(),
          value: z.number({ error: "Enter a number" }).int("Whole numbers only").min(0).max(1e6),
        }),
      ]),
    ) as Record<LimitKey, z.ZodObject<{ unlimited: z.ZodBoolean; value: z.ZodNumber }>>,
  ),
});
export type PlanFormValues = z.infer<typeof planFormSchema>;

export interface PlanFeatureDto {
  key: FeatureKey;
  label: string;
}

/** Shown publicly (pricing page, upgrade modal). Never includes internal fields. */
export interface PublicPlanDto {
  key: string;
  name: string;
  description: string | null;
  currency: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  isTrialEligible: boolean;
  limits: PlanLimits;
  /** Workspaces per organization on annual billing; null = unlimited (fair use). */
  maxWorkspaces: number | null;
  features: PlanFeatureDto[];
}

export interface AdminPlanDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  currency: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  isTrialEligible: boolean;
  isPublic: boolean;
  status: "ACTIVE" | "ARCHIVED";
  limits: PlanLimits;
  maxWorkspaces: number | null;
  features: FeatureKey[];
  sortOrder: number;
  /** Workspaces whose current subscription uses this plan. */
  activeSubscriptions: number;
  createdAt: string;
  updatedAt: string;
}

// ------------------------------------------------------------------ subscription overview

export interface SubscriptionEventDto {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string | null;
  planKey: string | null;
  actorName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CurrentSubscriptionDto {
  id: string;
  planKey: string;
  planName: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelledAt: string | null;
  remindersSent: number[];
  notes: string | null;
  createdAt: string;
}

export interface WorkspaceUsageDto {
  restaurants: number;
  branches: number;
  staff: number;
  tables: number;
  menuItems: number;
  storageBytes: number;
}

export interface SubscriptionOverviewDto {
  workspaceId: string;
  workspaceName: string;
  workspaceStatus: WorkspaceStatus;
  entitlements: Entitlements;
  usage: WorkspaceUsageDto;
  subscription: CurrentSubscriptionDto | null;
  currentPlan: PublicPlanDto | null;
  availablePlans: PublicPlanDto[];
  history: SubscriptionEventDto[];
  /** Open upgrade request (support request of category UPGRADE), if any. */
  pendingUpgrade: {
    id: string;
    subject: string;
    requestedPlanKey: string;
    requestedPlanName: string;
    createdAt: string;
  } | null;
  trialDays: number;
  supportEmail: string;
  canRequestUpgrade: boolean;
  /** The billing owner; checkout is created per organization. Null only for pre-backfill rows. */
  organizationId: string | null;
  /** True when a payment gateway is configured (PAYMENT_PROVIDER): shows the Pay button. */
  paymentsEnabled: boolean;
}

// ------------------------------------------------------------------ support

export const SUPPORT_CATEGORIES = [
  "GENERAL",
  "UPGRADE",
  "BILLING",
  "TECHNICAL",
  "ACCOUNT",
  "FEATURE_REQUEST",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  GENERAL: "General question",
  UPGRADE: "Upgrade / plan change",
  BILLING: "Billing",
  TECHNICAL: "Technical issue",
  ACCOUNT: "Account & access",
  FEATURE_REQUEST: "Feature request",
};
export const SUPPORT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const createSupportRequestSchema = z.object({
  subject: z.string().trim().min(4, "Add a short subject").max(140, "Subject is too long"),
  message: z
    .string()
    .trim()
    .min(10, "Describe your request in a few words (10+ characters)")
    .max(5000, "Message is too long"),
  category: z.enum(SUPPORT_CATEGORIES),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
  /** Upgrade requests: the plan and cycle the workspace wants. */
  planKey: planKeySchema.optional(),
  billingCycle: z.enum(BILLING_CYCLES).optional(),
});
export type CreateSupportRequestInput = z.input<typeof createSupportRequestSchema>;

export const supportListQuerySchema = z.object({
  status: z.enum(SUPPORT_STATUSES).optional(),
  category: z.enum(SUPPORT_CATEGORIES).optional(),
  priority: z.enum(SUPPORT_PRIORITIES).optional(),
  workspaceId: z.uuid().optional(),
  q: optionalQueryText,
  assigned: z.enum(["me", "unassigned"]).optional(),
  page,
  pageSize,
});
export type SupportListQuery = z.infer<typeof supportListQuerySchema>;

export const updateSupportRequestSchema = z
  .object({
    status: z.enum(SUPPORT_STATUSES).optional(),
    priority: z.enum(SUPPORT_PRIORITIES).optional(),
    /** "me" assigns to the acting Super Admin; null unassigns. */
    assignee: z.enum(["me"]).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.priority !== undefined || v.assignee !== undefined, {
    message: "Nothing to update",
  });

export const supportNoteSchema = z.object({
  body: z.string().trim().min(1, "Write a note").max(5000),
});

export interface SupportRequestDto {
  id: string;
  workspaceId: string | null;
  workspaceName: string | null;
  subject: string;
  message: string;
  category: SupportCategory;
  status: SupportStatus;
  priority: SupportPriority;
  contactEmail: string;
  createdBy: { id: string; name: string; email: string } | null;
  assignedTo: { id: string; name: string } | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportNoteDto {
  id: string;
  body: string;
  isInternal: boolean;
  author: { id: string; name: string } | null;
  createdAt: string;
}

export interface SupportRequestDetailDto extends SupportRequestDto {
  notes: SupportNoteDto[];
}

// ------------------------------------------------------------------ audit

export const AUDIT_ACTOR_TYPES = ["USER", "GUEST", "SYSTEM", "PLATFORM_ADMIN"] as const;

export const auditQuerySchema = z
  .object({
    action: optionalQueryText,
    /** Matches actor name or email. */
    actor: optionalQueryText,
    actorType: z.enum(AUDIT_ACTOR_TYPES).optional(),
    from: optionalDate,
    to: optionalDate,
    page,
    pageSize,
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Start date must be before end date",
    path: ["to"],
  });
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export const adminAuditQuerySchema = z
  .object({
    action: optionalQueryText,
    actor: optionalQueryText,
    actorType: z.enum(AUDIT_ACTOR_TYPES).optional(),
    workspaceId: z.uuid().optional(),
    from: optionalDate,
    to: optionalDate,
    page,
    pageSize,
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Start date must be before end date",
    path: ["to"],
  });
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

export interface AuditLogDto {
  id: string;
  workspaceId: string | null;
  workspaceName: string | null;
  branchId: string | null;
  actorType: (typeof AUDIT_ACTOR_TYPES)[number];
  actor: { id: string; name: string; email: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

// ------------------------------------------------------------------ announcements

export const ANNOUNCEMENT_LEVELS = ["INFO", "WARNING", "CRITICAL"] as const;
export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVELS)[number];

export const announcementInputSchema = z
  .object({
    title: z.string().trim().min(3, "Add a title").max(120),
    body: z.string().trim().min(3, "Add a message").max(1000),
    level: z.enum(ANNOUNCEMENT_LEVELS),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
    isActive: z.boolean(),
  })
  .refine((v) => !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), {
    message: "End must be after the start",
    path: ["endsAt"],
  });
export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

/** Announcement form (UI): `datetime-local` strings. */
export const announcementFormSchema = z
  .object({
    title: z.string().trim().min(3, "Add a title").max(120),
    body: z.string().trim().min(3, "Add a message").max(1000),
    level: z.enum(ANNOUNCEMENT_LEVELS),
    startsAt: z.string().min(1, "Choose a start time"),
    endsAt: z.string(),
    isActive: z.boolean(),
  })
  .refine((v) => !v.endsAt || new Date(v.endsAt) > new Date(v.startsAt), {
    message: "End must be after the start",
    path: ["endsAt"],
  });
export type AnnouncementFormValues = z.infer<typeof announcementFormSchema>;

export interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  level: AnnouncementLevel;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PublicAnnouncementDto = Pick<
  AnnouncementDto,
  "id" | "title" | "body" | "level" | "startsAt" | "endsAt"
>;

// ------------------------------------------------------------------ settings

export { platformSettingsSchema };
export type { PlatformSettings };

export interface AdminSettingsDto {
  settings: PlatformSettings;
  plans: { key: string; name: string; status: "ACTIVE" | "ARCHIVED" }[];
}

// ------------------------------------------------------------------ Super Admin workspaces

export const adminWorkspaceListQuerySchema = z.object({
  q: optionalQueryText,
  status: z.enum(WORKSPACE_STATUSES).optional(),
  phase: z.enum(SUBSCRIPTION_PHASES).optional(),
  page,
  pageSize,
});
export type AdminWorkspaceListQuery = z.infer<typeof adminWorkspaceListQuerySchema>;

export interface AdminWorkspaceRowDto {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  ownerEmail: string | null;
  planKey: string | null;
  planName: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  phase: SubscriptionPhase;
  trialDaysRemaining: number | null;
  counts: { restaurants: number; branches: number; users: number };
  createdAt: string;
}

export interface EntitlementOverrideDto {
  key: string;
  value: number | boolean | null;
  reason: string | null;
  createdBy: string | null;
  updatedAt: string;
}

/** The billing owner of a workspace, as Super Admin sees it. */
export interface AdminOrganizationDto {
  id: string;
  name: string;
  /** Super Admin workspace limit for this organization; null = plan rules apply. */
  maxWorkspacesOverride: number | null;
  workspaceCount: number;
}

export const organizationLimitOverrideSchema = z.object({
  maxWorkspacesOverride: z
    .number({ error: "Enter a number of workspaces" })
    .int("Whole numbers only")
    .min(0, "Use 0 or more")
    .max(1000)
    .nullable(),
});
export type OrganizationLimitOverrideInput = z.infer<typeof organizationLimitOverrideSchema>;

export interface AdminWorkspaceDetailDto {
  workspace: {
    id: string;
    name: string;
    slug: string;
    status: WorkspaceStatus;
    statusReason: string | null;
    country: string;
    defaultCurrency: string;
    businessEmail: string | null;
    createdAt: string;
  };
  /** Null only for a workspace not yet backfilled into an organization. */
  organization: AdminOrganizationDto | null;
  members: {
    membershipId: string;
    userId: string;
    name: string;
    email: string;
    roleKey: string;
    roleName: string;
    status: "ACTIVE" | "DISABLED";
    joinedAt: string;
  }[];
  restaurants: {
    id: string;
    name: string;
    status: "ACTIVE" | "ARCHIVED";
    branches: { id: string; name: string; code: string; city: string | null; status: string }[];
  }[];
  usage: WorkspaceUsageDto;
  entitlements: Entitlements;
  subscription: CurrentSubscriptionDto | null;
  history: SubscriptionEventDto[];
  overrides: EntitlementOverrideDto[];
  plans: { key: string; name: string; status: "ACTIVE" | "ARCHIVED" }[];
}

const reasonSchema = z.string().trim().min(3, "Give a short reason").max(500);

export const workspaceStatusSchema = z.object({
  status: z.enum(WORKSPACE_STATUSES),
  reason: reasonSchema,
});

export const activateSubscriptionSchema = z.object({
  planKey: planKeySchema,
  billingCycle: z.enum(BILLING_CYCLES),
  /** Last day of the paid period (inclusive, UTC). */
  periodEnd: z.iso.date({ error: "Choose the period end date" }),
  notes: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : undefined)),
});
export type ActivateSubscriptionInput = z.infer<typeof activateSubscriptionSchema>;

export const extendTrialSchema = z.object({
  days: z.number({ error: "Enter a number of days" }).int().min(1, "At least 1 day").max(365),
  reason: reasonSchema,
});

export const subscriptionReasonSchema = z.object({ reason: reasonSchema });

export const OVERRIDE_KEYS = [
  ...LIMIT_KEYS,
  ...FEATURE_KEYS.map((f) => `feature:${f}` as const),
] as const;

export const entitlementOverrideSchema = z
  .object({
    key: z.enum(OVERRIDE_KEYS as unknown as [string, ...string[]]),
    value: z.union([z.number().int().min(0).max(1_000_000), z.boolean(), z.null()]),
    reason: reasonSchema,
  })
  .refine(
    (v) =>
      v.key.startsWith("feature:") ? typeof v.value === "boolean" : typeof v.value !== "boolean",
    {
      message: "Features take on/off; limits take a number or unlimited",
      path: ["value"],
    },
  );
export type EntitlementOverrideInput = z.infer<typeof entitlementOverrideSchema>;

export const deleteOverrideQuerySchema = z.object({
  key: z.enum(OVERRIDE_KEYS as unknown as [string, ...string[]]),
});

// ------------------------------------------------------------------ jobs & test clock

export interface SubscriptionSweepResult {
  now: string;
  scanned: number;
  trialReminders: number;
  trialExpired: number;
  periodExpired: number;
  graceEnded: number;
}

export const testClockSchema = z.object({
  offsetDays: z.number().min(-3650).max(3650),
});

export interface TestClockDto {
  offsetMs: number;
  offsetDays: number;
  now: string;
}
