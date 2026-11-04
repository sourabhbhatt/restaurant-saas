import type {
  AssignmentDto,
  BranchDto,
  BranchSettingsDto,
  BranchSummaryDto,
  BusinessHoursDayDto,
  InvitationDto,
  InvitationStatus,
  MemberDto,
  RestaurantDto,
  RestaurantSettingsDto,
  RoleDto,
  RoleRefDto,
  StaffAssignmentDto,
} from "@/contracts/tenancy";
import type { Permission, RoleScope } from "@/domain/access/permissions";
import type { PaymentMethod } from "@/domain/billing/payments";
import type { AuditRepository } from "@/server/ports/core-repositories";

/**
 * Tenancy module ports. Every method that reads or writes tenant data takes
 * the workspace id from a server-resolved scope and filters by it, so an id
 * from another workspace simply finds nothing.
 */

export interface RestaurantRecordInput {
  name: string;
  slug: string;
  description: string | null;
  cuisineTypes: string[];
  logoKey: string | null;
  coverKey: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  brandColor: string | null;
}

export type RestaurantPatch = Partial<Omit<RestaurantRecordInput, "slug">>;

export interface RestaurantSettingsPatch {
  showPrepTime?: boolean;
  showAllergens?: boolean;
  welcomeMessage?: string | null;
}

export interface BranchRecordInput {
  name: string;
  code: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  timezone: string;
  currency: string;
  businessHours: BusinessHoursDayDto[];
}

export type BranchPatch = Partial<BranchRecordInput>;

export interface BranchSettingsRecord {
  taxes: { name: string; rateBps: number }[];
  pricesIncludeTax: boolean;
  serviceChargeBps: number;
  paymentMethods: PaymentMethod[];
  requireFullPaymentToClose: boolean;
  autoCompleteOnPayment: boolean;
  allowCustomerBillRequest: boolean;
  acceptingOrders: boolean;
  kitchenDelayMinutes: number;
  kitchenSoundEnabled: boolean;
  waiterSoundEnabled: boolean;
  receiptHeader: string | null;
  receiptFooter: string | null;
}

export interface RoleRecord extends RoleRefDto {
  workspaceId: string | null;
  isSystem: boolean;
  description: string | null;
}

export interface MembershipRecord {
  id: string;
  workspaceId: string;
  userId: string;
  status: "ACTIVE" | "DISABLED";
  roleId: string;
  roleKey: string;
}

export interface AssignmentRecord {
  id: string;
  membershipId: string;
  roleId: string;
  restaurantId: string;
  branchId: string | null;
}

export interface InvitationRecord {
  id: string;
  workspaceId: string;
  email: string;
  status: InvitationStatus;
  workspaceRoleId: string;
  assignmentRoleId: string | null;
  restaurantId: string | null;
  branchId: string | null;
  expiresAt: Date;
}

export interface InvitationLookup extends InvitationRecord {
  workspaceName: string;
  inviterName: string | null;
  roleName: string;
  assignmentRoleName: string | null;
  restaurantName: string | null;
  branchName: string | null;
}

export interface TenancyRepository {
  // workspace / users
  findWorkspace(
    workspaceId: string,
  ): Promise<{ id: string; name: string; country: string; defaultCurrency: string } | null>;
  findUserByEmail(email: string): Promise<{ id: string; name: string; email: string } | null>;
  findUserName(userId: string): Promise<string | null>;
  updateUserName(userId: string, name: string): Promise<void>;

  // restaurants
  listRestaurants(workspaceId: string, restaurantIds: string[] | null): Promise<RestaurantDto[]>;
  listBranchSummaries(
    workspaceId: string,
    restaurantIds: string[],
  ): Promise<(BranchSummaryDto & { restaurantId: string })[]>;
  restaurantSlugExists(workspaceId: string, slug: string): Promise<boolean>;
  /** Inserts the restaurant, its settings row and a default "Main Menu". */
  insertRestaurant(workspaceId: string, input: RestaurantRecordInput): Promise<RestaurantDto>;
  findRestaurant(workspaceId: string, restaurantId: string): Promise<RestaurantDto | null>;
  getRestaurantSettings(workspaceId: string, restaurantId: string): Promise<RestaurantSettingsDto>;
  /** Optimistic update; null when the version no longer matches (or not found). */
  updateRestaurant(
    workspaceId: string,
    restaurantId: string,
    patch: RestaurantPatch,
    expectedVersion: number | undefined,
  ): Promise<RestaurantDto | null>;
  updateRestaurantSettings(
    workspaceId: string,
    restaurantId: string,
    patch: RestaurantSettingsPatch,
  ): Promise<void>;
  /** Soft-deletes the restaurant and all of its branches. */
  archiveRestaurant(workspaceId: string, restaurantId: string, now: Date): Promise<boolean>;
  countOpenSessions(
    workspaceId: string,
    target: { restaurantId: string; branchId?: string },
  ): Promise<number>;

