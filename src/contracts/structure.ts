import type { Entitlements } from "@/domain/subscriptions/entitlements";

export interface StructureBranchDto {
  id: string;
  name: string;
  code: string;
  city: string | null;
  status: "ACTIVE" | "ARCHIVED";
}

export interface StructureRestaurantDto {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  logoKey: string | null;
  branches: StructureBranchDto[];
}

/** Restaurants and branches the current user can see in a workspace. */
export interface WorkspaceStructureDto {
  workspaceId: string;
  workspaceName: string;
  roleKey: string;
  /** e.g. "Workspace Owner" or "Waiter"; for display only. */
  roleLabel: string;
  permissions: string[];
  restaurants: StructureRestaurantDto[];
  entitlements: Entitlements;
}

/** Everything a branch-scoped screen needs to render its chrome. */
export interface BranchContextDto {
  workspaceId: string;
  workspaceName: string;
  restaurantId: string;
  restaurantName: string;
  branchId: string;
  branchName: string;
  currency: string;
  timezone: string;
  roleLabel: string;
  /** Effective permissions at this branch (display only; the server enforces). */
  permissions: string[];
  entitlements: Entitlements;
}
