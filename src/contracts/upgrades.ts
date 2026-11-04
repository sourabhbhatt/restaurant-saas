import { z } from "zod";

import { BILLING_CYCLES } from "@/domain/subscriptions/entitlements";
import type { UpgradeStatus } from "@/domain/subscriptions/upgrade-request";

export type { UpgradeStatus };

export const createUpgradeRequestSchema = z.object({
  planKey: z.string().trim().min(1, "Choose a plan").max(40),
  billingCycle: z.enum(BILLING_CYCLES).default("MONTHLY"),
  message: z.string().trim().max(500, "Keep the message under 500 characters").optional(),
});
export type CreateUpgradeRequestInput = z.input<typeof createUpgradeRequestSchema>;

export const approveUpgradeSchema = z.object({
  billingCycle: z.enum(BILLING_CYCLES),
  /** Last day of the paid period (inclusive, UTC). */
  periodEnd: z.iso.date({ error: "Choose the period end date" }),
  note: z.string().trim().max(500).optional(),
});

export const rejectUpgradeSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason the owner will understand").max(500),
});

export const upgradeNoteSchema = z.object({
  body: z.string().trim().min(1, "Write a note").max(1000),
});

export const upgradeListQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export interface UpgradeRequestDto {
  id: string;
  workspaceId: string;
  workspaceName: string;
  requestedBy: { id: string; name: string; email: string } | null;
  currentPlan: { key: string; name: string } | null;
  requestedPlan: { key: string; name: string; monthlyPrice: number | null; currency: string };
  billingCycle: "MONTHLY" | "ANNUAL";
  message: string | null;
  status: UpgradeStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  createdAt: string;
}

export interface UpgradeEventDto {
  id: string;
  type: "CREATED" | "NOTE" | "APPROVED" | "REJECTED" | "CANCELLED";
  actorName: string | null;
  body: string | null;
  createdAt: string;
}

/** Admin detail: request + full history including internal notes. */
export interface UpgradeRequestDetailDto extends UpgradeRequestDto {
  events: UpgradeEventDto[];
  /** Workspace's current subscription, for context while deciding. */
  currentSubscription: {
    planName: string;
    status: string;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
  } | null;
}

export interface UpgradeRequestListDto {
  items: UpgradeRequestDto[];
  total: number;
  page: number;
  pageSize: number;
  pendingCount: number;
}
