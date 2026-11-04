import type { OnboardingProgress, WorkspaceDto } from "@/contracts/workspaces";
import type { AuditRepository } from "@/server/ports/core-repositories";

export type { OnboardingProgress };

export interface CreateWorkspaceRecord {
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
  insertSubscription(input: {
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
