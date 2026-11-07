import type { OnboardingProgress, WorkspaceDto } from "@ros/contracts/workspaces";
import type { AuditRepository } from "../../ports/core-repositories";

export type { OnboardingProgress };

export interface OrganizationMembershipRow {
  id: string;
  name: string;
  role: "OWNER" | "BILLING_ADMIN";
  workspaceCount: number;
}

export interface CreateWorkspaceRecord {
  organizationId: string;
  name: string;
  slug: string;
  country: string;
  defaultCurrency: string;
  createdBy: string;
}

export interface WorkspaceRepository {
  slugExists(slug: string): Promise<boolean>;
  insert(input: CreateWorkspaceRecord): Promise<WorkspaceDto>;
  findById(workspaceId: string): Promise<WorkspaceDto | null>;
  /** Optimistic update; returns null when `expectedVersion` no longer matches. */
  update(
    workspaceId: string,
    patch: Partial<
      Omit<WorkspaceDto, "id" | "slug" | "status" | "onboarding" | "version" | "createdAt">
    >,
    expectedVersion?: number,
  ): Promise<WorkspaceDto | null>;
  setOnboarding(workspaceId: string, progress: OnboardingProgress): Promise<void>;
  findSystemRoleId(key: string): Promise<string>;
  insertMembership(input: {
    workspaceId: string;
    userId: string;
    roleId: string;
    invitedBy?: string | null;
  }): Promise<string>;
  findPlanByKey(key: string): Promise<{ id: string; key: string } | null>;
  /** Organizations the user belongs to, with their non-deleted workspace counts. */
  listOrganizationsForUser(userId: string): Promise<OrganizationMembershipRow[]>;
  /** Row lock on the organization for the rest of the transaction (serialises creations). */
  lockOrganization(organizationId: string): Promise<void>;
  /** Non-deleted workspaces in the organization, in total and created after `since`. */
  countOrganizationWorkspaces(
    organizationId: string,
    since: Date,
  ): Promise<{ total: number; createdSince: number }>;
  /** True when any organization the user created ever started a trial. */
  hasStartedTrial(userId: string): Promise<boolean>;
  insertOrganization(input: { name: string; createdBy: string }): Promise<{ id: string }>;
  insertOrganizationMember(input: {
    organizationId: string;
    userId: string;
    role: "OWNER" | "BILLING_ADMIN";
  }): Promise<void>;
  /** The organization's subscription; `workspaceId` is dual-written as its first workspace. */
  insertSubscription(input: {
    organizationId: string;
    workspaceId: string;
    planId: string;
    status: "TRIALING" | "ACTIVE";
    trialStartsAt: Date | null;
    trialEndsAt: Date | null;
    actorUserId: string | null;
    planKey: string;
  }): Promise<void>;
}

export interface WorkspaceRepos {
  workspaces: WorkspaceRepository;
  audit: AuditRepository;
}