  // branches
  listBranches(workspaceId: string, restaurantId: string): Promise<BranchDto[]>;
  countBranches(workspaceId: string, restaurantId: string): Promise<number>;
  listBranchCodes(
    workspaceId: string,
    restaurantId: string,
    exceptBranchId?: string,
  ): Promise<string[]>;
  /** Inserts the branch and its settings row (defaults). */
  insertBranch(
    workspaceId: string,
    restaurantId: string,
    input: BranchRecordInput,
  ): Promise<BranchDto>;
  findBranch(workspaceId: string, branchId: string): Promise<BranchDto | null>;
  updateBranch(
    workspaceId: string,
    branchId: string,
    patch: BranchPatch,
    expectedVersion: number | undefined,
  ): Promise<BranchDto | null>;
  archiveBranch(workspaceId: string, branchId: string, now: Date): Promise<boolean>;
  getBranchSettings(workspaceId: string, branchId: string): Promise<BranchSettingsDto | null>;
  updateBranchSettings(
    workspaceId: string,
    branchId: string,
    settings: BranchSettingsRecord,
    expectedVersion: number | undefined,
  ): Promise<BranchSettingsDto | null>;

  // roles
  listRoles(workspaceId: string): Promise<RoleDto[]>;
  /** A system role or a custom role of this workspace. */
  findRole(workspaceId: string, roleId: string): Promise<RoleRecord | null>;
  findSystemRole(key: string): Promise<RoleRecord>;
  roleKeyExists(workspaceId: string, key: string): Promise<boolean>;
  insertRole(
    workspaceId: string,
    input: {
      key: string;
      name: string;
      description: string | null;
      scope: RoleScope;
      permissions: Permission[];
    },
  ): Promise<string>;
  updateRole(
    workspaceId: string,
    roleId: string,
    patch: { name?: string; description?: string | null; permissions?: Permission[] },
  ): Promise<boolean>;
  deleteRole(workspaceId: string, roleId: string): Promise<boolean>;
  roleUsageCount(workspaceId: string, roleId: string): Promise<number>;
  findRoleDto(workspaceId: string, roleId: string): Promise<RoleDto | null>;

  // members
  listMembers(workspaceId: string): Promise<MemberDto[]>;
  findMember(workspaceId: string, membershipId: string): Promise<MemberDto | null>;
  findMembership(workspaceId: string, membershipId: string): Promise<MembershipRecord | null>;
  findMembershipByUser(workspaceId: string, userId: string): Promise<MembershipRecord | null>;
  /** Locks and returns ACTIVE owner membership ids (serialises last-owner checks). */
  lockActiveOwners(workspaceId: string): Promise<string[]>;
  updateMembership(
    workspaceId: string,
    membershipId: string,
    patch: { roleId?: string; status?: "ACTIVE" | "DISABLED" },
  ): Promise<void>;
  deleteMembership(workspaceId: string, membershipId: string): Promise<boolean>;
  insertMembership(input: {
    workspaceId: string;
    userId: string;
    roleId: string;
    invitedBy: string | null;
  }): Promise<string>;
  isActiveMemberEmail(workspaceId: string, email: string): Promise<boolean>;
  listActiveMemberOptions(
    workspaceId: string,
  ): Promise<{ membershipId: string; name: string; email: string; roleName: string }[]>;

  // assignments
  listBranchAssignments(
    workspaceId: string,
    restaurantId: string,
    branchId: string,
  ): Promise<StaffAssignmentDto[]>;
  findAssignment(workspaceId: string, assignmentId: string): Promise<AssignmentRecord | null>;
  /** Returns null when the same assignment already exists. */
  insertAssignment(input: {
    workspaceId: string;
    membershipId: string;
    roleId: string;
    restaurantId: string;
    branchId: string | null;
    createdBy: string | null;
  }): Promise<AssignmentDto | null>;
  deleteAssignment(workspaceId: string, assignmentId: string): Promise<boolean>;

  // invitations
  listInvitations(workspaceId: string, now: Date): Promise<InvitationDto[]>;
  findInvitation(workspaceId: string, invitationId: string): Promise<InvitationRecord | null>;
  findInvitationDto(
    workspaceId: string,
    invitationId: string,
    now: Date,
  ): Promise<InvitationDto | null>;
  findPendingInvitationByEmail(
    workspaceId: string,
    email: string,
  ): Promise<InvitationRecord | null>;
  /** Locks the row (accept flow). */
  findInvitationByTokenHash(tokenHash: string, lock?: boolean): Promise<InvitationLookup | null>;
  /**
   * Inserts the invitation; when the email belongs to an existing user, also
   * writes them an in-app notification in the same transaction.
   */
  insertInvitation(input: {
    workspaceId: string;
    workspaceName: string;
    inviterName: string;
    email: string;
    tokenHash: string;
    workspaceRoleId: string;
    assignmentRoleId: string | null;
    restaurantId: string | null;
    branchId: string | null;
    invitedBy: string;
    expiresAt: Date;
  }): Promise<string>;
  rotateInvitationToken(
    workspaceId: string,
    invitationId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<boolean>;
  /** Conditional PENDING → status transition. */
  transitionInvitation(
    workspaceId: string,
    invitationId: string,
    to: "ACCEPTED" | "REVOKED" | "EXPIRED",
    extra?: { acceptedBy?: string; acceptedAt?: Date },
  ): Promise<boolean>;
}

export interface TenancyRepos {
  tenancy: TenancyRepository;
  audit: AuditRepository;
}
